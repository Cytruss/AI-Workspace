import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";
import { AgentRegistry } from "../../src/agents/agent-registry.js";
import { ClaudeAdapter } from "../../src/agents/claude-adapter.js";
import { CodexAdapter } from "../../src/agents/codex-adapter.js";
import {
  runProcess,
  type ProcessRequest,
} from "../../src/platform/process-runner.js";
import { captureGitIntegrity } from "../../src/permissions/git-integrity.js";
import { DebateService } from "../../src/debate/debate-service.js";
import { ActiveRuns } from "../../src/orchestrator/active-runs.js";
import { AskService } from "../../src/orchestrator/ask-service.js";
import { ProjectService } from "../../src/projects/project-service.js";
import { openDatabase } from "../../src/storage/database.js";
import { DeliberationRepository } from "../../src/storage/deliberation-repository.js";
import { migrateDatabase } from "../../src/storage/migrations.js";
import { ProjectRepository } from "../../src/storage/project-repository.js";
import { SessionRepository } from "../../src/storage/session-repository.js";
import {
  createCommandHandler,
  type InteractionPort,
} from "../../src/transport/discord/command-handler.js";

const exec = promisify(execFile);
const codexCli = fileURLToPath(
  new URL("../fake-agents/codex-cli.mjs", import.meta.url),
);
const claudeCli = fileURLToPath(
  new URL("../fake-agents/claude-cli.mjs", import.meta.url),
);

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
  const port: InteractionPort & { replies: unknown[]; edits: unknown[] } = {
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
  };
  return port;
}

describe("dual-agent vertical slice", () => {
  test("handles models, ask, and debate without changing the selected Git project", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "ai-workspace-vertical-"));
    await exec("git", ["init", "--quiet", projectRoot]);
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
    const sessionRepository = new SessionRepository(database);
    const activeRuns = new ActiveRuns();
    const codexCalls: ProcessRequest[] = [];
    const claudeCalls: ProcessRequest[] = [];
    const config = {
      concurrency: 2,
      agents: {
        codex: {
          command: "fake",
          timeoutMs: 1_000,
          maxOutputBytes: 4_096,
          models: {
            selections: [
              {
                class: "sol",
                cliModelId: "gpt-sol",
                acceptedObservedModels: {
                  exactIds: ["gpt-sol"],
                  literalPrefixes: [],
                },
              },
            ],
          },
        },
        claude: {
          command: "fake",
          timeoutMs: 1_000,
          maxOutputBytes: 4_096,
          models: {
            selections: [
              {
                class: "opus",
                cliModelId: "claude-opus",
                acceptedObservedModels: {
                  exactIds: [],
                  literalPrefixes: ["claude-opus-"],
                },
              },
            ],
          },
        },
      },
    };
    const registry = new AgentRegistry([
      new CodexAdapter(config.agents.codex, {
        runProcess: fixtureRunner(codexCli, codexCalls),
      }),
      new ClaudeAdapter(config.agents.claude, {
        runProcess: fixtureRunner(claudeCli, claudeCalls),
      }),
    ]);
    const askService = new AskService({
      config,
      registry,
      projects,
      projectRepository,
      sessions: sessionRepository,
      activeRuns,
    });
    const debateService = new DebateService({
      config,
      registry,
      projects,
      sessions: sessionRepository,
      deliberation: new DeliberationRepository(database),
      activeRuns,
    });
    const handler = createCommandHandler({
      config: {
        guildIds: ["guild"],
        allowedUserIds: ["user"],
        models: {
          codex: config.agents.codex.models,
          claude: config.agents.claude.models,
        },
        debate: { maxRounds: 1, maxBoardClaims: 2, maxBoardBytes: 4_096 },
      },
      projects,
      projectRepository,
      askService,
      debateService,
      activeRuns,
      sessions: sessionRepository,
    });

    const models = interaction("models");
    await handler(models);
    expect(JSON.stringify(models.replies)).toContain("sol");
    expect(JSON.stringify(models.replies)).toContain("opus");
    const ask = interaction("ask", {
      agent: "both",
      question: "Summarize",
      codex_model: "sol",
      claude_model: "opus",
    });
    await handler(ask);
    expect(JSON.stringify(ask.edits)).toContain("Codex");
    expect(JSON.stringify(ask.edits)).toContain("Claude");
    const debate = interaction("debate", {
      topic: "Review",
      project: "demo",
      codex_model: "sol",
      claude_model: "opus",
    });
    await handler(debate);

    expect(sessionRepository.recent(1)).toHaveLength(1);
    expect(codexCalls.some((call) => call.args.includes("--sandbox"))).toBe(
      true,
    );
    expect(
      codexCalls.some((call) => call.args.includes("--output-schema")),
    ).toBe(true);
    expect(claudeCalls.some((call) => call.args.includes("--bare"))).toBe(true);
    expect(
      claudeCalls.some((call) => call.args.includes("--json-schema")),
    ).toBe(true);
    expect(
      [...codexCalls, ...claudeCalls].every(
        (call) => call.command !== "cmd.exe",
      ),
    ).toBe(true);
    const latest = sessionRepository.recent(1)[0];
    if (latest === undefined) throw new Error("Expected a persisted session");
    expect(
      sessionRepository
        .agentRuns(latest.id)
        .some((run) => run.modelExecution.verification === "verified"),
    ).toBe(true);
    expect(await captureGitIntegrity(projectRoot)).toEqual(before);
    database.close();
  });
});
