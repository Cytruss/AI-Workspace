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

  test("rejects non-object, wrong-phase, and oversized provider envelopes before writing", () => {
    const { database, sessions } = setup();
    const session = sessions.create({
      interactionId: "json",
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
      modelExecution: {
        observedModelIds: [],
        verification: "unverified",
      } as const,
    };
    for (const [id, request] of [
      ["scalar", "ask"],
      ["array", ["ask"]],
      ["null", null],
      ["wrong", { phase: "final" }],
    ] as const) {
      expect(() => {
        sessions.createAgentRun({ ...base, id, request });
      }).toThrow(/request|phase|object/i);
    }
    expect(() => {
      sessions.createAgentRun({
        ...base,
        id: "large",
        request: { phase: "ask", body: "x".repeat(1_048_577) },
      });
    }).toThrow(/bytes/i);
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM agent_runs").get(),
    ).toEqual({ count: 0 });
    database.close();
  });

  test("requires running creation and terminal response invariants without partial updates", () => {
    const { database, sessions } = setup();
    const session = sessions.create({
      interactionId: "state",
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
      modelExecution: {
        observedModelIds: [],
        verification: "unverified",
      } as const,
      request: { phase: "ask" },
    };
    expect(() => {
      sessions.createAgentRun({
        ...base,
        id: "terminal",
        status: "completed",
      });
    }).toThrow(/running|status/i);
    sessions.createAgentRun({ ...base, id: "run" });
    expect(() => {
      sessions.finishAgentRun({
        id: "run",
        status: "completed",
        diagnostics: {},
      });
    }).toThrow(/response/i);
    expect(sessions.getAgentRun("run").status).toBe("running");
    for (const response of ["ask", ["ask"], null]) {
      expect(() => {
        sessions.finishAgentRun({
          id: "run",
          status: "completed",
          response,
          diagnostics: {},
        });
      }).toThrow(/response|object/i);
    }
    expect(() => {
      sessions.finishAgentRun({
        id: "run",
        status: "completed",
        response: { phase: "ask", body: "x".repeat(1_048_577) },
        diagnostics: {},
      });
    }).toThrow(/bytes/i);
    expect(() => {
      sessions.finishAgentRun({
        id: "run",
        status: "completed",
        response: { phase: "final" },
        diagnostics: {},
      });
    }).toThrow(/phase/i);
    expect(sessions.getAgentRun("run").status).toBe("running");
    database.close();
  });

  test("reports tampered request JSON as storage corruption", () => {
    const { database, sessions } = setup();
    const session = sessions.create({
      interactionId: "corrupt",
      command: "ask",
      projectId: "demo",
      guildId: "g",
      channelId: "c",
      userId: "u",
      question: "Q",
    });
    sessions.createAgentRun({
      id: "run",
      sessionId: session.id,
      agentId: "codex",
      phase: "ask",
      purpose: "answer",
      modelExecution: { observedModelIds: [], verification: "unverified" },
      request: { phase: "ask" },
    });
    database
      .prepare("UPDATE agent_runs SET request_json = ? WHERE id = ?")
      .run("[", "run");
    expect(() => sessions.getAgentRun("run")).toThrow(/corrupt/i);
    database.close();
  });

  test("database checks reject partial selections and loaders reject malformed responses", () => {
    const { database, sessions } = setup();
    const session = sessions.create({
      interactionId: "raw",
      command: "ask",
      projectId: "demo",
      guildId: "g",
      channelId: "c",
      userId: "u",
      question: "Q",
    });
    sessions.createAgentRun({
      id: "run",
      sessionId: session.id,
      agentId: "codex",
      phase: "ask",
      purpose: "answer",
      modelExecution: {
        requestedClass: "sol",
        requestedCliModelId: "gpt-sol",
        observedModelIds: ["gpt-sol"],
        verification: "verified",
      },
      request: { phase: "ask" },
    });
    expect(() => {
      database
        .prepare("UPDATE agent_runs SET requested_model_id=NULL WHERE id=?")
        .run("run");
    }).toThrow();
    sessions.finishAgentRun({
      id: "run",
      status: "completed",
      response: { phase: "ask" },
      diagnostics: {},
    });
    database
      .prepare("UPDATE agent_runs SET response_json=? WHERE id=?")
      .run("null", "run");
    expect(() => sessions.getAgentRun("run")).toThrow(/corrupt/i);
    database.close();
  });

  test("database checks enforce temporal, duration, and message-role invariants", () => {
    const { database, sessions } = setup();
    const session = sessions.create({
      interactionId: "checks",
      command: "ask",
      projectId: "demo",
      guildId: "g",
      channelId: "c",
      userId: "u",
      question: "Q",
    });
    sessions.createAgentRun({
      id: "run",
      sessionId: session.id,
      agentId: "codex",
      phase: "ask",
      purpose: "answer",
      modelExecution: { observedModelIds: [], verification: "unverified" },
      request: { phase: "ask" },
    });
    expect(() => {
      database
        .prepare("UPDATE sessions SET status='completed' WHERE id=?")
        .run(session.id);
    }).toThrow();
    expect(() => {
      database
        .prepare("UPDATE agent_runs SET duration_ms=-1 WHERE id=?")
        .run("run");
    }).toThrow();
    expect(() => {
      sessions.addMessage({
        sessionId: session.id,
        role: "invalid",
        content: "x",
      });
    }).toThrow(/role/i);
    database.close();
  });
});
