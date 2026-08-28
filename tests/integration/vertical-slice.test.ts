import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";
import {
  CLAUDE_SETTINGS,
  ClaudeAdapter,
} from "../../src/agents/claude-adapter.js";
import { CodexAdapter } from "../../src/agents/codex-adapter.js";
import { AgentRegistry } from "../../src/agents/agent-registry.js";
import {
  createCrossExaminationPhaseResponseSchema,
  InitialPhaseResponseSchema,
} from "../../src/agents/structured-response.js";
import type { AgentConfig, DebateConfig } from "../../src/config/schema.js";
import { DebateConfigSchema } from "../../src/config/schema.js";
import { DebateService } from "../../src/debate/debate-service.js";
import { ActiveRuns } from "../../src/orchestrator/active-runs.js";
import { AskService } from "../../src/orchestrator/ask-service.js";
import {
  runProcess,
  type ProcessRequest,
} from "../../src/platform/process-runner.js";
import { captureGitIntegrity } from "../../src/permissions/git-integrity.js";
import { ProjectService } from "../../src/projects/project-service.js";
import { openDatabase } from "../../src/storage/database.js";
import { DeliberationRepository } from "../../src/storage/deliberation-repository.js";
import { migrateDatabase } from "../../src/storage/migrations.js";
import { ProjectRepository } from "../../src/storage/project-repository.js";
import {
  canonicalJson,
  SessionRepository,
} from "../../src/storage/session-repository.js";
import {
  createCommandHandler,
  type DiscordPayload,
  type InteractionPort,
} from "../../src/transport/discord/command-handler.js";

const exec = promisify(execFile);
const codexCli = fileURLToPath(
  new URL("../fake-agents/vertical-codex-cli.mjs", import.meta.url),
);
const claudeCli = fileURLToPath(
  new URL("../fake-agents/vertical-claude-cli.mjs", import.meta.url),
);
const debateConfig: DebateConfig = {
  maxRounds: 1,
  maxBoardClaims: 5,
  maxBoardBytes: 16_384,
};

function fixtureRunner(script: string, calls: ProcessRequest[]) {
  return (request: ProcessRequest) => {
    calls.push(request);
    return runProcess({
      ...request,
      command: process.execPath,
      args: [script, ...request.args],
    });
  };
}

function interaction(name: string, values: Record<string, string> = {}) {
  const port: InteractionPort & {
    replies: DiscordPayload[];
    edits: DiscordPayload[];
  } = {
    interactionId: `${name}-${Math.random().toString()}`,
    commandName: name,
    guildId: "guild",
    channelId: "channel",
    userId: "user",
    replies: [],
    edits: [],
    getString: (key) => values[key],
    deferReply: () => Promise.resolve(),
    reply: (value) =>
      Promise.resolve().then(() => void port.replies.push(value)),
    editReply: (value) =>
      Promise.resolve().then(() => void port.edits.push(value)),
    followUp: () => Promise.resolve(),
  };
  return port;
}

function rendered(port: {
  replies: readonly DiscordPayload[];
  edits: readonly DiscordPayload[];
}): string {
  return [...port.replies, ...port.edits]
    .flatMap((item) => [
      item.content,
      ...(item.files ?? []).map((file) => file.attachment.toString("utf8")),
    ])
    .join("\n");
}

function inferenceCalls(calls: readonly ProcessRequest[]): ProcessRequest[] {
  return calls.filter((call) => call.stdin !== undefined);
}

function prompt(call: ProcessRequest): Record<string, unknown> | undefined {
  if (call.stdin === undefined) return undefined;
  try {
    const value: unknown = JSON.parse(call.stdin);
    return typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function agentConfig(
  provider: "codex" | "claude",
  requestedEffort = "high",
): AgentConfig {
  return {
    command: "fake",
    timeoutMs: 2_000,
    maxOutputBytes: 16_384,
    models: {
      selections: [
        {
          class: provider === "codex" ? "sol" : "opus",
          cliModelId: provider === "codex" ? "gpt-sol" : "claude-opus",
          requestedEffort,
          acceptedObservedModels:
            provider === "codex"
              ? { exactIds: ["gpt-sol"], literalPrefixes: [] }
              : { exactIds: [], literalPrefixes: ["claude-opus-"] },
        },
      ],
    },
  };
}

async function createHarness(
  options: {
    claudeEffort?: string;
    debate?: DebateConfig;
  } = {},
) {
  const projectRoot = await mkdtemp(join(tmpdir(), "ai-workspace-vertical-"));
  await exec("git", ["init", "--quiet", projectRoot]);
  await writeFile(join(projectRoot, "README.md"), "tracked evidence\n");
  await writeFile(join(projectRoot, "missing.txt"), "removed evidence\n");
  await exec("git", ["-C", projectRoot, "add", "README.md", "missing.txt"]);
  await rm(join(projectRoot, "missing.txt"));
  const before = await captureGitIntegrity(projectRoot);
  const database = openDatabase(":memory:");
  migrateDatabase(database);
  const projects = await ProjectService.create([
    { id: "demo", name: "Demo", root: projectRoot },
  ]);
  const projectRepository = new ProjectRepository(database);
  projectRepository.upsert(projects.get("demo"));
  projectRepository.setActive(
    { guildId: "guild", channelId: "channel", userId: "user" },
    "demo",
  );
  const sessions = new SessionRepository(database);
  const deliberation = new DeliberationRepository(database);
  const activeRuns = new ActiveRuns();
  const codexCalls: ProcessRequest[] = [];
  const claudeCalls: ProcessRequest[] = [];
  const config = {
    concurrency: 2,
    agents: {
      codex: agentConfig("codex"),
      claude: agentConfig("claude", options.claudeEffort),
    },
  };
  const codexAdapter = new CodexAdapter(config.agents.codex, {
    runProcess: fixtureRunner(codexCli, codexCalls),
  });
  const claudeAdapter = new ClaudeAdapter(config.agents.claude, {
    runProcess: fixtureRunner(claudeCli, claudeCalls),
  });
  const registry = new AgentRegistry([codexAdapter, claudeAdapter]);
  const askService = new AskService({
    config,
    registry,
    projects,
    projectRepository,
    sessions,
    activeRuns,
  });
  const debateService = new DebateService({
    config,
    registry,
    projects,
    sessions,
    deliberation,
    activeRuns,
  });
  const effectiveDebate = options.debate ?? debateConfig;
  const handler = createCommandHandler({
    config: {
      guildIds: ["guild"],
      allowedUserIds: ["user"],
      models: {
        codex: config.agents.codex.models,
        claude: config.agents.claude.models,
      },
      debate: effectiveDebate,
    },
    projects,
    projectRepository,
    askService,
    debateService,
    activeRuns,
    sessions,
  });
  return {
    projectRoot,
    before,
    database,
    sessions,
    deliberation,
    config,
    codexAdapter,
    claudeAdapter,
    codexCalls,
    claudeCalls,
    debateService,
    handler,
    cleanup: async () => {
      database.close();
      await rm(projectRoot, { recursive: true, force: true });
    },
  };
}

describe("dual-agent vertical slice", () => {
  test("reconstructs the complete hardened CLI debate and renders every deterministic verdict", async () => {
    const harness = await createHarness();
    try {
      const models = interaction("models");
      await harness.handler(models);
      expect(rendered(models)).toContain(
        "Codex: sol (provider default by omission)",
      );
      expect(rendered(models)).toContain(
        "Claude: opus (provider default by omission)",
      );

      const ask = interaction("ask", {
        agent: "both",
        question: "Summarize",
        claude_model: "opus",
      });
      await harness.handler(ask);
      expect(rendered(ask)).toContain("Status: completed");
      expect(rendered(ask)).toContain("## Codex");
      expect(rendered(ask)).toContain("## Claude");
      expect(rendered(ask)).not.toMatch(/Status: (?:partial|failed)/);

      const debate = interaction("debate", {
        topic: "vertical-exhaustive",
        project: "demo",
        claude_model: "opus",
      });
      debate.interactionId = "vertical-exhaustive";
      await harness.handler(debate);
      const debateText = rendered(debate);
      expect(debateText).toContain("Status: completed");
      expect(debateText).not.toMatch(/Status: (?:partial|failed)/);
      for (const section of [
        "## CONSENSUS",
        "## DISAGREEMENT",
        "## REJECTED",
        "## UNRESOLVED",
        "## Mechanically resolved evidence and provenance",
      ]) {
        expect(debateText).toContain(section);
      }
      expect(debateText).toContain("UNSUPPORTED");
      expect(debateText).toMatch(/evidence-\d{4} VERIFIED README\.md/);
      expect(debateText).toMatch(/evidence-\d{4} INVALID README\.md/);
      expect(debateText).toMatch(/evidence-\d{4} MISSING missing\.txt/);

      const session = harness.sessions.findByInteractionId(
        "vertical-exhaustive",
      );
      if (session === undefined) throw new Error("Expected debate session");
      expect(session.status).toBe("completed");
      expect(session.debateConfig).toEqual(debateConfig);
      const persisted = harness.deliberation.load(session.id);
      expect(persisted.runs).toHaveLength(6);
      expect(persisted.runs.map((run) => run.phase).sort()).toEqual([
        "cross_examination",
        "cross_examination",
        "final",
        "final",
        "initial",
        "initial",
      ]);
      expect(persisted.runs.every((run) => run.status === "completed")).toBe(
        true,
      );
      for (const run of persisted.runs) {
        const reconstructed = harness.deliberation.reconstructAgentCall(run.id);
        expect(reconstructed.request).toEqual(run.request);
        expect(reconstructed.response).toEqual(run.response);
        expect(reconstructed.outputBoard).toEqual(expect.any(Object));
        if (run.phase === "initial") {
          expect(reconstructed.inputBoard).toBeUndefined();
        } else {
          expect(reconstructed.inputBoard).toEqual(expect.any(Object));
        }
      }

      const report = harness.debateService.persistedReport(
        "vertical-exhaustive",
      );
      if (report?.board === undefined)
        throw new Error("Expected reconstructed debate report");
      expect(report.status).toBe("completed");
      expect(report.verdicts).toHaveLength(5);
      expect(report.consensus).toHaveLength(2);
      expect(report.disagreements).toHaveLength(1);
      expect(report.rejected).toHaveLength(1);
      expect(report.unresolved).toHaveLength(1);
      expect(
        report.consensus.some((verdict) => verdict.support === "UNSUPPORTED"),
      ).toBe(true);
      expect(report.board.claims.map((claim) => claim.id)).toEqual([
        "claim-0001",
        "claim-0002",
        "claim-0003",
        "claim-0004",
        "claim-0005",
      ]);
      expect(
        report.board.claims.every((claim) => claim.origins.length === 2),
      ).toBe(true);
      expect(report.board.evidence.map((entry) => entry.status).sort()).toEqual(
        expect.arrayContaining(["INVALID", "MISSING", "VERIFIED"]),
      );
      const translated = report.board.evidence.find((entry) =>
        entry.origins.some(
          (origin) => origin.providerLocalId === "cross-evidence-local",
        ),
      );
      expect(translated?.origins).toHaveLength(2);
      expect(
        persisted.stanceEvidence.some(
          (link) => link.canonicalEvidenceId === translated?.id,
        ),
      ).toBe(true);

      const finalRound = persisted.rounds.find(
        (round) => round.phase === "final",
      );
      if (finalRound?.outputBoardId === undefined)
        throw new Error("Expected final output board");
      const finalBoard = persisted.boards.find(
        (board) => board.id === finalRound.outputBoardId,
      );
      if (finalBoard === undefined) throw new Error("Expected final board");
      const finalClaimOrigins = persisted.claimOrigins.filter(
        (origin) => origin.boardId === finalBoard.id,
      );
      const finalEvidenceOrigins = persisted.evidenceOrigins.filter(
        (origin) => origin.boardId === finalBoard.id,
      );
      expect(finalClaimOrigins).toHaveLength(10);
      expect(
        finalClaimOrigins.every((origin) =>
          /^claim-\d{4}$/.test(origin.canonicalClaimId),
        ),
      ).toBe(true);
      expect(
        finalEvidenceOrigins.filter(
          (origin) => origin.providerLocalId === "cross-evidence-local",
        ),
      ).toHaveLength(2);
      expect(
        finalEvidenceOrigins.every((origin) =>
          /^evidence-\d{4}$/.test(origin.canonicalEvidenceId),
        ),
      ).toBe(true);
      expect(finalBoard.byteLength).toBeLessThanOrEqual(
        debateConfig.maxBoardBytes,
      );
      expect(report.board.claims).toHaveLength(debateConfig.maxBoardClaims);
      expect(
        persisted.rounds.filter((round) => round.phase === "cross_examination"),
      ).toHaveLength(debateConfig.maxRounds);
      for (const run of persisted.runs) {
        expect(
          Buffer.byteLength(canonicalJson(run.request), "utf8"),
        ).toBeLessThanOrEqual(debateConfig.maxBoardBytes);
      }

      const codexRuns = persisted.runs.filter((run) => run.agentId === "codex");
      const claudeRuns = persisted.runs.filter(
        (run) => run.agentId === "claude",
      );
      expect(
        new Set(codexRuns.map((run) => canonicalJson(run.modelExecution))).size,
      ).toBe(1);
      expect(codexRuns[0]?.modelExecution).toEqual({
        observedModelIds: [],
        verification: "unverified",
      });
      expect(
        new Set(claudeRuns.map((run) => canonicalJson(run.modelExecution)))
          .size,
      ).toBe(1);
      expect(claudeRuns[0]?.modelExecution).toEqual({
        requestedClass: "opus",
        requestedCliModelId: "claude-opus",
        requestedEffort: "high",
        observedModelIds: ["claude-opus-4-20250514"],
        verification: "verified",
      });

      const debateCalls = [
        ...inferenceCalls(harness.codexCalls),
        ...inferenceCalls(harness.claudeCalls),
      ].filter((call) =>
        ["initial", "cross-examination", "final"].includes(
          String(prompt(call)?.phase),
        ),
      );
      expect(debateCalls).toHaveLength(6);
      expect(debateCalls.map((call) => prompt(call)?.phase).sort()).toEqual([
        "cross-examination",
        "cross-examination",
        "final",
        "final",
        "initial",
        "initial",
      ]);
      for (const call of debateCalls.filter(
        (item) => prompt(item)?.phase !== "initial",
      )) {
        expect(prompt(call)?.board).toEqual(expect.any(Object));
        expect(prompt(call)?.reviewClaimIds).toEqual(expect.any(Array));
      }
      for (const call of inferenceCalls(harness.codexCalls)) {
        expect(call.args).toEqual(
          expect.arrayContaining([
            "--sandbox",
            "read-only",
            "--config",
            'windows.sandbox="elevated"',
            "--config",
            'approval_policy="never"',
          ]),
        );
        expect(call.args).not.toContain("--model");
        expect(
          call.args.some((argument) =>
            argument.startsWith("model_reasoning_effort="),
          ),
        ).toBe(false);
        expect(call.command).not.toBe("cmd.exe");
      }
      for (const call of inferenceCalls(harness.claudeCalls)) {
        const settingsIndex = call.args.indexOf("--settings");
        expect(call.args[settingsIndex + 1]).toBe(CLAUDE_SETTINGS);
        expect(call.args).toEqual(
          expect.arrayContaining([
            "--safe-mode",
            "--tools",
            "Read,Glob,Grep",
            "--disallowedTools",
            "mcp__*",
            "--permission-mode",
            "plan",
            "--no-session-persistence",
            "--model",
            "claude-opus",
            "--effort",
            "high",
          ]),
        );
        expect(call.env.CLAUDE_CONFIG_DIR).toBeUndefined();
        expect(call.command).not.toBe("cmd.exe");
      }

      const otherBoard = harness.deliberation.createClaimBoard({
        sessionId: session.id,
        version: 99,
        payload: { claims: [] },
      });
      harness.deliberation.addEvidenceReference({
        boardId: otherBoard.id,
        sessionId: session.id,
        canonicalId: "evidence-cross-board",
        trackedPath: "README.md",
        resolution: "VERIFIED",
      });
      expect(() => {
        harness.database
          .prepare(
            "INSERT INTO evidence_references (board_id,session_id,canonical_id,tracked_path,resolution) VALUES (?,?,?,?,?)",
          )
          .run(
            "missing-board",
            session.id,
            "evidence-orphan",
            "README.md",
            "VERIFIED",
          );
      }).toThrow();
      expect(() => {
        harness.deliberation.linkClaimEvidence({
          boardId: finalBoard.id,
          canonicalClaimId: "claim-0001",
          canonicalEvidenceId: "evidence-cross-board",
        });
      }).toThrow();
      const finalStance = persisted.stances.find(
        (stance) => stance.roundId === finalRound.id,
      );
      if (finalStance === undefined) throw new Error("Expected final stance");
      expect(() => {
        harness.deliberation.linkStanceEvidence({
          stanceId: finalStance.id,
          boardId: otherBoard.id,
          canonicalEvidenceId: "evidence-cross-board",
        });
      }).toThrow();
      expect(await captureGitIntegrity(harness.projectRoot)).toEqual(
        harness.before,
      );
    } finally {
      await harness.cleanup();
    }
  });

  test("real adapters reject forbidden later claims and both provider-local canonical namespaces", async () => {
    const harness = await createHarness();
    try {
      const adapters = [
        {
          adapter: harness.codexAdapter,
          selection: undefined,
        },
        {
          adapter: harness.claudeAdapter,
          selection: {
            class: "opus",
            cliModelId: "claude-opus",
            requestedEffort: "high",
          },
        },
      ] as const;
      for (const { adapter, selection } of adapters) {
        for (const namespace of ["claim", "evidence"] as const) {
          const invalidNamespace = await adapter.run(
            {
              runId: `${adapter.id}-invalid-${namespace}-namespace`,
              projectRoot: harness.projectRoot,
              mode: "observe",
              prompt: JSON.stringify({
                phase: "initial",
                topic: `vertical-invalid-${namespace}-namespace`,
              }),
              timeoutMs: 2_000,
              maxOutputBytes: 16_384,
              responseSchema: InitialPhaseResponseSchema,
              ...(selection === undefined ? {} : { modelSelection: selection }),
            },
            new AbortController().signal,
          );
          expect(invalidNamespace.status).toBe("failed");
          expect(invalidNamespace.structured).toBeUndefined();
          expect(invalidNamespace.diagnostics.join("\n")).toMatch(
            new RegExp(`canonical ${namespace} namespace`, "i"),
          );
        }

        const forbiddenClaim = await adapter.run(
          {
            runId: `${adapter.id}-forbidden-claim`,
            projectRoot: harness.projectRoot,
            mode: "observe",
            prompt: JSON.stringify({
              phase: "cross-examination",
              topic: "vertical-forbidden-later-claim",
              reviewClaimIds: ["claim-0001"],
            }),
            timeoutMs: 2_000,
            maxOutputBytes: 16_384,
            responseSchema: createCrossExaminationPhaseResponseSchema(
              ["claim-0001"],
              [],
            ),
            ...(selection === undefined ? {} : { modelSelection: selection }),
          },
          new AbortController().signal,
        );
        expect(forbiddenClaim.status).toBe("failed");
        expect(forbiddenClaim.structured).toBeUndefined();
        expect(forbiddenClaim.diagnostics.join("\n")).toMatch(/claims/i);
      }
    } finally {
      await harness.cleanup();
    }
  });

  test("provider-default omission persists unverified observations without changing completed status", async () => {
    const harness = await createHarness();
    try {
      const ask = interaction("ask", {
        agent: "claude",
        question: "provider-default",
      });
      ask.interactionId = "provider-default";
      await harness.handler(ask);
      const text = rendered(ask);
      expect(text).toContain("Status: completed");
      expect(text).not.toMatch(/Status: (?:partial|failed)/);
      expect(text).toContain("Requested class: provider default");
      expect(text).toContain("Verification: unverified");
      const session = harness.sessions.findByInteractionId("provider-default");
      if (session === undefined)
        throw new Error("Expected provider-default run");
      const run = harness.sessions.agentRuns(session.id)[0];
      expect(run?.modelExecution).toEqual({
        observedModelIds: ["claude-opus-4-20250514"],
        verification: "unverified",
      });
      const invocation = inferenceCalls(harness.claudeCalls)[0];
      expect(invocation?.args).not.toContain("--model");
      expect(invocation?.args).not.toContain("--effort");
      const settings = invocation?.args.indexOf("--settings") ?? -1;
      expect(invocation?.args[settings + 1]).toBe(CLAUDE_SETTINGS);
      expect(invocation?.args).toContain("--safe-mode");
    } finally {
      await harness.cleanup();
    }
  });

  test("same-class aliases pass while mismatch and absent observation failures retain audit diagnostics", async () => {
    const harness = await createHarness();
    try {
      const renderedById = new Map<string, string>();
      const cases = [
        { id: "alias", question: "alias-version", status: "completed" },
        { id: "mismatch", question: "CROSS_CLASS", status: "failed" },
        { id: "absent", question: "NO_OBSERVATION", status: "failed" },
      ] as const;
      for (const item of cases) {
        const ask = interaction("ask", {
          agent: "claude",
          question: item.question,
          claude_model: "opus",
        });
        ask.interactionId = item.id;
        await harness.handler(ask);
        const text = rendered(ask);
        renderedById.set(item.id, text);
        expect(text).toContain(`Status: ${item.status}`);
      }
      const aliasSession = harness.sessions.findByInteractionId("alias");
      const mismatchSession = harness.sessions.findByInteractionId("mismatch");
      const absentSession = harness.sessions.findByInteractionId("absent");
      if (
        aliasSession === undefined ||
        mismatchSession === undefined ||
        absentSession === undefined
      ) {
        throw new Error("Expected model-observation sessions");
      }
      const alias = harness.sessions.agentRuns(aliasSession.id)[0];
      expect(alias?.modelExecution).toEqual({
        requestedClass: "opus",
        requestedCliModelId: "claude-opus",
        requestedEffort: "high",
        observedModelIds: ["claude-opus-4-20250514"],
        verification: "verified",
      });
      const mismatch = harness.sessions.agentRuns(mismatchSession.id)[0];
      expect(mismatch?.status).toBe("failed");
      expect(mismatch?.modelExecution.observedModelIds).toEqual([
        "claude-sonnet-4",
      ]);
      expect(canonicalJson(mismatch?.diagnostics)).toContain(
        "MODEL_CLASS_CHANGED",
      );
      expect(canonicalJson(mismatch?.diagnostics)).toContain("input_tokens");
      expect(renderedById.get("mismatch")).toContain("Requested class: opus");
      expect(renderedById.get("mismatch")).toContain(
        "Observed model IDs: claude-sonnet-4",
      );
      expect(renderedById.get("mismatch")).toContain("Safe diagnostics");
      const absent = harness.sessions.agentRuns(absentSession.id)[0];
      expect(absent?.status).toBe("failed");
      expect(absent?.modelExecution.observedModelIds).toEqual([]);
      expect(canonicalJson(absent?.diagnostics)).toContain(
        "MODEL_OBSERVATION_UNAVAILABLE",
      );
      expect(renderedById.get("absent")).toContain("Observed model IDs: none");
      expect(renderedById.get("absent")).toContain("Safe diagnostics");
      for (const call of inferenceCalls(harness.claudeCalls)) {
        const settings = call.args.indexOf("--settings");
        expect(call.args[settings + 1]).toBe(CLAUDE_SETTINGS);
        expect(call.args).toContain("--safe-mode");
        expect(call.env.CLAUDE_CONFIG_DIR).toBeUndefined();
      }
    } finally {
      await harness.cleanup();
    }
  });

  test("unknown classes and unsupported effort fail before provider execution", async () => {
    const unknown = await createHarness();
    try {
      const ask = interaction("ask", {
        agent: "claude",
        question: "unknown",
        claude_model: "unknown",
      });
      await unknown.handler(ask);
      expect(rendered(ask)).toContain("not configured");
      expect(unknown.claudeCalls).toHaveLength(0);
      expect(unknown.sessions.recent(1)).toHaveLength(0);
    } finally {
      await unknown.cleanup();
    }

    const effort = await createHarness({ claudeEffort: "ultra" });
    try {
      const ask = interaction("ask", {
        agent: "claude",
        question: "unsupported effort",
        claude_model: "opus",
      });
      await effort.handler(ask);
      expect(rendered(ask)).toContain("cannot be used");
      expect(inferenceCalls(effort.claudeCalls)).toHaveLength(0);
      expect(effort.claudeCalls.map((call) => call.args)).toEqual([
        ["--version"],
        ["--help"],
      ]);
      expect(effort.sessions.recent(1)).toHaveLength(0);
    } finally {
      await effort.cleanup();
    }
  });

  test("explicit Codex selection fails after probes without starting inference", async () => {
    const harness = await createHarness();
    try {
      const ask = interaction("ask", {
        agent: "codex",
        question: "must not execute",
        codex_model: "sol",
      });
      await harness.handler(ask);
      expect(rendered(ask)).toContain("cannot be used");
      expect(inferenceCalls(harness.codexCalls)).toHaveLength(0);
      expect(harness.codexCalls.map((call) => call.args)).toEqual([
        ["--version"],
        ["exec", "--help"],
      ]);
      expect(harness.sessions.recent(1)).toHaveLength(0);
    } finally {
      await harness.cleanup();
    }
  });

  test("DebateConfig rejects every bound and stops an oversized board before later phases", async () => {
    const valid = {
      maxRounds: 1,
      maxBoardClaims: 2,
      maxBoardBytes: 4_096,
    };
    for (const invalid of [
      { ...valid, maxRounds: 0 },
      { ...valid, maxRounds: 6 },
      { ...valid, maxBoardClaims: 1 },
      { ...valid, maxBoardClaims: 201 },
      { ...valid, maxBoardBytes: 4_095 },
      { ...valid, maxBoardBytes: 262_145 },
    ]) {
      expect(DebateConfigSchema.safeParse(invalid).success).toBe(false);
    }

    const harness = await createHarness();
    try {
      await expect(
        harness.debateService.debate(
          {
            scope: { guildId: "guild", channelId: "channel", userId: "user" },
            interactionId: "bounded-board",
            projectId: "demo",
            claudeModel: "opus",
            topic: "vertical-exhaustive",
          },
          { ...debateConfig, maxBoardClaims: 2 },
        ),
      ).rejects.toMatchObject({ code: "DEBATE_CONTEXT_LIMIT" });
      const session = harness.sessions.findByInteractionId("bounded-board");
      if (session === undefined) throw new Error("Expected bounded session");
      expect(session.status).toBe("failed");
      expect(harness.sessions.errors(session.id)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "DEBATE_CONTEXT_LIMIT" }),
        ]),
      );
      const calls = [
        ...inferenceCalls(harness.codexCalls),
        ...inferenceCalls(harness.claudeCalls),
      ];
      expect(calls).toHaveLength(2);
      expect(calls.every((call) => prompt(call)?.phase === "initial")).toBe(
        true,
      );

      const cancellation = new AbortController();
      const hanging = harness.codexAdapter.run(
        {
          runId: "cancelled-vertical-run",
          projectRoot: harness.projectRoot,
          mode: "observe",
          prompt: "HANG",
          timeoutMs: 2_000,
          maxOutputBytes: 16_384,
          responseSchema: InitialPhaseResponseSchema,
        },
        cancellation.signal,
      );
      setTimeout(() => {
        cancellation.abort();
      }, 50);
      await expect(hanging).resolves.toMatchObject({ status: "cancelled" });
      expect(
        inferenceCalls(harness.codexCalls).some(
          (call) => call.stdin === "HANG",
        ),
      ).toBe(true);
    } finally {
      await harness.cleanup();
    }
  });
});
