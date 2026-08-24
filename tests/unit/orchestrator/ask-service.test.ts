import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, test, vi } from "vitest";
import {
  AgentBoundaryError,
  AgentRegistry,
} from "../../../src/agents/agent-registry.js";
import type {
  AgentAdapter,
  AgentCapabilities,
  AgentRequest,
  AgentResult,
} from "../../../src/agents/types.js";
import {
  AskService,
  AskServiceError,
} from "../../../src/orchestrator/ask-service.js";
import { ActiveRuns } from "../../../src/orchestrator/active-runs.js";
import { ProjectService } from "../../../src/projects/project-service.js";
import { openDatabase } from "../../../src/storage/database.js";
import { migrateDatabase } from "../../../src/storage/migrations.js";
import { ProjectRepository } from "../../../src/storage/project-repository.js";
import { SessionRepository } from "../../../src/storage/session-repository.js";

const execute = promisify(execFile);
const capability: AgentCapabilities = {
  available: true,
  nonInteractive: true,
  structuredOutput: true,
  readOnlyEnforcement: true,
  modelOption: { supported: true },
  effortOption: { supported: true, allowedValues: ["high"] },
  observedModelReporting: { supported: false },
  diagnostics: [],
};

async function setup(
  adapters: readonly AgentAdapter[],
  models: {
    codex?: Record<string, unknown>;
    claude?: Record<string, unknown>;
  } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "ai-workspace-ask-"));
  await execute("git", ["init", "--quiet", root]);
  const projects = await ProjectService.create([
    { id: "demo", name: "Demo", root },
  ]);
  const database = openDatabase(":memory:");
  migrateDatabase(database);
  const projectRepository = new ProjectRepository(database);
  projectRepository.upsert(projects.get("demo"));
  const sessions = new SessionRepository(database);
  const activeRuns = new ActiveRuns();
  return {
    database,
    sessions,
    activeRuns,
    service: new AskService({
      config: {
        concurrency: 2,
        agents: {
          codex: {
            command: "codex",
            timeoutMs: 1_000,
            maxOutputBytes: 1_024,
            models: { selections: [], ...models.codex },
          },
          claude: {
            command: "claude",
            timeoutMs: 1_000,
            maxOutputBytes: 1_024,
            models: { selections: [], ...models.claude },
          },
        },
      },
      registry: new AgentRegistry(adapters),
      projects,
      projectRepository,
      sessions,
      activeRuns,
    }),
  };
}

interface TestAdapter extends AgentAdapter {
  lastRequest: AgentRequest | undefined;
  probeCount: number;
  runCount: number;
}

function adapter(id: "codex" | "claude", result: AgentResult): TestAdapter {
  const fake: TestAdapter = {
    id,
    lastRequest: undefined,
    probeCount: 0,
    runCount: 0,
    probe: vi.fn(),
    run: vi.fn(),
  };
  fake.probe = vi.fn(() => {
    fake.probeCount += 1;
    return Promise.resolve(capability);
  });
  fake.run = vi.fn((request: AgentRequest) => {
    fake.lastRequest = request;
    fake.runCount += 1;
    return Promise.resolve(result);
  });
  return fake;
}

function result(
  agentId: "codex" | "claude",
  response = `${agentId} answer`,
): AgentResult {
  return {
    agentId,
    status: "completed",
    response,
    exitCode: 0,
    durationMs: 1,
    modelExecution: { observedModelIds: [], verification: "unverified" },
    diagnostics: [],
  };
}

const input = {
  scope: { guildId: "g", channelId: "c", userId: "u" },
  interactionId: "interaction-1",
  projectId: "demo",
  selection: "both" as const,
  question: "Explain authentication",
};

describe("AskService", () => {
  test("returns both results in Codex then Claude order and persists their lifecycle", async () => {
    const codex = adapter("codex", result("codex"));
    const claude = adapter("claude", result("claude"));
    const { database, service, sessions } = await setup([claude, codex]);

    const report = await service.ask(input);

    expect(report.status).toBe("completed");
    expect(report.results.map((entry) => entry.agentId)).toEqual([
      "codex",
      "claude",
    ]);
    expect(sessions.get(report.sessionId).status).toBe("completed");
    expect(sessions.messages(report.sessionId)).toHaveLength(1);
    expect(codex.lastRequest).not.toHaveProperty("modelSelection");
    database.close();
  });

  test("returns a persisted terminal report and rejects duplicate active delivery", async () => {
    const codex = adapter("codex", result("codex"));
    const { database, service } = await setup([codex]);
    const one = await service.ask({ ...input, selection: "codex" });
    const duplicate = await service.ask({ ...input, selection: "codex" });
    expect(duplicate).toEqual(one);

    const waiting = new Promise<AgentResult>(() => {});
    const live = adapter("codex", result("codex"));
    live.run = vi.fn().mockReturnValueOnce(waiting);
    const concurrent = await setup([live]);
    void concurrent.service.ask({
      ...input,
      interactionId: "in-progress",
      selection: "codex",
    });
    await Promise.resolve();
    await expect(
      concurrent.service.ask({
        ...input,
        interactionId: "in-progress",
        selection: "codex",
      }),
    ).rejects.toBeInstanceOf(AskServiceError);
    database.close();
    concurrent.database.close();
  });

  test("resolves separate immutable concrete selections before invoking either agent", async () => {
    const codex = adapter("codex", result("codex"));
    const claude = adapter("claude", result("claude"));
    const { database, service } = await setup([codex, claude], {
      codex: {
        defaultModel: "sol",
        selections: [
          {
            class: "terra",
            cliModelId: "gpt-terra",
            acceptedObservedModels: {
              exactIds: ["gpt-terra"],
              literalPrefixes: [],
            },
          },
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
      claude: {
        defaultModel: "sonnet",
        selections: [
          {
            class: "sonnet",
            cliModelId: "claude-sonnet",
            acceptedObservedModels: {
              exactIds: ["claude-sonnet"],
              literalPrefixes: [],
            },
          },
        ],
      },
    });

    await service.ask({ ...input, codexModel: "terra" });

    const codexSelection = codex.lastRequest?.modelSelection;
    const claudeSelection = claude.lastRequest?.modelSelection;
    expect(codexSelection).toEqual({ class: "terra", cliModelId: "gpt-terra" });
    expect(claudeSelection).toEqual({
      class: "sonnet",
      cliModelId: "claude-sonnet",
    });
    expect(Object.isFrozen(codexSelection)).toBe(true);
    database.close();
  });

  test("rejects an unknown model class before persistence or adapter execution", async () => {
    const codex = adapter("codex", result("codex"));
    const { database, service, sessions } = await setup([codex]);

    await expect(
      service.ask({ ...input, selection: "codex", codexModel: "unknown" }),
    ).rejects.toBeInstanceOf(AgentBoundaryError);
    expect(codex.probeCount).toBe(0);
    expect(codex.runCount).toBe(0);
    expect(sessions.findByInteractionId(input.interactionId)).toBeUndefined();
    database.close();
  });

  test("reports partial when one selected agent fails", async () => {
    const failed = {
      ...result("claude"),
      status: "failed" as const,
      exitCode: 1,
    };
    delete failed.response;
    const { database, service } = await setup([
      adapter("codex", result("codex")),
      adapter("claude", failed),
    ]);

    const report = await service.ask(input);

    expect(report.status).toBe("partial");
    expect(report.results.map((entry) => entry.status)).toEqual([
      "completed",
      "failed",
    ]);
    database.close();
  });

  test("cancels an active owner run and persists a cancelled session", async () => {
    const codex: AgentAdapter = {
      id: "codex",
      probe: vi.fn().mockResolvedValue(capability),
      run: vi.fn().mockImplementation(
        (_request, signal: AbortSignal) =>
          new Promise<AgentResult>((_resolve, reject) => {
            signal.addEventListener("abort", () => {
              reject(new DOMException("cancelled", "AbortError"));
            });
          }),
      ),
    };
    const { activeRuns, database, service, sessions } = await setup([codex]);
    const pending = service.ask({ ...input, selection: "codex" });
    for (
      let index = 0;
      index < 10 && activeRuns.list().length === 0;
      index += 1
    ) {
      await Promise.resolve();
    }
    const runId = activeRuns.list()[0]?.runId;
    expect(runId).toBeDefined();
    expect(activeRuns.cancel(runId as string, input.scope.userId)).toBe(true);

    const report = await pending;

    expect(report.status).toBe("cancelled");
    expect(sessions.get(report.sessionId).status).toBe("cancelled");
    database.close();
  });
});
