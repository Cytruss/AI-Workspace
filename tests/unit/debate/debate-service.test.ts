import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";
import { AgentRegistry } from "../../../src/agents/agent-registry.js";
import type { AgentAdapter, AgentRequest } from "../../../src/agents/types.js";
import {
  DebateService,
  DebateServiceError,
} from "../../../src/debate/debate-service.js";
import { ActiveRuns } from "../../../src/orchestrator/active-runs.js";
import { ProjectService } from "../../../src/projects/project-service.js";
import { openDatabase } from "../../../src/storage/database.js";
import { DeliberationRepository } from "../../../src/storage/deliberation-repository.js";
import { migrateDatabase } from "../../../src/storage/migrations.js";
import { ProjectRepository } from "../../../src/storage/project-repository.js";
import { SessionRepository } from "../../../src/storage/session-repository.js";

describe("DebateService", () => {
  test("exposes stable boundary error codes", () => {
    expect(
      new DebateServiceError("PROJECT_REQUIRED", "Select a project"),
    ).toMatchObject({ code: "PROJECT_REQUIRED" });
  });
});

test("persists the exact compact final request board as its reconstructable input snapshot", async () => {
  const root = await mkdtemp(join(tmpdir(), "debate-service-"));
  await promisify(execFile)("git", ["init", "--quiet", root]);
  const requests: AgentRequest[] = [];
  const adapter = (id: "codex" | "claude"): AgentAdapter => ({
    id,
    probe: async () => ({
      available: true,
      nonInteractive: true,
      structuredOutput: true,
      readOnlyEnforcement: true,
      modelOption: { supported: true },
      effortOption: { supported: true },
      observedModelReporting: { supported: false },
      diagnostics: [],
    }),
    run: async (request) => {
      requests.push(request);
      const phase = JSON.parse(request.prompt).phase;
      const structured =
        phase === "initial"
          ? {
              phase,
              evidence: [],
              claims: [
                {
                  localId: `${id}-claim`,
                  text: "A material claim",
                  material: true,
                  evidenceLocalIds: [],
                },
              ],
            }
          : {
              phase,
              newEvidence: [],
              stances: [
                {
                  claimId: "claim-0001",
                  value: "ACCEPT",
                  reasoning: "supported",
                  existingEvidenceIds: [],
                  newEvidenceLocalIds: [],
                },
              ],
            };
      return {
        agentId: id,
        status: "completed",
        durationMs: 1,
        modelExecution: { observedModelIds: [], verification: "unverified" },
        diagnostics: [],
        structured,
      } as never;
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
    activeRuns: new ActiveRuns(),
  });
  const report = await service.debate(
    {
      scope: { guildId: "g", channelId: "c", userId: "u" },
      interactionId: "i",
      projectId: "demo",
      topic: "topic",
    },
    { maxRounds: 1, maxBoardClaims: 2, maxBoardBytes: 4096 },
  );
  const finalRequest = requests.find(
    (request) => JSON.parse(request.prompt).phase === "final",
  ) as AgentRequest;
  const finalRun = sessions
    .agentRuns(report.sessionId)
    .find((run) => run.phase === "final")!;
  expect(deliberation.reconstructAgentCall(finalRun.id).inputBoard).toEqual(
    JSON.parse(finalRequest.prompt).board,
  );
  database.close();
});
