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

function setupImmutableAudit() {
  const state = setup();
  const { sessions, session, deliberations } = state;
  const board = deliberations.createClaimBoard({
    sessionId: session.id,
    version: 1,
    payload: { claims: [{ id: "claim-1" }, { id: "claim-2" }] },
  });
  deliberations.addClaim({
    boardId: board.id,
    canonicalId: "claim-1",
    normalizedText: "one",
    material: true,
  });
  deliberations.addClaim({
    boardId: board.id,
    canonicalId: "claim-2",
    normalizedText: "two",
    material: true,
  });
  const round = deliberations.createRound({
    sessionId: session.id,
    roundNumber: 1,
    phase: "final",
    status: "running",
    inputBoardId: board.id,
  });
  sessions.createAgentRun({
    id: "run-1",
    sessionId: session.id,
    agentId: "codex",
    roundId: round.id,
    phase: "final",
    purpose: "position",
    inputBoardId: board.id,
    modelExecution: { observedModelIds: [], verification: "unverified" },
    request: { phase: "final" },
  });
  sessions.finishAgentRun({
    id: "run-1",
    status: "completed",
    response: { phase: "final" },
    diagnostics: {},
  });
  sessions.createAgentRun({
    id: "claude-run-1",
    sessionId: session.id,
    agentId: "claude",
    roundId: round.id,
    phase: "final",
    purpose: "position",
    inputBoardId: board.id,
    modelExecution: { observedModelIds: [], verification: "unverified" },
    request: { phase: "final" },
  });
  sessions.finishAgentRun({
    id: "claude-run-1",
    status: "completed",
    response: { phase: "final" },
    diagnostics: {},
  });
  deliberations.finishRound(round.id, "completed", board.id);
  const position = deliberations.addFinalPosition({
    sessionId: session.id,
    boardId: board.id,
    roundId: round.id,
    agentRunId: "run-1",
    agentId: "codex",
    position: { summary: "yes" },
    stances: [{ canonicalClaimId: "claim-1", stance: "ACCEPT" }],
  });
  deliberations.addFinalPosition({
    sessionId: session.id,
    boardId: board.id,
    roundId: round.id,
    agentRunId: "claude-run-1",
    agentId: "claude",
    position: { summary: "yes" },
    stances: [{ canonicalClaimId: "claim-1", stance: "ACCEPT" }],
  });
  const verdict = deliberations.addVerdict({
    sessionId: session.id,
    boardId: board.id,
    canonicalClaimId: "claim-1",
    roundId: round.id,
    codexRunId: "run-1",
    claudeRunId: "claude-run-1",
    classification: "CONSENSUS",
    evidenceSupport: "SUPPORTED",
    verdict: { report: "yes" },
  });
  const alternateBoard = deliberations.createClaimBoard({
    sessionId: session.id,
    version: 2,
    payload: { claims: [{ id: "claim-1" }, { id: "claim-2" }] },
  });
  for (const canonicalId of ["claim-1", "claim-2"]) {
    deliberations.addClaim({
      boardId: alternateBoard.id,
      canonicalId,
      normalizedText: canonicalId,
      material: true,
    });
  }
  const alternateRound = deliberations.createRound({
    sessionId: session.id,
    roundNumber: 2,
    phase: "final",
    status: "running",
    inputBoardId: alternateBoard.id,
  });
  sessions.createAgentRun({
    id: "run-2",
    sessionId: session.id,
    agentId: "codex",
    roundId: alternateRound.id,
    phase: "final",
    purpose: "position",
    inputBoardId: alternateBoard.id,
    modelExecution: { observedModelIds: [], verification: "unverified" },
    request: { phase: "final" },
  });
  sessions.finishAgentRun({
    id: "run-2",
    status: "completed",
    response: { phase: "final" },
    diagnostics: {},
  });
  deliberations.finishRound(alternateRound.id, "completed", alternateBoard.id);
  return { ...state, board, round, position, verdict };
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
    const finalRound = deliberations.createRound({
      sessionId: session.id,
      roundNumber: 2,
      phase: "final",
      status: "running",
      inputBoardId: output.id,
    });
    sessions.createAgentRun({
      id: "final-codex",
      sessionId: session.id,
      agentId: "codex",
      roundId: finalRound.id,
      phase: "final",
      purpose: "position",
      inputBoardId: output.id,
      modelExecution: { observedModelIds: [], verification: "unverified" },
      request: { phase: "final" },
    });
    sessions.finishAgentRun({
      id: "final-codex",
      status: "completed",
      response: {
        phase: "final",
        stances: [{ claimId: "claim-0001", stance: "ACCEPT" }],
      },
      diagnostics: {},
    });
    deliberations.finishRound(finalRound.id, "completed", output.id);
    deliberations.addFinalPosition({
      sessionId: session.id,
      boardId: output.id,
      roundId: finalRound.id,
      agentRunId: "final-codex",
      agentId: "codex",
      position: { summary: "yes" },
      stances: [{ canonicalClaimId: "claim-0001", stance: "ACCEPT" }],
    });
    deliberations.addVerdict({
      sessionId: session.id,
      boardId: output.id,
      canonicalClaimId: "claim-0001",
      roundId: finalRound.id,
      codexRunId: "final-codex",
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
      const outputVersion = index * 2 + 2;
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
        response: { phase, outputVersion },
        diagnostics: {},
      });
      const output = deliberations.createClaimBoard({
        sessionId: session.id,
        version: outputVersion,
        payload: { claims: [] },
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
    expect(() => {
      deliberations.addEvidenceOrigin({
        boardId: board.id,
        sessionId: session.id,
        canonicalEvidenceId: "evidence-0001",
        agentId: "codex",
        agentRunId: "c",
        providerLocalId: "e1",
      });
    }).toThrow();
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

  test("rejects run phase and input-board divergence from its round", () => {
    const { database, sessions, session, deliberations } = setup();
    const expected = deliberations.createClaimBoard({
      sessionId: session.id,
      version: 1,
      payload: { claims: [] },
    });
    const wrong = deliberations.createClaimBoard({
      sessionId: session.id,
      version: 2,
      payload: { claims: [] },
    });
    const round = deliberations.createRound({
      sessionId: session.id,
      roundNumber: 1,
      phase: "initial",
      status: "running",
      inputBoardId: expected.id,
    });
    const base = {
      sessionId: session.id,
      agentId: "codex",
      roundId: round.id,
      purpose: "draft",
      modelExecution: {
        observedModelIds: [],
        verification: "unverified",
      } as const,
    };
    expect(() => {
      sessions.createAgentRun({
        ...base,
        id: "phase",
        phase: "final",
        inputBoardId: expected.id,
        request: { phase: "final" },
      });
    }).toThrow(/round|phase/i);
    expect(() => {
      sessions.createAgentRun({
        ...base,
        id: "board",
        phase: "initial",
        inputBoardId: wrong.id,
        request: { phase: "initial" },
      });
    }).toThrow(/round|board/i);
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM agent_runs").get(),
    ).toEqual({ count: 0 });
    const raw = database.prepare(
      "INSERT INTO agent_runs (id,session_id,agent_id,observed_model_ids_json,model_verification,round_id,phase,purpose,input_board_id,request_json,status,duration_ms,diagnostics_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    );
    expect(() => {
      raw.run(
        "raw-phase",
        session.id,
        "codex",
        "[]",
        "unverified",
        round.id,
        "final",
        "draft",
        expected.id,
        '{"phase":"final"}',
        "running",
        0,
        "{}",
        "now",
      );
    }).toThrow();
    expect(() => {
      raw.run(
        "raw-board",
        session.id,
        "codex",
        "[]",
        "unverified",
        round.id,
        "initial",
        "draft",
        wrong.id,
        '{"phase":"initial"}',
        "running",
        0,
        "{}",
        "now",
      );
    }).toThrow();
    database.close();
  });

  test("rolls back incompatible run outputs when finishing a round", () => {
    const { database, sessions, session, deliberations } = setup();
    const input = deliberations.createClaimBoard({
      sessionId: session.id,
      version: 1,
      payload: { claims: [] },
    });
    const firstOutput = deliberations.createClaimBoard({
      sessionId: session.id,
      version: 2,
      payload: { claims: [] },
    });
    const secondOutput = deliberations.createClaimBoard({
      sessionId: session.id,
      version: 3,
      payload: { claims: [] },
    });
    const round = deliberations.createRound({
      sessionId: session.id,
      roundNumber: 1,
      phase: "initial",
      status: "running",
      inputBoardId: input.id,
    });
    sessions.createAgentRun({
      id: "run",
      sessionId: session.id,
      agentId: "codex",
      roundId: round.id,
      phase: "initial",
      purpose: "draft",
      inputBoardId: input.id,
      modelExecution: { observedModelIds: [], verification: "unverified" },
      request: { phase: "initial" },
    });
    sessions.finishAgentRun({
      id: "run",
      status: "completed",
      response: { phase: "initial" },
      diagnostics: {},
    });
    expect(() => {
      database
        .prepare("UPDATE agent_runs SET output_board_id=? WHERE id=?")
        .run(firstOutput.id, "run");
    }).toThrow(/output|round/i);
    expect(deliberations.load(session.id).rounds[0]).toMatchObject({
      status: "running",
    });
    expect(sessions.getAgentRun("run").outputBoardId).toBeUndefined();
    expect(secondOutput.id).not.toBe(firstOutput.id);
    database.close();
  });

  test("hashes complete final-position and verdict semantics", () => {
    const { database, sessions, session, deliberations } = setup();
    const board = deliberations.createClaimBoard({
      sessionId: session.id,
      version: 1,
      payload: { claims: [{ id: "claim-1" }] },
    });
    deliberations.addClaim({
      boardId: board.id,
      canonicalId: "claim-1",
      normalizedText: "claim",
      material: true,
    });
    const round = deliberations.createRound({
      sessionId: session.id,
      roundNumber: 1,
      phase: "final",
      status: "running",
      inputBoardId: board.id,
    });
    sessions.createAgentRun({
      id: "codex",
      sessionId: session.id,
      agentId: "codex",
      roundId: round.id,
      phase: "final",
      purpose: "position",
      inputBoardId: board.id,
      modelExecution: { observedModelIds: [], verification: "unverified" },
      request: { phase: "final" },
    });
    sessions.finishAgentRun({
      id: "codex",
      status: "completed",
      response: { phase: "final" },
      diagnostics: {},
    });
    deliberations.finishRound(round.id, "completed", board.id);
    const position = deliberations.addFinalPosition({
      sessionId: session.id,
      boardId: board.id,
      roundId: round.id,
      agentRunId: "codex",
      agentId: "codex",
      position: { summary: "yes" },
      stances: [{ canonicalClaimId: "claim-1", stance: "ACCEPT" }],
    });
    deliberations.addVerdict({
      sessionId: session.id,
      boardId: board.id,
      canonicalClaimId: "claim-1",
      roundId: round.id,
      codexRunId: "codex",
      classification: "UNRESOLVED",
      evidenceSupport: "SUPPORTED",
      verdict: { report: "yes" },
    });
    database
      .prepare(
        "UPDATE final_stances SET stance = 'DISPUTE' WHERE final_position_id = ?",
      )
      .run(position.id);
    database
      .prepare(
        "UPDATE verdicts SET classification = 'REJECTED' WHERE session_id = ?",
      )
      .run(session.id);
    expect(() => deliberations.load(session.id)).toThrow(/hash|corrupt/i);
    database.close();
  });

  test.each([
    [
      "final stance",
      "UPDATE final_stances SET stance='DISPUTE' WHERE final_position_id=?",
    ],
    [
      "final stance board",
      "UPDATE final_stances SET board_id=(SELECT id FROM claim_boards WHERE version=2) WHERE final_position_id=?",
    ],
    [
      "position agent",
      "UPDATE final_positions SET agent_id='other' WHERE id=?",
    ],
    [
      "position board link",
      "UPDATE final_positions SET board_id=(SELECT id FROM claim_boards WHERE version=2) WHERE id=?",
    ],
    [
      "position round link",
      "UPDATE final_positions SET round_id=(SELECT id FROM debate_rounds WHERE round_number=2) WHERE id=?",
    ],
    [
      "position run link",
      "UPDATE final_positions SET agent_run_id='run-2' WHERE id=?",
    ],
    [
      "position JSON",
      "UPDATE final_positions SET position_json='{}' WHERE id=?",
    ],
    [
      "position timestamp",
      "UPDATE final_positions SET created_at='tampered' WHERE id=?",
    ],
  ])("detects %s tampering", (_label, sql) => {
    const { database, session, deliberations, position } =
      setupImmutableAudit();
    database.prepare(sql).run(position.id);
    expect(() => deliberations.load(session.id)).toThrow(/corrupt|hash/i);
    database.close();
  });

  test.each([
    [
      "classification",
      "UPDATE verdicts SET classification='REJECTED' WHERE id=?",
    ],
    [
      "evidence support",
      "UPDATE verdicts SET evidence_support='UNSUPPORTED' WHERE id=?",
    ],
    [
      "claim link",
      "UPDATE verdicts SET canonical_claim_id='claim-2' WHERE id=?",
    ],
    ["round link", "UPDATE verdicts SET round_id=NULL WHERE id=?"],
    ["run link", "UPDATE verdicts SET codex_run_id=NULL WHERE id=?"],
    ["JSON", "UPDATE verdicts SET verdict_json='{}' WHERE id=?"],
    ["ID", "UPDATE verdicts SET id='tampered-verdict' WHERE id=?"],
    ["timestamp", "UPDATE verdicts SET created_at='tampered' WHERE id=?"],
  ])("detects verdict %s tampering", (_label, sql) => {
    const { database, session, deliberations, verdict } = setupImmutableAudit();
    database.prepare(sql).run(verdict.id);
    expect(() => deliberations.load(session.id)).toThrow(/corrupt|hash/i);
    database.close();
  });

  test("detects final-position identity tampering", () => {
    const { database, session, deliberations, position } =
      setupImmutableAudit();
    database.pragma("foreign_keys = OFF");
    database
      .prepare("UPDATE final_positions SET id=? WHERE id=?")
      .run("tampered-position", position.id);
    database
      .prepare(
        "UPDATE final_stances SET final_position_id=? WHERE final_position_id=?",
      )
      .run("tampered-position", position.id);
    database.pragma("foreign_keys = ON");
    expect(() => deliberations.load(session.id)).toThrow(/corrupt|hash/i);
    database.close();
  });

  test("rejects cross-session evidence origins and cross-board evidence joins", () => {
    const first = setup("origin-first");
    const sessions = new SessionRepository(first.database);
    const second = sessions.create({
      interactionId: "origin-second",
      command: "debate",
      projectId: "demo",
      guildId: "g",
      channelId: "c",
      userId: "u",
      question: "Q",
    });
    const boardA = first.deliberations.createClaimBoard({
      sessionId: first.session.id,
      version: 1,
      payload: { claims: [{ id: "claim" }] },
    });
    const boardB = first.deliberations.createClaimBoard({
      sessionId: second.id,
      version: 1,
      payload: { claims: [{ id: "claim" }] },
    });
    first.deliberations.addClaim({
      boardId: boardA.id,
      canonicalId: "claim",
      normalizedText: "claim",
      material: true,
    });
    first.deliberations.addClaim({
      boardId: boardB.id,
      canonicalId: "claim",
      normalizedText: "claim",
      material: true,
    });
    first.deliberations.addEvidenceReference({
      boardId: boardA.id,
      sessionId: first.session.id,
      canonicalId: "e-a",
      trackedPath: "x",
      resolution: "MISSING",
    });
    first.deliberations.addEvidenceReference({
      boardId: boardB.id,
      sessionId: second.id,
      canonicalId: "e-cross",
      trackedPath: "x",
      resolution: "MISSING",
    });
    sessions.createAgentRun({
      id: "other-run",
      sessionId: second.id,
      agentId: "codex",
      phase: "initial",
      purpose: "draft",
      modelExecution: { observedModelIds: [], verification: "unverified" },
      request: { phase: "initial" },
    });
    const round = first.deliberations.createRound({
      sessionId: first.session.id,
      roundNumber: 1,
      phase: "initial",
      status: "running",
      inputBoardId: boardA.id,
    });
    sessions.createAgentRun({
      id: "first-run",
      sessionId: first.session.id,
      agentId: "codex",
      roundId: round.id,
      phase: "initial",
      purpose: "draft",
      inputBoardId: boardA.id,
      modelExecution: { observedModelIds: [], verification: "unverified" },
      request: { phase: "initial" },
    });
    const stance = first.deliberations.addStance({
      boardId: boardA.id,
      canonicalClaimId: "claim",
      roundId: round.id,
      agentRunId: "first-run",
      agentId: "codex",
      stance: "ACCEPT",
      reasoning: "r",
    });
    expect(() => {
      first.deliberations.addEvidenceOrigin({
        boardId: boardA.id,
        sessionId: first.session.id,
        canonicalEvidenceId: "e-a",
        agentId: "codex",
        agentRunId: "other-run",
        providerLocalId: "e",
      });
    }).toThrow();
    expect(() => {
      first.deliberations.linkClaimEvidence({
        boardId: boardA.id,
        canonicalClaimId: "claim",
        canonicalEvidenceId: "e-cross",
      });
    }).toThrow();
    expect(() => {
      first.deliberations.linkStanceEvidence({
        stanceId: stance.id,
        boardId: boardA.id,
        canonicalEvidenceId: "e-cross",
      });
    }).toThrow();
    expect(
      first.database
        .prepare("SELECT COUNT(*) AS count FROM evidence_origins")
        .get(),
    ).toEqual({ count: 0 });
    first.database.close();
  });

  test("rejects invalid initial round state", () => {
    const { database, session, deliberations } = setup();
    expect(() => {
      deliberations.createRound({
        sessionId: session.id,
        roundNumber: 1,
        phase: "initial",
        status: "completed",
      });
    }).toThrow(/running|status/i);
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM debate_rounds").get(),
    ).toEqual({ count: 0 });
    database.close();
  });

  test("rolls back final-position parent and children when a stance is invalid", () => {
    const { database, sessions, session, deliberations } = setup();
    const board = deliberations.createClaimBoard({
      sessionId: session.id,
      version: 1,
      payload: { claims: [{ id: "claim" }] },
    });
    deliberations.addClaim({
      boardId: board.id,
      canonicalId: "claim",
      normalizedText: "claim",
      material: true,
    });
    const round = deliberations.createRound({
      sessionId: session.id,
      roundNumber: 1,
      phase: "final",
      status: "running",
      inputBoardId: board.id,
    });
    sessions.createAgentRun({
      id: "run",
      sessionId: session.id,
      agentId: "codex",
      roundId: round.id,
      phase: "final",
      purpose: "position",
      inputBoardId: board.id,
      modelExecution: { observedModelIds: [], verification: "unverified" },
      request: { phase: "final" },
    });
    sessions.finishAgentRun({
      id: "run",
      status: "completed",
      response: { phase: "final" },
      diagnostics: {},
    });
    deliberations.finishRound(round.id, "completed", board.id);
    expect(() => {
      deliberations.addFinalPosition({
        sessionId: session.id,
        boardId: board.id,
        roundId: round.id,
        agentRunId: "run",
        agentId: "codex",
        position: {},
        stances: [{ canonicalClaimId: "claim", stance: "BROKEN" as "ACCEPT" }],
      });
    }).toThrow(/stance/i);
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM final_positions").get(),
    ).toEqual({ count: 0 });
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM final_stances").get(),
    ).toEqual({ count: 0 });
    database.close();
  });

  test("requires response then finalized final round then final position", () => {
    const { database, sessions, session, deliberations } = setup();
    const board = deliberations.createClaimBoard({
      sessionId: session.id,
      version: 1,
      payload: { claims: [{ id: "claim" }] },
    });
    deliberations.addClaim({
      boardId: board.id,
      canonicalId: "claim",
      normalizedText: "claim",
      material: true,
    });
    const round = deliberations.createRound({
      sessionId: session.id,
      roundNumber: 1,
      phase: "final",
      status: "running",
      inputBoardId: board.id,
    });
    sessions.createAgentRun({
      id: "run",
      sessionId: session.id,
      agentId: "codex",
      roundId: round.id,
      phase: "final",
      purpose: "position",
      inputBoardId: board.id,
      modelExecution: { observedModelIds: [], verification: "unverified" },
      request: { phase: "final" },
    });
    const position = {
      sessionId: session.id,
      boardId: board.id,
      roundId: round.id,
      agentRunId: "run",
      agentId: "codex",
      position: {},
      stances: [{ canonicalClaimId: "claim", stance: "ACCEPT" as const }],
    };
    expect(() => {
      deliberations.addFinalPosition(position);
    }).toThrow(/final|completed|response|round/i);
    sessions.finishAgentRun({
      id: "run",
      status: "completed",
      response: { phase: "final" },
      diagnostics: {},
    });
    expect(() => {
      deliberations.addFinalPosition(position);
    }).toThrow(/final|output|round/i);
    deliberations.finishRound(round.id, "completed", board.id);
    expect(deliberations.addFinalPosition(position)).toMatchObject({
      boardId: board.id,
      roundId: round.id,
      agentRunId: "run",
    });
    database.close();
  });

  test("rejects initial, failed, and mismatched final-position producers", () => {
    for (const scenario of ["initial", "failed", "board", "agent"] as const) {
      const { database, sessions, session, deliberations } = setup(scenario);
      const board = deliberations.createClaimBoard({
        sessionId: session.id,
        version: 1,
        payload: { claims: [{ id: "claim" }] },
      });
      const otherBoard = deliberations.createClaimBoard({
        sessionId: session.id,
        version: 2,
        payload: { claims: [{ id: "claim" }] },
      });
      deliberations.addClaim({
        boardId: board.id,
        canonicalId: "claim",
        normalizedText: "claim",
        material: true,
      });
      deliberations.addClaim({
        boardId: otherBoard.id,
        canonicalId: "claim",
        normalizedText: "claim",
        material: true,
      });
      const phase = scenario === "initial" ? "initial" : "final";
      const round = deliberations.createRound({
        sessionId: session.id,
        roundNumber: 1,
        phase,
        status: "running",
        inputBoardId: board.id,
      });
      sessions.createAgentRun({
        id: "run",
        sessionId: session.id,
        agentId: "codex",
        roundId: round.id,
        phase,
        purpose: "position",
        inputBoardId: board.id,
        modelExecution: { observedModelIds: [], verification: "unverified" },
        request: { phase },
      });
      sessions.finishAgentRun({
        id: "run",
        status: scenario === "failed" ? "failed" : "completed",
        ...(scenario === "failed" ? {} : { response: { phase } }),
        diagnostics: {},
      });
      deliberations.finishRound(
        round.id,
        scenario === "failed" ? "partial" : "completed",
        board.id,
      );
      expect(() => {
        deliberations.addFinalPosition({
          sessionId: session.id,
          boardId: scenario === "board" ? otherBoard.id : board.id,
          roundId: round.id,
          agentRunId: "run",
          agentId: scenario === "agent" ? "claude" : "codex",
          position: {},
          stances: [{ canonicalClaimId: "claim", stance: "ACCEPT" }],
        });
      }).toThrow(/final|run|agent|board|completed/i);
      expect(
        database.prepare("SELECT COUNT(*) AS count FROM final_positions").get(),
      ).toEqual({ count: 0 });
      database.close();
    }
  });

  test("requires lifecycle-valid final runs and deterministic stance classification before verdict", () => {
    const { database, sessions, session, deliberations } = setup();
    const board = deliberations.createClaimBoard({
      sessionId: session.id,
      version: 1,
      payload: { claims: [{ id: "claim" }] },
    });
    deliberations.addClaim({
      boardId: board.id,
      canonicalId: "claim",
      normalizedText: "claim",
      material: true,
    });
    const round = deliberations.createRound({
      sessionId: session.id,
      roundNumber: 1,
      phase: "final",
      status: "running",
      inputBoardId: board.id,
    });
    for (const agentId of ["codex", "claude"] as const) {
      sessions.createAgentRun({
        id: agentId,
        sessionId: session.id,
        agentId,
        roundId: round.id,
        phase: "final",
        purpose: "position",
        inputBoardId: board.id,
        modelExecution: { observedModelIds: [], verification: "unverified" },
        request: { phase: "final" },
      });
      sessions.finishAgentRun({
        id: agentId,
        status: "completed",
        response: { phase: "final" },
        diagnostics: {},
      });
    }
    const verdict = {
      sessionId: session.id,
      boardId: board.id,
      canonicalClaimId: "claim",
      roundId: round.id,
      codexRunId: "codex",
      claudeRunId: "claude",
      classification: "CONSENSUS" as const,
      evidenceSupport: "SUPPORTED",
      verdict: {},
    };
    expect(() => {
      deliberations.addVerdict(verdict);
    }).toThrow(/final|round|output/i);
    deliberations.finishRound(round.id, "completed", board.id);
    expect(() => {
      deliberations.addVerdict(verdict);
    }).toThrow(/position|stance/i);
    for (const agentId of ["codex", "claude"] as const) {
      deliberations.addFinalPosition({
        sessionId: session.id,
        boardId: board.id,
        roundId: round.id,
        agentRunId: agentId,
        agentId,
        position: {},
        stances: [
          {
            canonicalClaimId: "claim",
            stance: agentId === "codex" ? "ACCEPT" : "DISPUTE",
          },
        ],
      });
    }
    expect(() => {
      deliberations.addVerdict(verdict);
    }).toThrow(/classification|stance/i);
    expect(
      deliberations.addVerdict({ ...verdict, classification: "DISAGREEMENT" }),
    ).toMatchObject({ classification: "DISAGREEMENT" });
    database.close();
  });

  test("rejects initial verdict producers but permits failed final producers only as unresolved", () => {
    for (const phase of ["initial", "final"] as const) {
      const { database, sessions, session, deliberations } = setup(
        `verdict-${phase}`,
      );
      const board = deliberations.createClaimBoard({
        sessionId: session.id,
        version: 1,
        payload: { claims: [{ id: "claim" }] },
      });
      deliberations.addClaim({
        boardId: board.id,
        canonicalId: "claim",
        normalizedText: "claim",
        material: true,
      });
      const round = deliberations.createRound({
        sessionId: session.id,
        roundNumber: 1,
        phase,
        status: "running",
        inputBoardId: board.id,
      });
      sessions.createAgentRun({
        id: "run",
        sessionId: session.id,
        agentId: "codex",
        roundId: round.id,
        phase,
        purpose: "position",
        inputBoardId: board.id,
        modelExecution: { observedModelIds: [], verification: "unverified" },
        request: { phase },
      });
      sessions.finishAgentRun({
        id: "run",
        status: phase === "final" ? "failed" : "completed",
        ...(phase === "initial" ? { response: { phase } } : {}),
        diagnostics: {},
      });
      deliberations.finishRound(
        round.id,
        phase === "final" ? "partial" : "completed",
        board.id,
      );
      const verdict = {
        sessionId: session.id,
        boardId: board.id,
        canonicalClaimId: "claim",
        roundId: round.id,
        codexRunId: "run",
        classification: "UNRESOLVED" as const,
        evidenceSupport: "UNSUPPORTED",
        verdict: {},
      };
      if (phase === "initial")
        expect(() => {
          deliberations.addVerdict(verdict);
        }).toThrow(/final|round/i);
      else
        expect(deliberations.addVerdict(verdict)).toMatchObject({
          classification: "UNRESOLVED",
        });
      database.close();
    }
  });

  test("SQLite triggers reject null-input round tuple divergence", () => {
    const { database, sessions, session, deliberations } = setup();
    const round = deliberations.createRound({
      sessionId: session.id,
      roundNumber: 1,
      phase: "initial",
      status: "running",
    });
    const raw = database.prepare(
      "INSERT INTO agent_runs (id,session_id,agent_id,observed_model_ids_json,model_verification,round_id,phase,purpose,input_board_id,request_json,status,duration_ms,diagnostics_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    );
    expect(() => {
      raw.run(
        "phase",
        session.id,
        "codex",
        "[]",
        "unverified",
        round.id,
        "final",
        "draft",
        null,
        '{"phase":"final"}',
        "running",
        0,
        "{}",
        "now",
      );
    }).toThrow();
    const other = sessions.create({
      interactionId: "null-other",
      command: "debate",
      projectId: "demo",
      guildId: "g",
      channelId: "c",
      userId: "u",
      question: "Q",
    });
    expect(() => {
      raw.run(
        "session",
        other.id,
        "codex",
        "[]",
        "unverified",
        round.id,
        "initial",
        "draft",
        null,
        '{"phase":"initial"}',
        "running",
        0,
        "{}",
        "now",
      );
    }).toThrow();
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM agent_runs").get(),
    ).toEqual({ count: 0 });
    database.close();
  });

  test("SQLite triggers prevent post-finalization output divergence", () => {
    const { database, sessions, session, deliberations } = setup();
    const board = deliberations.createClaimBoard({
      sessionId: session.id,
      version: 1,
      payload: { claims: [] },
    });
    const other = deliberations.createClaimBoard({
      sessionId: session.id,
      version: 2,
      payload: { claims: [] },
    });
    const round = deliberations.createRound({
      sessionId: session.id,
      roundNumber: 1,
      phase: "final",
      status: "running",
      inputBoardId: board.id,
    });
    sessions.createAgentRun({
      id: "run",
      sessionId: session.id,
      agentId: "codex",
      roundId: round.id,
      phase: "final",
      purpose: "position",
      inputBoardId: board.id,
      modelExecution: { observedModelIds: [], verification: "unverified" },
      request: { phase: "final" },
    });
    sessions.finishAgentRun({
      id: "run",
      status: "completed",
      response: { phase: "final" },
      diagnostics: {},
    });
    deliberations.finishRound(round.id, "completed", board.id);
    expect(() => {
      database
        .prepare("UPDATE debate_rounds SET output_board_id=? WHERE id=?")
        .run(other.id, round.id);
    }).toThrow(/output|round/i);
    expect(deliberations.load(session.id).rounds[0]?.outputBoardId).toBe(
      board.id,
    );
    database.close();
  });

  test("database rejects cross-session evidence origin even when every referenced row is valid", () => {
    const first = setup("raw-origin-a");
    const sessions = new SessionRepository(first.database);
    const second = sessions.create({
      interactionId: "raw-origin-b",
      command: "debate",
      projectId: "demo",
      guildId: "g",
      channelId: "c",
      userId: "u",
      question: "Q",
    });
    const board = first.deliberations.createClaimBoard({
      sessionId: first.session.id,
      version: 1,
      payload: { claims: [] },
    });
    first.deliberations.addEvidenceReference({
      boardId: board.id,
      sessionId: first.session.id,
      canonicalId: "e",
      trackedPath: "x",
      resolution: "MISSING",
    });
    sessions.createAgentRun({
      id: "other-run",
      sessionId: second.id,
      agentId: "codex",
      phase: "initial",
      purpose: "draft",
      modelExecution: { observedModelIds: [], verification: "unverified" },
      request: { phase: "initial" },
    });
    expect(() => {
      first.database
        .prepare(
          "INSERT INTO evidence_origins (id,board_id,session_id,canonical_evidence_id,agent_id,agent_run_id,provider_local_id) VALUES (?,?,?,?,?,?,?)",
        )
        .run(
          "origin",
          board.id,
          first.session.id,
          "e",
          "codex",
          "other-run",
          "local",
        );
    }).toThrow();
    expect(
      first.database
        .prepare("SELECT COUNT(*) AS count FROM evidence_origins")
        .get(),
    ).toEqual({ count: 0 });
    first.database.close();
  });

  test("round completion rolls back when linked-run update aborts after parent update", () => {
    const { database, sessions, session, deliberations } = setup();
    const board = deliberations.createClaimBoard({
      sessionId: session.id,
      version: 1,
      payload: { claims: [] },
    });
    const round = deliberations.createRound({
      sessionId: session.id,
      roundNumber: 1,
      phase: "final",
      status: "running",
      inputBoardId: board.id,
    });
    sessions.createAgentRun({
      id: "run",
      sessionId: session.id,
      agentId: "codex",
      roundId: round.id,
      phase: "final",
      purpose: "position",
      inputBoardId: board.id,
      modelExecution: { observedModelIds: [], verification: "unverified" },
      request: { phase: "final" },
    });
    sessions.finishAgentRun({
      id: "run",
      status: "completed",
      response: { phase: "final" },
      diagnostics: {},
    });
    database.exec(
      "CREATE TEMP TRIGGER abort_run_output BEFORE UPDATE OF output_board_id ON agent_runs BEGIN SELECT RAISE(ABORT, 'forced run update failure'); END",
    );
    expect(() => {
      deliberations.finishRound(round.id, "completed", board.id);
    }).toThrow(/forced/i);
    const persistedRound = deliberations.load(session.id).rounds[0];
    expect(persistedRound?.status).toBe("running");
    expect(persistedRound?.outputBoardId).toBeUndefined();
    expect(sessions.getAgentRun("run").outputBoardId).toBeUndefined();
    database.close();
  });

  test("final-position parent rolls back when child insert aborts", () => {
    const { database, sessions, session, deliberations } = setup();
    const board = deliberations.createClaimBoard({
      sessionId: session.id,
      version: 1,
      payload: { claims: [{ id: "claim" }] },
    });
    deliberations.addClaim({
      boardId: board.id,
      canonicalId: "claim",
      normalizedText: "claim",
      material: true,
    });
    const round = deliberations.createRound({
      sessionId: session.id,
      roundNumber: 1,
      phase: "final",
      status: "running",
      inputBoardId: board.id,
    });
    sessions.createAgentRun({
      id: "run",
      sessionId: session.id,
      agentId: "codex",
      roundId: round.id,
      phase: "final",
      purpose: "position",
      inputBoardId: board.id,
      modelExecution: { observedModelIds: [], verification: "unverified" },
      request: { phase: "final" },
    });
    sessions.finishAgentRun({
      id: "run",
      status: "completed",
      response: { phase: "final" },
      diagnostics: {},
    });
    deliberations.finishRound(round.id, "completed", board.id);
    database.exec(
      "CREATE TEMP TRIGGER abort_final_stance BEFORE INSERT ON final_stances BEGIN SELECT RAISE(ABORT, 'forced stance failure'); END",
    );
    expect(() => {
      deliberations.addFinalPosition({
        sessionId: session.id,
        boardId: board.id,
        roundId: round.id,
        agentRunId: "run",
        agentId: "codex",
        position: {},
        stances: [{ canonicalClaimId: "claim", stance: "ACCEPT" }],
      });
    }).toThrow(/forced/i);
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM final_positions").get(),
    ).toEqual({ count: 0 });
    database.close();
  });
});
