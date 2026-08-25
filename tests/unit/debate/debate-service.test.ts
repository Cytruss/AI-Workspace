import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";
import { AgentRegistry } from "../../../src/agents/agent-registry.js";
import { ClaudeAdapter } from "../../../src/agents/claude-adapter.js";
import { CodexAdapter } from "../../../src/agents/codex-adapter.js";
import type { ClaimBoard } from "../../../src/agents/structured-response.js";
import type { AgentAdapter, AgentRequest } from "../../../src/agents/types.js";
import type { AgentConfig, DebateConfig } from "../../../src/config/schema.js";
import {
  DebateService,
  DebateServiceError,
} from "../../../src/debate/debate-service.js";
import { ActiveRuns } from "../../../src/orchestrator/active-runs.js";
import {
  runProcess,
  type ProcessRequest,
} from "../../../src/platform/process-runner.js";
import { ProjectService } from "../../../src/projects/project-service.js";
import { openDatabase } from "../../../src/storage/database.js";
import { DeliberationRepository } from "../../../src/storage/deliberation-repository.js";
import { migrateDatabase } from "../../../src/storage/migrations.js";
import { ProjectRepository } from "../../../src/storage/project-repository.js";
import {
  canonicalJson,
  SessionRepository,
} from "../../../src/storage/session-repository.js";

const DEFAULT_CONFIG: DebateConfig = {
  maxRounds: 1,
  maxBoardClaims: 2,
  maxBoardBytes: 4096,
};
const snapshot = { porcelainV2: "", dirtyPathFingerprints: "[]" };
const codexCli = fileURLToPath(
  new URL("../../fake-agents/codex-cli.mjs", import.meta.url),
);
const claudeCli = fileURLToPath(
  new URL("../../fake-agents/claude-cli.mjs", import.meta.url),
);

interface HarnessOptions {
  finalOutcome?: "completed" | "failed" | "cancelled";
  crossStance?: "ACCEPT" | "UNCERTAIN";
  initialClaimTexts?: Readonly<Record<"codex" | "claude", readonly string[]>>;
  topic?: string;
  initialContent?: Readonly<Record<"codex" | "claude", string>>;
  crossAddsEvidence?: boolean;
}

interface DebatePrompt {
  phase: "initial" | "cross-examination" | "final";
  board?: ClaimBoard;
  reviewClaimIds?: readonly string[];
}

function parsePrompt(request: AgentRequest): DebatePrompt {
  return JSON.parse(request.prompt) as DebatePrompt;
}

function fixtureRunner(
  script: string,
  afterResult?: (request: ProcessRequest) => void,
) {
  return async (request: ProcessRequest) => {
    const result = await runProcess({
      ...request,
      command: process.execPath,
      args: [script, ...request.args],
    });
    afterResult?.(request);
    return result;
  };
}

async function createHarness(options: HarnessOptions = {}) {
  const root = await mkdtemp(join(tmpdir(), "debate-service-"));
  await promisify(execFile)("git", ["init", "--quiet", root]);
  const requests: AgentRequest[] = [];
  const activeRuns = new ActiveRuns();
  const finalOutcome = options.finalOutcome ?? "completed";
  const claimTexts =
    options.initialClaimTexts ??
    ({
      codex: ["A material claim"],
      claude: ["A material claim"],
    } as const);
  const result = (
    id: "codex" | "claude",
    status: "completed" | "failed" | "cancelled",
    structured?: object,
    response?: string,
  ) =>
    ({
      agentId: id,
      status,
      durationMs: 1,
      modelExecution: { observedModelIds: [], verification: "unverified" },
      diagnostics: [],
      ...(structured === undefined ? {} : { structured }),
      ...(response === undefined ? {} : { response }),
    }) as never;
  const adapter = (id: "codex" | "claude"): AgentAdapter => ({
    id,
    probe: () =>
      Promise.resolve({
        available: true,
        nonInteractive: true,
        structuredOutput: true,
        readOnlyEnforcement: true,
        modelOption: { supported: true },
        effortOption: { supported: true },
        observedModelReporting: { supported: true },
        diagnostics: [],
      }),
    run: (request) => {
      requests.push(request);
      const prompt = parsePrompt(request);
      if (prompt.phase === "final" && finalOutcome !== "completed") {
        if (finalOutcome === "cancelled") activeRuns.cancelAll();
        return Promise.resolve(result(id, finalOutcome));
      }
      if (prompt.phase === "initial") {
        const evidenceLocalId = `${id}-evidence`;
        return Promise.resolve(
          result(
            id,
            "completed",
            {
              phase: "initial",
              evidence: [
                { localId: evidenceLocalId, trackedPath: "missing.ts" },
              ],
              claims: claimTexts[id].map((text, index) => ({
                localId: `${id}-claim-${String(index + 1)}`,
                text,
                material: true,
                evidenceLocalIds: [evidenceLocalId],
              })),
            },
            options.initialContent?.[id],
          ),
        );
      }
      return Promise.resolve(
        result(id, "completed", {
          phase: prompt.phase,
          newEvidence:
            prompt.phase === "cross-examination" && options.crossAddsEvidence
              ? [
                  {
                    localId: `${id}-cross-evidence`,
                    trackedPath: `${id}-cross.ts`,
                  },
                ]
              : [],
          stances: (prompt.reviewClaimIds ?? []).map((claimId) => ({
            claimId,
            value:
              prompt.phase === "cross-examination"
                ? (options.crossStance ?? "ACCEPT")
                : "ACCEPT",
            reasoning: "supported",
            existingEvidenceIds: [],
            newEvidenceLocalIds:
              prompt.phase === "cross-examination" && options.crossAddsEvidence
                ? [`${id}-cross-evidence`]
                : [],
          })),
        }),
      );
    },
  });
  const projects = await ProjectService.create([
    { id: "demo", name: "Demo", root },
  ]);
  const database = openDatabase(":memory:");
  migrateDatabase(database);
  new ProjectRepository(database).upsert(projects.get("demo"));
  const sessions = new SessionRepository(database);
  const deliberation = new DeliberationRepository(database);
  const service = new DebateService({
    config: {
      concurrency: 2,
      agents: {
        codex: {
          command: "x",
          timeoutMs: 1000,
          maxOutputBytes: 1024,
          models: { selections: [] },
        },
        claude: {
          command: "x",
          timeoutMs: 1000,
          maxOutputBytes: 1024,
          models: { selections: [] },
        },
      },
    },
    registry: new AgentRegistry([adapter("codex"), adapter("claude")]),
    projects,
    sessions,
    deliberation,
    activeRuns,
  });
  return {
    activeRuns,
    database,
    deliberation,
    input: {
      scope: { guildId: "g", channelId: "c", userId: "u" },
      interactionId: `i-${String(Math.random())}`,
      projectId: "demo",
      topic: options.topic ?? "topic",
    },
    requests,
    service,
    sessions,
  };
}

describe("DebateService", () => {
  test("reconstructs a complete terminal report for a repeated interaction", async () => {
    const harness = await createHarness();
    const original = await harness.service.debate(
      harness.input,
      DEFAULT_CONFIG,
    );
    const replay = harness.service.persistedReport(harness.input.interactionId);

    expect(replay).toEqual(original);
    harness.database.close();
  });

  test("replays persisted nonempty initial analysis content", async () => {
    const harness = await createHarness({
      initialContent: {
        codex: "Codex initial analysis",
        claude: "Claude initial analysis",
      },
    });
    await harness.service.debate(harness.input, DEFAULT_CONFIG);

    expect(
      harness.service.persistedReport(harness.input.interactionId)?.analyses,
    ).toEqual([
      expect.objectContaining({
        agentId: "codex",
        content: "Codex initial analysis",
      }),
      expect.objectContaining({
        agentId: "claude",
        content: "Claude initial analysis",
      }),
    ]);
    harness.database.close();
  });

  test("exposes stable boundary error codes", () => {
    expect(
      new DebateServiceError("PROJECT_REQUIRED", "Select a project"),
    ).toMatchObject({ code: "PROJECT_REQUIRED" });
  });

  test("persists every compact happy-path board as a reconstructable normalized snapshot", async () => {
    const harness = await createHarness();
    const report = await harness.service.debate(harness.input, DEFAULT_CONFIG);
    const finalRequest = harness.requests.find(
      (request) => parsePrompt(request).phase === "final",
    ) as AgentRequest;
    const finalRun = harness.sessions
      .agentRuns(report.sessionId)
      .find((run) => run.phase === "final");
    expect(finalRun).toBeDefined();
    if (finalRun === undefined) throw new Error("Missing final run");
    expect(
      harness.deliberation.reconstructAgentCall(finalRun.id).inputBoard,
    ).toEqual(parsePrompt(finalRequest).board);

    const persisted = harness.deliberation.load(report.sessionId);
    for (const board of persisted.boards) {
      expect(
        persisted.claims.filter((claim) => claim.boardId === board.id),
      ).toHaveLength(1);
      expect(
        persisted.claimOrigins.filter((origin) => origin.boardId === board.id),
      ).toHaveLength(2);
      expect(
        persisted.evidenceReferences.filter(
          (evidence) => evidence.boardId === board.id,
        ),
      ).toHaveLength(1);
      expect(
        persisted.evidenceOrigins.filter(
          (origin) => origin.boardId === board.id,
        ),
      ).toHaveLength(2);
    }
    harness.database.close();
  });

  test("supplies cross-examination evidence with its claim in the final provider context", async () => {
    const harness = await createHarness({ crossAddsEvidence: true });

    await harness.service.debate(harness.input, {
      ...DEFAULT_CONFIG,
      maxBoardBytes: 16_384,
    });

    const finalPrompt = harness.requests
      .map(parsePrompt)
      .find((request) => request.phase === "final");
    expect(
      finalPrompt?.board?.evidence.map((item) => item.trackedPath),
    ).toEqual(["missing.ts", "claude-cross.ts", "codex-cross.ts"]);
    expect(finalPrompt?.board?.claims[0]?.evidenceIds).toHaveLength(3);
    harness.database.close();
  });

  test("persists a failed final outcome as a partial debate with unresolved verdicts", async () => {
    const harness = await createHarness({ finalOutcome: "failed" });
    const report = await harness.service.debate(harness.input, DEFAULT_CONFIG);

    expect(report).toMatchObject({
      status: "partial",
      classification: "DEBATE",
    });
    expect(report.rounds.at(-1)).toMatchObject({
      phase: "final",
      status: "failed",
    });
    expect(report.unresolved.map((verdict) => verdict.claimId)).toEqual([
      "claim-0001",
    ]);
    expect(harness.sessions.get(report.sessionId).status).toBe("partial");
    expect(
      harness.sessions
        .agentRuns(report.sessionId)
        .filter((run) => run.phase === "final")
        .map((run) => run.status),
    ).toEqual(["failed", "failed"]);
    expect(
      harness.deliberation.load(report.sessionId).verdicts[0],
    ).toMatchObject({ classification: "UNRESOLVED" });
    harness.database.close();
  });

  test("persists a cancelled final outcome and unregisters the active debate", async () => {
    const harness = await createHarness({ finalOutcome: "cancelled" });
    const report = await harness.service.debate(harness.input, DEFAULT_CONFIG);

    expect(report).toMatchObject({
      status: "cancelled",
      classification: "DEBATE",
    });
    expect(report.rounds.at(-1)).toMatchObject({
      phase: "final",
      status: "cancelled",
    });
    expect(report.unresolved.map((verdict) => verdict.claimId)).toEqual([
      "claim-0001",
    ]);
    expect(harness.sessions.get(report.sessionId).status).toBe("cancelled");
    expect(harness.activeRuns.list()).toEqual([]);
    harness.database.close();
  });

  test("persists a completed real-provider final position before its peer aborts", async () => {
    const root = await mkdtemp(join(tmpdir(), "debate-service-real-"));
    await promisify(execFile)("git", ["init", "--quiet", root]);
    const activeRuns = new ActiveRuns();
    const agentConfig: AgentConfig = {
      command: "configured-provider",
      timeoutMs: 2_000,
      maxOutputBytes: 16_384,
      models: { selections: [] },
    };
    const cancelAfterCodexFinal = (request: ProcessRequest) => {
      if (request.stdin === undefined) return;
      const prompt: unknown = JSON.parse(request.stdin);
      if (
        typeof prompt === "object" &&
        prompt !== null &&
        (prompt as { phase?: unknown }).phase === "final"
      ) {
        activeRuns.cancelAll();
      }
    };
    const codex = new CodexAdapter(agentConfig, {
      runProcess: fixtureRunner(codexCli, cancelAfterCodexFinal),
      captureGitIntegrity: () => Promise.resolve(snapshot),
    });
    const claude = new ClaudeAdapter(agentConfig, {
      runProcess: fixtureRunner(claudeCli),
      captureGitIntegrity: () => Promise.resolve(snapshot),
    });
    const projects = await ProjectService.create([
      { id: "real", name: "Real fake providers", root },
    ]);
    const database = openDatabase(":memory:");
    migrateDatabase(database);
    new ProjectRepository(database).upsert(projects.get("real"));
    const sessions = new SessionRepository(database);
    const deliberation = new DeliberationRepository(database);
    const service = new DebateService({
      config: {
        concurrency: 2,
        agents: { codex: agentConfig, claude: agentConfig },
      },
      registry: new AgentRegistry([codex, claude]),
      projects,
      sessions,
      deliberation,
      activeRuns,
    });

    const report = await service.debate(
      {
        scope: { guildId: "g", channelId: "c", userId: "u" },
        interactionId: "mixed-real-final-cancellation",
        projectId: "real",
        topic: "mixed-final-cancellation",
      },
      DEFAULT_CONFIG,
    );

    expect(report).toMatchObject({
      status: "cancelled",
      classification: "DEBATE",
    });
    expect(report.rounds.at(-1)).toMatchObject({
      phase: "final",
      status: "cancelled",
    });
    expect(report.unresolved.map((verdict) => verdict.claimId)).toEqual([
      "claim-0001",
    ]);
    expect(
      Object.fromEntries(
        sessions
          .agentRuns(report.sessionId)
          .filter((run) => run.phase === "final")
          .map((run) => [run.agentId, run.status]),
      ),
    ).toEqual({ claude: "cancelled", codex: "completed" });
    const persisted = deliberation.load(report.sessionId);
    expect(persisted.finalPositions).toMatchObject([
      {
        agentId: "codex",
        position: {
          phase: "final",
          stances: [{ claimId: "claim-0001", value: "ACCEPT" }],
        },
      },
    ]);
    expect(persisted.verdicts).toMatchObject([
      { canonicalClaimId: "claim-0001", classification: "UNRESOLVED" },
    ]);
    expect(activeRuns.list()).toEqual([]);
    database.close();
  }, 15_000);

  test("enforces the effective claim bound before any later provider call", async () => {
    const harness = await createHarness({
      initialClaimTexts: {
        codex: ["Codex one", "Codex two"],
        claude: ["Claude one", "Claude two"],
      },
    });

    await expect(
      harness.service.debate(harness.input, DEFAULT_CONFIG),
    ).rejects.toMatchObject({ code: "DEBATE_CONTEXT_LIMIT" });
    expect(harness.requests).toHaveLength(2);
    harness.database.close();
  });

  test("rechecks the full request bound after a 9-to-10 snapshot version transition", async () => {
    const calibration = await createHarness({ crossStance: "UNCERTAIN" });
    await calibration.service.debate(calibration.input, {
      ...DEFAULT_CONFIG,
      maxRounds: 5,
      maxBoardBytes: 16_384,
    });
    const versionTenRequest = calibration.requests
      .map(parsePrompt)
      .find(
        (request) =>
          request.phase === "cross-examination" &&
          request.board?.version === 10,
      );
    expect(versionTenRequest).toBeDefined();
    if (versionTenRequest?.board === undefined)
      throw new Error("Missing version 10 request board");
    const versionNineBytes = Buffer.byteLength(
      canonicalJson({
        ...versionTenRequest,
        board: { ...versionTenRequest.board, version: 9 },
      }),
      "utf8",
    );
    calibration.database.close();

    const bounded = await createHarness({ crossStance: "UNCERTAIN" });
    await expect(
      bounded.service.debate(bounded.input, {
        ...DEFAULT_CONFIG,
        maxRounds: 5,
        maxBoardBytes: versionNineBytes,
      }),
    ).rejects.toMatchObject({ code: "DEBATE_CONTEXT_LIMIT" });
    expect(
      bounded.requests.filter(
        (request) => parsePrompt(request).phase === "cross-examination",
      ),
    ).toHaveLength(8);
    bounded.database.close();
  });
});
