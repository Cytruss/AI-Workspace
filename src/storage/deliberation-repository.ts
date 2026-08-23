import { createHash, randomUUID } from "node:crypto";
import type { SqliteDatabase } from "./database.js";
import {
  canonicalJson,
  type AgentRunRecord,
  SessionRepository,
  StorageCorruptionError,
} from "./session-repository.js";

export type DebateRoundStatus =
  "running" | "completed" | "partial" | "failed" | "cancelled";
export type StanceValue = "ACCEPT" | "DISPUTE" | "UNCERTAIN";
export type EvidenceResolution = "VERIFIED" | "INVALID" | "MISSING";
export type VerdictClassification =
  "CONSENSUS" | "DISAGREEMENT" | "REJECTED" | "UNRESOLVED";
export interface CreateDebateRoundInput {
  id?: string;
  sessionId: string;
  roundNumber: number;
  phase: string;
  status: DebateRoundStatus;
  inputBoardId?: string;
  createdAt?: string;
}
export interface DebateRoundRecord {
  id: string;
  sessionId: string;
  roundNumber: number;
  phase: string;
  status: DebateRoundStatus;
  inputBoardId?: string;
  outputBoardId?: string;
  createdAt: string;
  finishedAt?: string;
}
export interface CreateClaimBoardInput {
  id?: string;
  sessionId: string;
  version: number;
  payload: unknown;
  createdAt?: string;
}
export interface ClaimBoardRecord {
  id: string;
  sessionId: string;
  version: number;
  payload: unknown;
  contentHash: string;
  byteLength: number;
  createdAt: string;
}
export interface AddClaimInput {
  boardId: string;
  canonicalId: string;
  normalizedText: string;
  material: boolean;
  createdAt?: string;
}
export interface ClaimRecord extends AddClaimInput {
  createdAt: string;
}
export interface AddClaimOriginInput {
  id?: string;
  boardId: string;
  canonicalClaimId: string;
  agentId: string;
  agentRunId: string;
  providerLocalId: string;
}
export interface ClaimOriginRecord extends AddClaimOriginInput {
  id: string;
}
export interface AddEvidenceReferenceInput {
  boardId: string;
  sessionId: string;
  canonicalId: string;
  trackedPath: string;
  lineStart?: number;
  lineEnd?: number;
  contentHash?: string;
  resolution: EvidenceResolution;
  resolvedHash?: string;
}
export type EvidenceReferenceRecord = AddEvidenceReferenceInput;
export interface AddEvidenceOriginInput {
  id?: string;
  boardId: string;
  sessionId: string;
  canonicalEvidenceId: string;
  agentId: string;
  agentRunId: string;
  providerLocalId: string;
}
export interface EvidenceOriginRecord extends AddEvidenceOriginInput {
  id: string;
}
export interface LinkClaimEvidenceInput {
  boardId: string;
  canonicalClaimId: string;
  canonicalEvidenceId: string;
}
export interface AddStanceInput {
  id?: string;
  boardId: string;
  canonicalClaimId: string;
  roundId: string;
  agentRunId: string;
  agentId: string;
  stance: StanceValue;
  reasoning: string;
}
export interface StanceRecord extends AddStanceInput {
  id: string;
}
export interface LinkStanceEvidenceInput {
  stanceId: string;
  boardId: string;
  canonicalEvidenceId: string;
}
export interface AddFinalPositionInput {
  id?: string;
  sessionId: string;
  boardId: string;
  roundId: string;
  agentRunId: string;
  agentId: string;
  position: unknown;
  stances: readonly { canonicalClaimId: string; stance: StanceValue }[];
  createdAt?: string;
}
export interface FinalPositionRecord extends AddFinalPositionInput {
  id: string;
  contentHash: string;
  createdAt: string;
}
export interface AddVerdictInput {
  id?: string;
  sessionId: string;
  boardId: string;
  canonicalClaimId: string;
  roundId?: string;
  codexRunId?: string;
  claudeRunId?: string;
  classification: VerdictClassification;
  evidenceSupport: string;
  verdict: unknown;
  createdAt?: string;
}
export interface VerdictRecord extends AddVerdictInput {
  id: string;
  contentHash: string;
  createdAt: string;
}
export interface PersistedDeliberation {
  boards: readonly ClaimBoardRecord[];
  rounds: readonly DebateRoundRecord[];
  runs: readonly AgentRunRecord[];
  claims: readonly ClaimRecord[];
  claimOrigins: readonly ClaimOriginRecord[];
  evidenceReferences: readonly EvidenceReferenceRecord[];
  evidenceOrigins: readonly EvidenceOriginRecord[];
  claimEvidence: readonly LinkClaimEvidenceInput[];
  stances: readonly StanceRecord[];
  stanceEvidence: readonly LinkStanceEvidenceInput[];
  finalPositions: readonly FinalPositionRecord[];
  verdicts: readonly VerdictRecord[];
}
export interface ReconstructedAgentCall extends AgentRunRecord {
  inputBoard?: unknown;
  outputBoard?: unknown;
}

interface Limits {
  maxBoardBytes: number;
  maxBoardClaims: number;
}
const DEFAULT_LIMITS: Limits = { maxBoardBytes: 262_144, maxBoardClaims: 200 };
const STANCES = new Set<StanceValue>(["ACCEPT", "DISPUTE", "UNCERTAIN"]);
const RESOLUTIONS = new Set<EvidenceResolution>([
  "VERIFIED",
  "INVALID",
  "MISSING",
]);
const CLASSIFICATIONS = new Set<VerdictClassification>([
  "CONSENSUS",
  "DISAGREEMENT",
  "REJECTED",
  "UNRESOLVED",
]);
const hash = (json: string): string =>
  createHash("sha256").update(json, "utf8").digest("hex");
function parseImmutableJson(json: string, label: string): unknown {
  try {
    return JSON.parse(json) as unknown;
  } catch (error: unknown) {
    throw new StorageCorruptionError(`${label} contains malformed JSON`, {
      cause: error,
    });
  }
}
function finalPositionSemantic(input: {
  id: string;
  createdAt: string;
  sessionId: string;
  boardId: string;
  roundId: string;
  agentRunId: string;
  agentId: string;
  position: unknown;
  stances: readonly {
    boardId?: string;
    canonicalClaimId: string;
    stance: StanceValue;
  }[];
}): string {
  return canonicalJson({
    id: input.id,
    createdAt: input.createdAt,
    sessionId: input.sessionId,
    boardId: input.boardId,
    roundId: input.roundId,
    agentRunId: input.agentRunId,
    agentId: input.agentId,
    position: input.position,
    stances: [...input.stances]
      .map((stance) => ({
        boardId: stance.boardId ?? input.boardId,
        canonicalClaimId: stance.canonicalClaimId,
        stance: stance.stance,
      }))
      .sort((a, b) =>
        a.canonicalClaimId < b.canonicalClaimId
          ? -1
          : a.canonicalClaimId > b.canonicalClaimId
            ? 1
            : 0,
      ),
  });
}
function verdictSemantic(input: {
  id: string;
  createdAt: string;
  sessionId: string;
  boardId: string;
  canonicalClaimId: string;
  roundId?: string;
  codexRunId?: string;
  claudeRunId?: string;
  classification: VerdictClassification;
  evidenceSupport: string;
  verdict: unknown;
}): string {
  return canonicalJson({
    id: input.id,
    createdAt: input.createdAt,
    sessionId: input.sessionId,
    boardId: input.boardId,
    canonicalClaimId: input.canonicalClaimId,
    roundId: input.roundId ?? null,
    codexRunId: input.codexRunId ?? null,
    claudeRunId: input.claudeRunId ?? null,
    classification: input.classification,
    evidenceSupport: input.evidenceSupport,
    verdict: input.verdict,
  });
}
interface BoardRow {
  id: string;
  session_id: string;
  version: number;
  payload_json: string;
  content_hash: string;
  byte_length: number;
  created_at: string;
}
interface RoundRow {
  id: string;
  session_id: string;
  round_number: number;
  phase: string;
  status: DebateRoundStatus;
  input_board_id: string | null;
  output_board_id: string | null;
  created_at: string;
  finished_at: string | null;
}

function boardFromRow(row: BoardRow): ClaimBoardRecord {
  const actualBytes = Buffer.byteLength(row.payload_json, "utf8");
  if (
    actualBytes !== row.byte_length ||
    hash(row.payload_json) !== row.content_hash
  )
    throw new Error(
      `Claim board ${row.id} content hash or byte length mismatch`,
    );
  return Object.freeze({
    id: row.id,
    sessionId: row.session_id,
    version: row.version,
    payload: parseImmutableJson(row.payload_json, `Claim board ${row.id}`),
    contentHash: row.content_hash,
    byteLength: row.byte_length,
    createdAt: row.created_at,
  });
}
function roundFromRow(row: RoundRow): DebateRoundRecord {
  return Object.freeze({
    id: row.id,
    sessionId: row.session_id,
    roundNumber: row.round_number,
    phase: row.phase,
    status: row.status,
    ...(row.input_board_id === null
      ? {}
      : { inputBoardId: row.input_board_id }),
    ...(row.output_board_id === null
      ? {}
      : { outputBoardId: row.output_board_id }),
    createdAt: row.created_at,
    ...(row.finished_at === null ? {} : { finishedAt: row.finished_at }),
  });
}

export class DeliberationRepository {
  private readonly sessions: SessionRepository;
  private readonly limits: Limits;
  constructor(
    private readonly database: SqliteDatabase,
    limits: Partial<Limits> = {},
  ) {
    this.sessions = new SessionRepository(database);
    this.limits = { ...DEFAULT_LIMITS, ...limits };
  }

  createRound(input: CreateDebateRoundInput): DebateRoundRecord {
    if (input.status !== "running")
      throw new Error("Debate rounds must be created in running status");
    if (!["initial", "cross_examination", "final"].includes(input.phase))
      throw new Error("Invalid debate-round phase");
    const id = input.id ?? randomUUID();
    const createdAt = input.createdAt ?? new Date().toISOString();
    this.database
      .prepare(
        "INSERT INTO debate_rounds (id, session_id, round_number, phase, status, input_board_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        id,
        input.sessionId,
        input.roundNumber,
        input.phase,
        input.status,
        input.inputBoardId ?? null,
        createdAt,
      );
    return this.getRound(id);
  }
  private getRound(id: string): DebateRoundRecord {
    const row = this.database
      .prepare("SELECT * FROM debate_rounds WHERE id = ?")
      .get(id) as RoundRow | undefined;
    if (row === undefined) throw new Error(`Round not found: ${id}`);
    return roundFromRow(row);
  }
  finishRound(
    id: string,
    status: DebateRoundStatus,
    outputBoardId?: string,
  ): void {
    if (
      !new Set<DebateRoundStatus>([
        "completed",
        "partial",
        "failed",
        "cancelled",
      ]).has(status)
    )
      throw new Error("Debate-round finish status must be terminal");
    this.database.transaction(() => {
      const round = this.database
        .prepare(
          "SELECT session_id, phase, input_board_id, status FROM debate_rounds WHERE id=?",
        )
        .get(id) as
        | {
            session_id: string;
            phase: string;
            input_board_id: string | null;
            status: DebateRoundStatus;
          }
        | undefined;
      if (round === undefined || round.status !== "running")
        throw new Error("Invalid debate-round transition");
      const incompatible = this.database
        .prepare(
          "SELECT 1 FROM agent_runs WHERE round_id=? AND (status='running' OR session_id<>? OR phase<>? OR input_board_id IS NOT ? OR (output_board_id IS NOT NULL AND output_board_id IS NOT ?)) LIMIT 1",
        )
        .get(
          id,
          round.session_id,
          round.phase,
          round.input_board_id,
          outputBoardId ?? null,
        );
      if (incompatible !== undefined)
        throw new Error("Agent-run input or output diverges from its round");
      const result = this.database
        .prepare(
          "UPDATE debate_rounds SET status = ?, output_board_id = ?, finished_at = ? WHERE id = ? AND status = 'running'",
        )
        .run(status, outputBoardId ?? null, new Date().toISOString(), id);
      if (result.changes !== 1)
        throw new Error("Invalid debate-round transition");
      if (outputBoardId !== undefined)
        this.database
          .prepare(
            "UPDATE agent_runs SET output_board_id = ? WHERE round_id = ? AND output_board_id IS NULL",
          )
          .run(outputBoardId, id);
    })();
  }
  createClaimBoard(input: CreateClaimBoardInput): ClaimBoardRecord {
    const json = canonicalJson(input.payload);
    const byteLength = Buffer.byteLength(json, "utf8");
    if (byteLength > this.limits.maxBoardBytes)
      throw new Error("Claim board byte limit exceeded");
    const claims = (input.payload as { claims?: unknown }).claims;
    if (!Array.isArray(claims))
      throw new Error("Claim board payload must contain a claims array");
    if (claims.length > this.limits.maxBoardClaims)
      throw new Error("Claim board claim limit exceeded");
    const id = input.id ?? randomUUID();
    this.database
      .prepare(
        "INSERT INTO claim_boards (id, session_id, version, payload_json, content_hash, byte_length, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        id,
        input.sessionId,
        input.version,
        json,
        hash(json),
        byteLength,
        input.createdAt ?? new Date().toISOString(),
      );
    return this.getBoard(id);
  }
  private getBoard(id: string): ClaimBoardRecord {
    const row = this.database
      .prepare("SELECT * FROM claim_boards WHERE id = ?")
      .get(id) as BoardRow | undefined;
    if (row === undefined) throw new Error(`Claim board not found: ${id}`);
    return boardFromRow(row);
  }
  addClaim(input: AddClaimInput): ClaimRecord {
    const createdAt = input.createdAt ?? new Date().toISOString();
    this.database
      .prepare(
        "INSERT INTO claims (board_id, canonical_id, normalized_text, material, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        input.boardId,
        input.canonicalId,
        input.normalizedText,
        input.material ? 1 : 0,
        createdAt,
      );
    return Object.freeze({ ...input, createdAt });
  }

  private assertRunBoard(
    runId: string,
    boardId: string,
    agentId: string,
  ): void {
    const relation = this.database
      .prepare(
        "SELECT 1 FROM agent_runs r JOIN claim_boards b ON b.session_id = r.session_id WHERE r.id = ? AND b.id = ? AND r.agent_id = ?",
      )
      .get(runId, boardId, agentId);
    if (relation === undefined)
      throw new Error(
        "Agent run, agent, and board must belong to the same session",
      );
  }
  addClaimOrigin(input: AddClaimOriginInput): ClaimOriginRecord {
    return this.database.transaction(() => {
      this.assertRunBoard(input.agentRunId, input.boardId, input.agentId);
      const id = input.id ?? randomUUID();
      this.database
        .prepare(
          "INSERT INTO claim_origins (id, board_id, canonical_claim_id, agent_id, agent_run_id, provider_local_id) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(
          id,
          input.boardId,
          input.canonicalClaimId,
          input.agentId,
          input.agentRunId,
          input.providerLocalId,
        );
      return Object.freeze({ ...input, id });
    })();
  }
  addEvidenceReference(
    input: AddEvidenceReferenceInput,
  ): EvidenceReferenceRecord {
    if (!RESOLUTIONS.has(input.resolution))
      throw new Error("Invalid evidence resolution");
    if (
      (input.lineStart === undefined) !== (input.lineEnd === undefined) ||
      (input.lineStart !== undefined &&
        (input.lineStart < 1 || (input.lineEnd ?? 0) < input.lineStart))
    )
      throw new Error("Invalid evidence line range");
    this.database
      .prepare(
        "INSERT INTO evidence_references (board_id, session_id, canonical_id, tracked_path, line_start, line_end, content_hash, resolution, resolved_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        input.boardId,
        input.sessionId,
        input.canonicalId,
        input.trackedPath,
        input.lineStart ?? null,
        input.lineEnd ?? null,
        input.contentHash ?? null,
        input.resolution,
        input.resolvedHash ?? null,
      );
    return Object.freeze({ ...input });
  }
  addEvidenceOrigin(input: AddEvidenceOriginInput): EvidenceOriginRecord {
    return this.database.transaction(() => {
      this.assertRunBoard(input.agentRunId, input.boardId, input.agentId);
      const id = input.id ?? randomUUID();
      this.database
        .prepare(
          "INSERT INTO evidence_origins (id, board_id, session_id, canonical_evidence_id, agent_id, agent_run_id, provider_local_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          id,
          input.boardId,
          input.sessionId,
          input.canonicalEvidenceId,
          input.agentId,
          input.agentRunId,
          input.providerLocalId,
        );
      return Object.freeze({ ...input, id });
    })();
  }
  linkClaimEvidence(input: LinkClaimEvidenceInput): void {
    this.database
      .prepare(
        "INSERT INTO claim_evidence (board_id, canonical_claim_id, canonical_evidence_id) VALUES (?, ?, ?)",
      )
      .run(input.boardId, input.canonicalClaimId, input.canonicalEvidenceId);
  }
  addStance(input: AddStanceInput): StanceRecord {
    if (!STANCES.has(input.stance)) throw new Error("Invalid stance");
    return this.database.transaction(() => {
      const relation = this.database
        .prepare(
          "SELECT 1 FROM claims c JOIN claim_boards b ON b.id = c.board_id JOIN debate_rounds d ON d.session_id = b.session_id JOIN agent_runs r ON r.session_id = b.session_id AND r.round_id = d.id WHERE c.board_id = ? AND c.canonical_id = ? AND d.id = ? AND r.id = ? AND r.agent_id = ?",
        )
        .get(
          input.boardId,
          input.canonicalClaimId,
          input.roundId,
          input.agentRunId,
          input.agentId,
        );
      if (relation === undefined)
        throw new Error(
          "Stance links must share a session, round, board, and agent",
        );
      const id = input.id ?? randomUUID();
      this.database
        .prepare(
          "INSERT INTO stances (id, board_id, canonical_claim_id, round_id, agent_run_id, agent_id, stance, reasoning) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          id,
          input.boardId,
          input.canonicalClaimId,
          input.roundId,
          input.agentRunId,
          input.agentId,
          input.stance,
          input.reasoning,
        );
      return Object.freeze({ ...input, id });
    })();
  }
  linkStanceEvidence(input: LinkStanceEvidenceInput): void {
    this.database
      .prepare(
        "INSERT INTO stance_evidence (stance_id, board_id, canonical_evidence_id) VALUES (?, ?, ?)",
      )
      .run(input.stanceId, input.boardId, input.canonicalEvidenceId);
  }
  addFinalPosition(input: AddFinalPositionInput): FinalPositionRecord {
    return this.database.transaction(() => {
      const linked = this.database
        .prepare(
          `SELECT 1 FROM claim_boards b
           JOIN debate_rounds d ON d.id=? AND d.session_id=b.session_id AND d.phase='final' AND d.status IN ('completed','partial') AND d.output_board_id=b.id AND d.finished_at IS NOT NULL
           JOIN agent_runs r ON r.id=? AND r.session_id=b.session_id AND r.round_id=d.id AND r.agent_id=? AND r.phase='final' AND r.status='completed' AND r.response_json IS NOT NULL AND r.finished_at IS NOT NULL AND r.output_board_id=b.id
           WHERE b.id=? AND b.session_id=?`,
        )
        .get(
          input.roundId,
          input.agentRunId,
          input.agentId,
          input.boardId,
          input.sessionId,
        );
      if (linked === undefined)
        throw new Error(
          "Final position requires a completed final response and finalized matching round output",
        );
      const producingRun = this.sessions.getAgentRun(input.agentRunId);
      if (producingRun.response === undefined)
        throw new Error(
          "Final position producer is missing its final response",
        );
      const ids = new Set<string>();
      for (const stance of input.stances) {
        if (!STANCES.has(stance.stance) || ids.has(stance.canonicalClaimId))
          throw new Error("Invalid or duplicate final stance");
        ids.add(stance.canonicalClaimId);
      }
      const id = input.id ?? randomUUID();
      const json = canonicalJson(input.position);
      const createdAt = input.createdAt ?? new Date().toISOString();
      const contentHash = hash(
        finalPositionSemantic({ ...input, id, createdAt }),
      );
      this.database
        .prepare(
          "INSERT INTO final_positions (id, session_id, board_id, round_id, agent_run_id, agent_id, position_json, content_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          id,
          input.sessionId,
          input.boardId,
          input.roundId,
          input.agentRunId,
          input.agentId,
          json,
          contentHash,
          createdAt,
        );
      const statement = this.database.prepare(
        "INSERT INTO final_stances (final_position_id, board_id, canonical_claim_id, stance) VALUES (?, ?, ?, ?)",
      );
      for (const stance of input.stances) {
        statement.run(
          id,
          input.boardId,
          stance.canonicalClaimId,
          stance.stance,
        );
      }
      return Object.freeze({ ...input, id, contentHash, createdAt });
    })();
  }
  addVerdict(input: AddVerdictInput): VerdictRecord {
    if (!CLASSIFICATIONS.has(input.classification))
      throw new Error("Invalid verdict classification");
    if (!new Set(["SUPPORTED", "UNSUPPORTED"]).has(input.evidenceSupport))
      throw new Error("Invalid verdict evidence support");
    return this.database.transaction(() => {
      const claim = this.database
        .prepare(
          "SELECT 1 FROM claims c JOIN claim_boards b ON b.id=c.board_id WHERE b.id=? AND b.session_id=? AND c.canonical_id=?",
        )
        .get(input.boardId, input.sessionId, input.canonicalClaimId);
      if (claim === undefined)
        throw new Error("Verdict claim and board must belong to its session");
      if (
        input.roundId === undefined &&
        (input.codexRunId !== undefined || input.claudeRunId !== undefined)
      )
        throw new Error("Referenced verdict runs require an exact final round");
      if (input.roundId !== undefined) {
        const round = this.database
          .prepare(
            "SELECT 1 FROM debate_rounds WHERE id=? AND session_id=? AND phase='final' AND status IN ('completed','partial') AND output_board_id=? AND finished_at IS NOT NULL",
          )
          .get(input.roundId, input.sessionId, input.boardId);
        if (round === undefined)
          throw new Error(
            "Verdict requires a finalized final round with a matching output board",
          );
      }
      const stanceFor = (
        runId: string | undefined,
        agentId: "codex" | "claude",
      ): StanceValue | undefined => {
        if (runId === undefined) return undefined;
        const run = this.sessions.getAgentRun(runId);
        if (
          run.sessionId !== input.sessionId ||
          run.roundId !== input.roundId ||
          run.agentId !== agentId ||
          run.phase !== "final" ||
          run.status === "running" ||
          run.outputBoardId !== input.boardId ||
          run.finishedAt === undefined
        )
          throw new Error(
            "Verdict run is not a compatible terminal final-round producer",
          );
        if (run.status !== "completed") return undefined;
        if (run.response === undefined)
          throw new Error(
            "Completed verdict run is missing its final response",
          );
        const stance = this.database
          .prepare(
            `SELECT fs.stance FROM final_positions fp JOIN final_stances fs ON fs.final_position_id=fp.id AND fs.board_id=fp.board_id WHERE fp.session_id=? AND fp.board_id=? AND fp.round_id=? AND fp.agent_run_id=? AND fp.agent_id=? AND fs.canonical_claim_id=?`,
          )
          .get(
            input.sessionId,
            input.boardId,
            input.roundId,
            runId,
            agentId,
            input.canonicalClaimId,
          ) as { stance: StanceValue } | undefined;
        if (stance === undefined)
          throw new Error(
            "Successful verdict run requires a persisted final position and stance",
          );
        return stance.stance;
      };
      const codexStance = stanceFor(input.codexRunId, "codex");
      const claudeStance = stanceFor(input.claudeRunId, "claude");
      let expected: VerdictClassification = "UNRESOLVED";
      if (
        codexStance !== undefined &&
        claudeStance !== undefined &&
        codexStance !== "UNCERTAIN" &&
        claudeStance !== "UNCERTAIN"
      ) {
        if (codexStance === "ACCEPT" && claudeStance === "ACCEPT")
          expected = "CONSENSUS";
        else if (codexStance === "DISPUTE" && claudeStance === "DISPUTE")
          expected = "REJECTED";
        else expected = "DISAGREEMENT";
      }
      if (input.classification !== expected)
        throw new Error(
          `Verdict classification is inconsistent with final stances; expected ${expected}`,
        );
      const id = input.id ?? randomUUID();
      const json = canonicalJson(input.verdict);
      const createdAt = input.createdAt ?? new Date().toISOString();
      const contentHash = hash(verdictSemantic({ ...input, id, createdAt }));
      this.database
        .prepare(
          "INSERT INTO verdicts (id, session_id, board_id, canonical_claim_id, round_id, codex_run_id, claude_run_id, classification, evidence_support, verdict_json, content_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          id,
          input.sessionId,
          input.boardId,
          input.canonicalClaimId,
          input.roundId ?? null,
          input.codexRunId ?? null,
          input.claudeRunId ?? null,
          input.classification,
          input.evidenceSupport,
          json,
          contentHash,
          createdAt,
        );
      return Object.freeze({ ...input, id, contentHash, createdAt });
    })();
  }

  private assertPersistedRunRound(run: AgentRunRecord): void {
    if (run.phase === "ask") {
      if (
        run.roundId !== undefined ||
        run.inputBoardId !== undefined ||
        run.outputBoardId !== undefined
      )
        throw new StorageCorruptionError(
          `Agent run ${run.id} violates its ask phase contract`,
        );
      return;
    }
    if (run.roundId === undefined)
      throw new StorageCorruptionError(
        `Debate-phase agent run ${run.id} is missing its debate round`,
      );
    const round = this.database
      .prepare(
        "SELECT session_id, phase, input_board_id, output_board_id, status FROM debate_rounds WHERE id=?",
      )
      .get(run.roundId) as
      | {
          session_id: string;
          phase: string;
          input_board_id: string | null;
          output_board_id: string | null;
          status: DebateRoundStatus;
        }
      | undefined;
    const inputBoardId = run.inputBoardId ?? null;
    const outputBoardId = run.outputBoardId ?? null;
    if (
      round === undefined ||
      round.session_id !== run.sessionId ||
      round.phase !== run.phase ||
      round.input_board_id !== inputBoardId ||
      (round.status !== "running" && round.output_board_id !== outputBoardId)
    )
      throw new StorageCorruptionError(
        `Agent run ${run.id} diverges from its debate round`,
      );
  }

  reconstructAgentCall(runId: string): ReconstructedAgentCall {
    const run = this.sessions.getAgentRun(runId);
    this.assertPersistedRunRound(run);
    return Object.freeze({
      ...run,
      ...(run.inputBoardId === undefined
        ? {}
        : { inputBoard: this.getBoard(run.inputBoardId).payload }),
      ...(run.outputBoardId === undefined
        ? {}
        : { outputBoard: this.getBoard(run.outputBoardId).payload }),
    });
  }

  load(sessionId: string): PersistedDeliberation {
    const boards = (
      this.database
        .prepare(
          "SELECT * FROM claim_boards WHERE session_id = ? ORDER BY version",
        )
        .all(sessionId) as BoardRow[]
    ).map(boardFromRow);
    const rounds = (
      this.database
        .prepare(
          "SELECT * FROM debate_rounds WHERE session_id = ? ORDER BY round_number, phase",
        )
        .all(sessionId) as RoundRow[]
    ).map(roundFromRow);
    const runs = (
      this.database
        .prepare(
          "SELECT id FROM agent_runs WHERE session_id = ? ORDER BY created_at, id",
        )
        .all(sessionId) as { id: string }[]
    ).map(({ id }) => this.sessions.getAgentRun(id));
    for (const run of runs) this.assertPersistedRunRound(run);
    const claims = (
      this.database
        .prepare(
          "SELECT c.* FROM claims c JOIN claim_boards b ON b.id = c.board_id WHERE b.session_id = ? ORDER BY b.version, c.canonical_id",
        )
        .all(sessionId) as {
        board_id: string;
        canonical_id: string;
        normalized_text: string;
        material: number;
        created_at: string;
      }[]
    ).map((row) =>
      Object.freeze({
        boardId: row.board_id,
        canonicalId: row.canonical_id,
        normalizedText: row.normalized_text,
        material: row.material === 1,
        createdAt: row.created_at,
      }),
    );
    const claimOrigins = (
      this.database
        .prepare(
          "SELECT o.* FROM claim_origins o JOIN claim_boards b ON b.id=o.board_id WHERE b.session_id=? ORDER BY o.id",
        )
        .all(sessionId) as {
        id: string;
        board_id: string;
        canonical_claim_id: string;
        agent_id: string;
        agent_run_id: string;
        provider_local_id: string;
      }[]
    ).map((r) =>
      Object.freeze({
        id: r.id,
        boardId: r.board_id,
        canonicalClaimId: r.canonical_claim_id,
        agentId: r.agent_id,
        agentRunId: r.agent_run_id,
        providerLocalId: r.provider_local_id,
      }),
    );
    const evidenceReferences = (
      this.database
        .prepare(
          "SELECT * FROM evidence_references WHERE session_id=? ORDER BY board_id, canonical_id",
        )
        .all(sessionId) as {
        board_id: string;
        session_id: string;
        canonical_id: string;
        tracked_path: string;
        line_start: number | null;
        line_end: number | null;
        content_hash: string | null;
        resolution: EvidenceResolution;
        resolved_hash: string | null;
      }[]
    ).map((r) =>
      Object.freeze({
        boardId: r.board_id,
        sessionId: r.session_id,
        canonicalId: r.canonical_id,
        trackedPath: r.tracked_path,
        ...(r.line_start === null ? {} : { lineStart: r.line_start }),
        ...(r.line_end === null ? {} : { lineEnd: r.line_end }),
        ...(r.content_hash === null ? {} : { contentHash: r.content_hash }),
        resolution: r.resolution,
        ...(r.resolved_hash === null ? {} : { resolvedHash: r.resolved_hash }),
      }),
    );
    const evidenceOrigins = (
      this.database
        .prepare(
          "SELECT * FROM evidence_origins WHERE session_id=? ORDER BY id",
        )
        .all(sessionId) as {
        id: string;
        board_id: string;
        session_id: string;
        canonical_evidence_id: string;
        agent_id: string;
        agent_run_id: string;
        provider_local_id: string;
      }[]
    ).map((r) =>
      Object.freeze({
        id: r.id,
        boardId: r.board_id,
        sessionId: r.session_id,
        canonicalEvidenceId: r.canonical_evidence_id,
        agentId: r.agent_id,
        agentRunId: r.agent_run_id,
        providerLocalId: r.provider_local_id,
      }),
    );
    const claimEvidence = (
      this.database
        .prepare(
          "SELECT ce.* FROM claim_evidence ce JOIN claim_boards b ON b.id=ce.board_id WHERE b.session_id=? ORDER BY ce.board_id, ce.canonical_claim_id, ce.canonical_evidence_id",
        )
        .all(sessionId) as {
        board_id: string;
        canonical_claim_id: string;
        canonical_evidence_id: string;
      }[]
    ).map((r) =>
      Object.freeze({
        boardId: r.board_id,
        canonicalClaimId: r.canonical_claim_id,
        canonicalEvidenceId: r.canonical_evidence_id,
      }),
    );
    const stances = (
      this.database
        .prepare(
          "SELECT s.* FROM stances s JOIN claim_boards b ON b.id=s.board_id WHERE b.session_id=? ORDER BY s.id",
        )
        .all(sessionId) as {
        id: string;
        board_id: string;
        canonical_claim_id: string;
        round_id: string;
        agent_run_id: string;
        agent_id: string;
        stance: StanceValue;
        reasoning: string;
      }[]
    ).map((r) =>
      Object.freeze({
        id: r.id,
        boardId: r.board_id,
        canonicalClaimId: r.canonical_claim_id,
        roundId: r.round_id,
        agentRunId: r.agent_run_id,
        agentId: r.agent_id,
        stance: r.stance,
        reasoning: r.reasoning,
      }),
    );
    const stanceEvidence = (
      this.database
        .prepare(
          "SELECT se.* FROM stance_evidence se JOIN stances s ON s.id=se.stance_id JOIN claim_boards b ON b.id=s.board_id WHERE b.session_id=? ORDER BY se.stance_id,se.canonical_evidence_id",
        )
        .all(sessionId) as {
        stance_id: string;
        board_id: string;
        canonical_evidence_id: string;
      }[]
    ).map((r) =>
      Object.freeze({
        stanceId: r.stance_id,
        boardId: r.board_id,
        canonicalEvidenceId: r.canonical_evidence_id,
      }),
    );
    const finalPositions = (
      this.database
        .prepare(
          "SELECT * FROM final_positions WHERE session_id=? ORDER BY agent_id",
        )
        .all(sessionId) as {
        id: string;
        session_id: string;
        board_id: string;
        round_id: string;
        agent_run_id: string;
        agent_id: string;
        position_json: string;
        content_hash: string;
        created_at: string;
      }[]
    ).map((r) => {
      const finalStances = this.database
        .prepare(
          "SELECT board_id, canonical_claim_id, stance FROM final_stances WHERE final_position_id=? ORDER BY canonical_claim_id",
        )
        .all(r.id) as {
        board_id: string;
        canonical_claim_id: string;
        stance: StanceValue;
      }[];
      const position = parseImmutableJson(
        r.position_json,
        `Final position ${r.id}`,
      );
      const stances = finalStances.map((s) => ({
        boardId: s.board_id,
        canonicalClaimId: s.canonical_claim_id,
        stance: s.stance,
      }));
      if (
        hash(
          finalPositionSemantic({
            id: r.id,
            createdAt: r.created_at,
            sessionId: r.session_id,
            boardId: r.board_id,
            roundId: r.round_id,
            agentRunId: r.agent_run_id,
            agentId: r.agent_id,
            position,
            stances,
          }),
        ) !== r.content_hash
      )
        throw new StorageCorruptionError(
          `Final position ${r.id} content hash mismatch`,
        );
      return Object.freeze({
        id: r.id,
        sessionId: r.session_id,
        boardId: r.board_id,
        roundId: r.round_id,
        agentRunId: r.agent_run_id,
        agentId: r.agent_id,
        position,
        stances: stances.map(({ canonicalClaimId, stance }) => ({
          canonicalClaimId,
          stance,
        })),
        contentHash: r.content_hash,
        createdAt: r.created_at,
      });
    });
    const verdicts = (
      this.database
        .prepare(
          "SELECT * FROM verdicts WHERE session_id=? ORDER BY canonical_claim_id",
        )
        .all(sessionId) as {
        id: string;
        session_id: string;
        board_id: string;
        canonical_claim_id: string;
        round_id: string | null;
        codex_run_id: string | null;
        claude_run_id: string | null;
        classification: VerdictClassification;
        evidence_support: string;
        verdict_json: string;
        content_hash: string;
        created_at: string;
      }[]
    ).map((r) => {
      const verdict = parseImmutableJson(r.verdict_json, `Verdict ${r.id}`);
      if (
        hash(
          verdictSemantic({
            id: r.id,
            createdAt: r.created_at,
            sessionId: r.session_id,
            boardId: r.board_id,
            canonicalClaimId: r.canonical_claim_id,
            ...(r.round_id === null ? {} : { roundId: r.round_id }),
            ...(r.codex_run_id === null ? {} : { codexRunId: r.codex_run_id }),
            ...(r.claude_run_id === null
              ? {}
              : { claudeRunId: r.claude_run_id }),
            classification: r.classification,
            evidenceSupport: r.evidence_support,
            verdict,
          }),
        ) !== r.content_hash
      )
        throw new StorageCorruptionError(
          `Verdict ${r.id} content hash mismatch`,
        );
      return Object.freeze({
        id: r.id,
        sessionId: r.session_id,
        boardId: r.board_id,
        canonicalClaimId: r.canonical_claim_id,
        ...(r.round_id === null ? {} : { roundId: r.round_id }),
        ...(r.codex_run_id === null ? {} : { codexRunId: r.codex_run_id }),
        ...(r.claude_run_id === null ? {} : { claudeRunId: r.claude_run_id }),
        classification: r.classification,
        evidenceSupport: r.evidence_support,
        verdict,
        contentHash: r.content_hash,
        createdAt: r.created_at,
      });
    });
    return Object.freeze({
      boards,
      rounds,
      runs,
      claims,
      claimOrigins,
      evidenceReferences,
      evidenceOrigins,
      claimEvidence,
      stances,
      stanceEvidence,
      finalPositions,
      verdicts,
    });
  }
}
