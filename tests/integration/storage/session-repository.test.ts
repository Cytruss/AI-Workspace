import { describe, expect, test } from "vitest";
import { openDatabase } from "../../../src/storage/database.js";
import { migrateDatabase } from "../../../src/storage/migrations.js";
import { ProjectRepository } from "../../../src/storage/project-repository.js";
import { SessionRepository } from "../../../src/storage/session-repository.js";

function setup() {
  const database = openDatabase(":memory:");
  migrateDatabase(database);
  const projects = new ProjectRepository(database);
  projects.upsert({ id: "demo", name: "Demo", root: "/canonical/demo" });
  return { database, projects, sessions: new SessionRepository(database) };
}

describe("project and session repositories", () => {
  test("upserts projects and scopes active selection to guild, channel, and user", () => {
    const { database, projects } = setup();
    projects.setActive({ guildId: "g", channelId: "c", userId: "u" }, "demo");
    projects.upsert({ id: "demo", name: "Renamed", root: "/canonical/demo" });
    expect(
      projects.getActive({ guildId: "g", channelId: "c", userId: "u" }),
    ).toEqual({ id: "demo", name: "Renamed", root: "/canonical/demo" });
    expect(
      projects.getActive({ guildId: "g", channelId: "other", userId: "u" }),
    ).toBeUndefined();
    database.close();
  });

  test("moves a session through the valid queued-running-completed lifecycle", () => {
    const { database, sessions } = setup();
    const session = sessions.create({
      interactionId: "interaction-1",
      command: "ask",
      projectId: "demo",
      guildId: "g1",
      channelId: "c1",
      userId: "u1",
      question: "Explain the project",
    });
    sessions.markRunning(session.id);
    sessions.markCompleted(session.id);
    expect(sessions.get(session.id).status).toBe("completed");
    expect(sessions.findByInteractionId("interaction-1")?.id).toBe(session.id);
    expect(() => {
      sessions.markRunning(session.id);
    }).toThrow(/transition/i);
    database.close();
  });

  test("persists messages, errors, default and explicit model executions", () => {
    const { database, sessions } = setup();
    const session = sessions.create({
      interactionId: "i",
      command: "debate",
      projectId: "demo",
      guildId: "g",
      channelId: "c",
      userId: "u",
      question: "Q",
      debateConfig: { maxRounds: 2 },
    });
    sessions.addMessage({ sessionId: session.id, role: "user", content: "Q" });
    sessions.createAgentRun({
      id: "default-run",
      sessionId: session.id,
      agentId: "codex",
      phase: "initial",
      purpose: "draft",
      modelExecution: {
        observedModelIds: ["gpt-default"],
        verification: "unverified",
      },
      request: { phase: "initial" },
    });
    sessions.createAgentRun({
      id: "explicit-run",
      sessionId: session.id,
      agentId: "claude",
      phase: "final",
      purpose: "position",
      modelExecution: {
        requestedClass: "sonnet",
        requestedCliModelId: "claude-sonnet",
        requestedEffort: "high",
        observedModelIds: ["claude-sonnet-5"],
        verification: "verified",
      },
      request: { phase: "final" },
    });
    sessions.finishAgentRun({
      id: "explicit-run",
      status: "completed",
      response: { phase: "final", stances: [] },
      exitCode: 0,
      diagnostics: { safe: true },
    });
    sessions.addError({
      sessionId: session.id,
      code: "MODEL_CLASS_CHANGED",
      message: "changed",
      context: { runId: "explicit-run" },
    });
    expect(sessions.getAgentRun("default-run").modelExecution).toEqual({
      observedModelIds: ["gpt-default"],
      verification: "unverified",
    });
    expect(sessions.getAgentRun("explicit-run").modelExecution).toEqual({
      requestedClass: "sonnet",
      requestedCliModelId: "claude-sonnet",
      requestedEffort: "high",
      observedModelIds: ["claude-sonnet-5"],
      verification: "verified",
    });
    expect(sessions.messages(session.id)).toHaveLength(1);
    expect(sessions.errors(session.id)).toHaveLength(1);
    database.close();
  });

  test("rejects malformed model observations and provider-default verification", () => {
    const { database, sessions } = setup();
    const session = sessions.create({
      interactionId: "i",
      command: "ask",
      projectId: "demo",
      guildId: "g",
      channelId: "c",
      userId: "u",
      question: "Q",
    });
    const base = {
      sessionId: session.id,
      agentId: "codex",
      phase: "ask",
      purpose: "answer",
      request: {},
    } as const;
    expect(() => {
      sessions.createAgentRun({
        ...base,
        id: "dup",
        modelExecution: {
          observedModelIds: ["x", "x"],
          verification: "unverified",
        },
      });
    }).toThrow(/unique/i);
    expect(() => {
      sessions.createAgentRun({
        ...base,
        id: "sort",
        modelExecution: {
          observedModelIds: ["z", "a"],
          verification: "unverified",
        },
      });
    }).toThrow(/sorted/i);
    expect(() => {
      sessions.createAgentRun({
        ...base,
        id: "verified",
        modelExecution: { observedModelIds: ["x"], verification: "verified" },
      });
    }).toThrow(/explicit/i);
    database.close();
  });

  test("retains attempted model execution and bounded diagnostics on verification failures", () => {
    const { database, sessions } = setup();
    const session = sessions.create({
      interactionId: "failure",
      command: "debate",
      projectId: "demo",
      guildId: "g",
      channelId: "c",
      userId: "u",
      question: "Q",
    });
    sessions.createAgentRun({
      id: "mismatch",
      sessionId: session.id,
      agentId: "claude",
      phase: "initial",
      purpose: "draft",
      modelExecution: {
        requestedClass: "sonnet",
        requestedCliModelId: "sonnet-alias",
        observedModelIds: ["opus-5"],
        verification: "unverified",
      },
      request: { phase: "initial" },
    });
    sessions.finishAgentRun({
      id: "mismatch",
      status: "failed",
      diagnostics: { code: "MODEL_CLASS_CHANGED", observed: ["opus-5"] },
    });
    const persisted = sessions.getAgentRun("mismatch");
    expect(persisted.status).toBe("failed");
    expect(persisted.modelExecution).toMatchObject({
      requestedClass: "sonnet",
      requestedCliModelId: "sonnet-alias",
      observedModelIds: ["opus-5"],
      verification: "unverified",
    });
    expect(persisted.diagnostics).toEqual({
      code: "MODEL_CLASS_CHANGED",
      observed: ["opus-5"],
    });
    database.close();
  });
});
