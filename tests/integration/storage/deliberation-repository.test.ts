import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { openDatabase } from "../../../src/storage/database.js";
import { DeliberationRepository } from "../../../src/storage/deliberation-repository.js";
import { migrateDatabase } from "../../../src/storage/migrations.js";
import { ProjectRepository } from "../../../src/storage/project-repository.js";
import { SessionRepository } from "../../../src/storage/session-repository.js";

function setup(interactionId = "i") {
  const database = openDatabase(":memory:");
  migrateDatabase(database);
  const projects = new ProjectRepository(database);
  projects.upsert({ id: "demo", name: "Demo", root: "/demo" });
  const sessions = new SessionRepository(database);
  const session = sessions.create({
    interactionId,
    command: "debate",
    projectId: "demo",
    guildId: "g",
    channelId: "c",
    userId: "u",
    question: "Q",
  });
  return {
    database,
    sessions,
    session,
    deliberations: new DeliberationRepository(database, {
      maxBoardBytes: 4096,
      maxBoardClaims: 10,
    }),
  };
}

describe("deliberation persistence", () => {
  test("reconstructs exact phase calls and complete provenance without transcripts", () => {
    const { database, sessions, session, deliberations } = setup();
    const input = deliberations.createClaimBoard({
      sessionId: session.id,
      version: 1,
      payload: { claims: [] },
    });
    const round = deliberations.createRound({
      sessionId: session.id,
      roundNumber: 1,
      phase: "cross_examination",
      status: "running",
      inputBoardId: input.id,
    });
    sessions.createAgentRun({
      id: "run-codex",
      sessionId: session.id,
      agentId: "codex",
      roundId: round.id,
      phase: "cross_examination",
      purpose: "challenge",
      inputBoardId: input.id,
      modelExecution: {
        requestedClass: "sol",
        requestedCliModelId: "gpt-sol",
        requestedEffort: "high",
        observedModelIds: ["gpt-sol-2026"],
        verification: "verified",
      },
      request: { phase: "cross_examination", board: { claims: [] } },
    });
    sessions.finishAgentRun({
      id: "run-codex",
      status: "completed",
      response: {
        phase: "cross_examination",
        stances: [{ claimId: "claim-0001", stance: "ACCEPT" }],
      },
      exitCode: 0,
      diagnostics: {},
    });
    const output = deliberations.createClaimBoard({
      sessionId: session.id,
      version: 2,
      payload: { claims: [{ id: "claim-0001", text: "SQLite is local" }] },
    });
    deliberations.addClaim({
      boardId: output.id,
      canonicalId: "claim-0001",
      normalizedText: "SQLite is local",
      material: true,
    });
    deliberations.addClaimOrigin({
      boardId: output.id,
      canonicalClaimId: "claim-0001",
      agentId: "codex",
      agentRunId: "run-codex",
      providerLocalId: "c1",
    });
    deliberations.addEvidenceReference({
      boardId: output.id,
      sessionId: session.id,
      canonicalId: "evidence-0001",
      trackedPath: "package.json",
      lineStart: 1,
      lineEnd: 2,
      contentHash: "abc",
      resolution: "VERIFIED",
      resolvedHash: "abc",
    });
    deliberations.addEvidenceOrigin({
      boardId: output.id,
      sessionId: session.id,
      canonicalEvidenceId: "evidence-0001",
      agentId: "codex",
      agentRunId: "run-codex",
      providerLocalId: "e1",
    });
    deliberations.linkClaimEvidence({
      boardId: output.id,
      canonicalClaimId: "claim-0001",
      canonicalEvidenceId: "evidence-0001",
    });
    const stance = deliberations.addStance({
      boardId: output.id,
      canonicalClaimId: "claim-0001",
      roundId: round.id,
      agentRunId: "run-codex",
      agentId: "codex",
      stance: "ACCEPT",
      reasoning: "verified",
    });
    deliberations.linkStanceEvidence({
      stanceId: stance.id,
      boardId: output.id,
      canonicalEvidenceId: "evidence-0001",
    });
    deliberations.finishRound(round.id, "completed", output.id);
    deliberations.addFinalPosition({
      sessionId: session.id,
      boardId: output.id,
      roundId: round.id,
      agentRunId: "run-codex",
      agentId: "codex",
      position: { summary: "yes" },
      stances: [{ canonicalClaimId: "claim-0001", stance: "ACCEPT" }],
    });
    deliberations.addVerdict({
      sessionId: session.id,
      boardId: output.id,
      canonicalClaimId: "claim-0001",
      roundId: round.id,
      codexRunId: "run-codex",
      classification: "UNRESOLVED",
      evidenceSupport: "SUPPORTED",
      verdict: { report: "immutable" },
    });

    expect(deliberations.reconstructAgentCall("run-codex")).toMatchObject({
      phase: "cross_examination",
      purpose: "challenge",
      inputBoard: { claims: [] },
      outputBoard: { claims: [{ id: "claim-0001", text: "SQLite is local" }] },
      modelExecution: {
        requestedClass: "sol",
        requestedCliModelId: "gpt-sol",
        requestedEffort: "high",
        observedModelIds: ["gpt-sol-2026"],
        verification: "verified",
      },
      request: { phase: "cross_examination" },
      response: { phase: "cross_examination" },
    });
    const loaded = deliberations.load(session.id);
    expect(loaded.claimOrigins).toHaveLength(1);
    expect(loaded.evidenceOrigins).toHaveLength(1);
    expect(loaded.claimEvidence).toEqual([
      {
        boardId: output.id,
        canonicalClaimId: "claim-0001",
        canonicalEvidenceId: "evidence-0001",
      },
    ]);
    expect(loaded.stanceEvidence).toHaveLength(1);
    expect(loaded.finalPositions[0]?.position).toEqual({ summary: "yes" });
    expect(loaded.verdicts[0]?.verdict).toEqual({ report: "immutable" });
    database.close();
  });

  test("preserves many-to-one origins while rejecting same-run local collisions", () => {
    const { database, sessions, session, deliberations } = setup();
    const board = deliberations.createClaimBoard({
      sessionId: session.id,
      version: 1,
      payload: { claims: [{ id: "claim-0001" }] },
    });
    for (const [id, agent] of [
      ["r1", "codex"],
      ["r2", "claude"],
    ] as const)
      sessions.createAgentRun({
        id,
        sessionId: session.id,
        agentId: agent,
        phase: "initial",
        purpose: "draft",
        modelExecution: { observedModelIds: [], verification: "unverified" },
        request: { phase: "initial" },
      });
    deliberations.addClaim({
      boardId: board.id,
      canonicalId: "claim-0001",
      normalizedText: "same",
      material: true,
    });
    deliberations.addClaimOrigin({
      boardId: board.id,
      canonicalClaimId: "claim-0001",
      agentId: "codex",
      agentRunId: "r1",
      providerLocalId: "local-1",
    });
    deliberations.addClaimOrigin({
      boardId: board.id,
      canonicalClaimId: "claim-0001",
      agentId: "claude",
      agentRunId: "r2",
      providerLocalId: "local-1",
    });
    expect(deliberations.load(session.id).claimOrigins).toHaveLength(2);
    expect(() => {
      deliberations.addClaimOrigin({
        boardId: board.id,
        canonicalClaimId: "claim-0001",
        agentId: "codex",
        agentRunId: "r1",
        providerLocalId: "local-1",
      });
    }).toThrow();
    database.close();
  });

  test("reconstructs explicit model selection unchanged across all debate phases", () => {
    const { database, sessions, session, deliberations } = setup();
    for (const [index, phase] of [
      "initial",
      "cross_examination",
      "final",
    ].entries()) {
      const input = deliberations.createClaimBoard({
        sessionId: session.id,
        version: index * 2 + 1,
        payload: { claims: [] },
      });
      const output = deliberations.createClaimBoard({
        sessionId: session.id,
        version: index * 2 + 2,
        payload: { claims: [] },
      });
      const round = deliberations.createRound({
        sessionId: session.id,
        roundNumber: index + 1,
        phase,
        status: "running",
        inputBoardId: input.id,
      });
      const id = `phase-${String(index)}`;
      sessions.createAgentRun({
        id,
        sessionId: session.id,
        agentId: "claude",
        roundId: round.id,
        phase,
        purpose: phase,
        inputBoardId: input.id,
        modelExecution: {
          requestedClass: "sonnet",
          requestedCliModelId: "claude-sonnet",
          requestedEffort: "high",
          observedModelIds: ["claude-sonnet-5"],
          verification: "verified",
        },
        request: { phase, inputVersion: input.version },
      });
      sessions.finishAgentRun({
        id,
        status: "completed",
        outputBoardId: output.id,
        response: { phase, outputVersion: output.version },
        diagnostics: {},
      });
      deliberations.finishRound(round.id, "completed", output.id);
      expect(deliberations.reconstructAgentCall(id)).toMatchObject({
        phase,
        request: { phase, inputVersion: input.version },
        response: { phase, outputVersion: output.version },
        inputBoard: { claims: [] },
        outputBoard: { claims: [] },
        modelExecution: {
          requestedClass: "sonnet",
          requestedCliModelId: "claude-sonnet",
          requestedEffort: "high",
          observedModelIds: ["claude-sonnet-5"],
          verification: "verified",
        },
      });
    }
    database.close();
  });

  test("merges mechanically identical evidence without losing cross-provider origins", () => {
    const { database, sessions, session, deliberations } = setup();
    const board = deliberations.createClaimBoard({
      sessionId: session.id,
      version: 1,
      payload: { claims: [] },
    });
    for (const [id, agent] of [
      ["c", "codex"],
      ["a", "claude"],
    ] as const)
      sessions.createAgentRun({
        id,
        sessionId: session.id,
        agentId: agent,
        phase: "initial",
        purpose: "draft",
        modelExecution: { observedModelIds: [], verification: "unverified" },
        request: { phase: "initial" },
      });
    deliberations.addEvidenceReference({
      boardId: board.id,
      sessionId: session.id,
      canonicalId: "evidence-0001",
      trackedPath: "src/index.ts",
      lineStart: 1,
      lineEnd: 1,
      contentHash: "same",
      resolution: "VERIFIED",
      resolvedHash: "same",
    });
    deliberations.addEvidenceOrigin({
      boardId: board.id,
      sessionId: session.id,
      canonicalEvidenceId: "evidence-0001",
      agentId: "codex",
      agentRunId: "c",
      providerLocalId: "e1",
    });
    deliberations.addEvidenceOrigin({
      boardId: board.id,
      sessionId: session.id,
      canonicalEvidenceId: "evidence-0001",
      agentId: "claude",
      agentRunId: "a",
      providerLocalId: "e1",
    });
    expect(deliberations.load(session.id).evidenceOrigins).toHaveLength(2);
    database.close();
  });

  test("rejects cross-board and cross-session links through composite foreign keys", () => {
    const first = setup("first");
    const secondProjects = new ProjectRepository(first.database);
    const secondSessions = new SessionRepository(first.database);
    const second = secondSessions.create({
      interactionId: "second",
      command: "debate",
      projectId: "demo",
      guildId: "g",
      channelId: "c",
      userId: "u",
      question: "Q2",
    });
    const a = first.deliberations.createClaimBoard({
      sessionId: first.session.id,
      version: 1,
      payload: { claims: [{ id: "c" }] },
    });
    const b = first.deliberations.createClaimBoard({
      sessionId: second.id,
      version: 1,
      payload: { claims: [] },
    });
    first.deliberations.addClaim({
      boardId: a.id,
      canonicalId: "c",
      normalizedText: "c",
      material: true,
    });
    expect(() => {
      first.deliberations.addEvidenceReference({
        boardId: "missing",
        sessionId: first.session.id,
        canonicalId: "e",
        trackedPath: "x",
        resolution: "MISSING",
      });
    }).toThrow();
    expect(() => {
      first.deliberations.createRound({
        sessionId: second.id,
        roundNumber: 1,
        phase: "initial",
        status: "running",
        inputBoardId: a.id,
      });
    }).toThrow();
    expect(() => {
      first.deliberations.linkClaimEvidence({
        boardId: a.id,
        canonicalClaimId: "c",
        canonicalEvidenceId: "e",
      });
    }).toThrow();
    expect(a.id).not.toBe(b.id);
    expect(secondProjects).toBeDefined();
    first.database.close();
  });

  test("detects immutable board hash tampering and enforces bounds", () => {
    const { database, session, deliberations } = setup();
    const board = deliberations.createClaimBoard({
      sessionId: session.id,
      version: 1,
      payload: { claims: [] },
    });
    database
      .prepare("UPDATE claim_boards SET content_hash = ? WHERE id = ?")
      .run(createHash("sha256").update("wrong").digest("hex"), board.id);
    expect(() => deliberations.load(session.id)).toThrow(/hash/i);
    expect(() =>
      deliberations.createClaimBoard({
        sessionId: session.id,
        version: 2,
        payload: { claims: Array.from({ length: 11 }, (_, i) => ({ id: i })) },
      }),
    ).toThrow(/claim limit/i);
    database.close();
  });
});
