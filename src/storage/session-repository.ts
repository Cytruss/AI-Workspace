import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { SqliteDatabase } from "./database.js";

export type SessionStatus =
  "queued" | "running" | "completed" | "partial" | "failed" | "cancelled";
export type AgentRunStatus = "running" | "completed" | "failed" | "cancelled";
export interface ModelExecution {
  requestedClass?: string;
  requestedCliModelId?: string;
  requestedEffort?: string;
  observedModelIds: readonly string[];
  verification: "verified" | "unverified";
}
export interface CreateSessionInput {
  interactionId: string;
  command: string;
  projectId: string;
  guildId: string;
  channelId: string;
  userId: string;
  question: string;
  debateConfig?: unknown;
}
export interface SessionRecord extends CreateSessionInput {
  id: string;
  status: SessionStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
}
export interface AddMessageInput {
  id?: string;
  sessionId: string;
  role: string;
  agentId?: string;
  content: string;
  createdAt?: string;
}
export interface CreateAgentRunInput {
  id?: string;
  sessionId: string;
  agentId: string;
  modelExecution: ModelExecution;
  roundId?: string;
  phase: string;
  purpose: string;
  inputBoardId?: string;
  outputBoardId?: string;
  request: unknown;
  status?: AgentRunStatus;
  durationMs?: number;
  diagnostics?: unknown;
  createdAt?: string;
}
export interface FinishAgentRunInput {
  id: string;
  status: Exclude<AgentRunStatus, "running">;
  modelExecution?: ModelExecution;
  response?: unknown;
  outputBoardId?: string;
  exitCode?: number;
  durationMs?: number;
  diagnostics: unknown;
}
export interface AddErrorInput {
  id?: string;
  sessionId?: string;
  code: string;
  message: string;
  context: unknown;
  createdAt?: string;
}
export interface AgentRunRecord {
  id: string;
  sessionId: string;
  agentId: string;
  modelExecution: ModelExecution;
  roundId?: string;
  phase: string;
  purpose: string;
  inputBoardId?: string;
  outputBoardId?: string;
  request: unknown;
  response?: unknown;
  status: AgentRunStatus;
  exitCode?: number;
  durationMs: number;
  diagnostics: unknown;
  createdAt: string;
  finishedAt?: string;
}

const ObservedIdsSchema = z
  .array(
    z
      .string()
      .min(1)
      .refine(
        (value) => Buffer.byteLength(value, "utf8") <= 200,
        "Observed model ID exceeds 200 UTF-8 bytes",
      ),
  )
  .max(25)
  .superRefine((ids, context) => {
    if (new Set(ids).size !== ids.length)
      context.addIssue({
        code: "custom",
        message: "Observed model IDs must be unique",
      });
    if (ids.some((id, index) => index > 0 && id < (ids[index - 1] ?? "")))
      context.addIssue({
        code: "custom",
        message: "Observed model IDs must be sorted",
      });
  });

export class StorageCorruptionError extends Error {
  readonly code = "STORAGE_CORRUPTION";
  constructor(message: string, options?: ErrorOptions) {
    super(`Storage corruption: ${message}`, options);
    this.name = "StorageCorruptionError";
  }
}

export function canonicalJson(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize);
    if (item !== null && typeof item === "object") {
      const record = item as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(item)
          .sort()
          .map((key) => [key, normalize(record[key])]),
      );
    }
    if (
      item === undefined ||
      typeof item === "function" ||
      typeof item === "symbol" ||
      typeof item === "bigint" ||
      (typeof item === "number" && !Number.isFinite(item))
    )
      throw new Error("Value is not canonical JSON");
    return item;
  };
  return JSON.stringify(normalize(value));
}

function boundedJson(
  value: unknown,
  label: string,
  maxBytes = 1_048_576,
): string {
  const json = canonicalJson(value);
  if (Buffer.byteLength(json, "utf8") > maxBytes)
    throw new Error(`${label} exceeds ${String(maxBytes)} bytes`);
  return json;
}

function providerEnvelopeJson(
  value: unknown,
  expectedPhase: string,
  label: "Agent request" | "Agent response",
): string {
  const providerPhase =
    expectedPhase === "cross_examination" ? "cross-examination" : expectedPhase;
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  )
    throw new Error(`${label} must be a plain JSON object`);
  const phase = (value as Record<string, unknown>).phase;
  if (
    typeof phase !== "string" ||
    phase.length < 1 ||
    Buffer.byteLength(phase, "utf8") > 64 ||
    (phase !== expectedPhase && phase !== providerPhase)
  )
    throw new Error(`${label} phase must exactly match run phase`);
  return boundedJson(value, label);
}

function parseStoredJson(json: string, label: string): unknown {
  try {
    return JSON.parse(json) as unknown;
  } catch (error: unknown) {
    throw new StorageCorruptionError(`${label} contains malformed JSON`, {
      cause: error,
    });
  }
}

function parseStoredEnvelope(
  json: string,
  expectedPhase: string,
  label: "Agent request" | "Agent response",
): Record<string, unknown> {
  const value = parseStoredJson(json, label);
  try {
    providerEnvelopeJson(value, expectedPhase, label);
    return value as Record<string, unknown>;
  } catch (error: unknown) {
    throw new StorageCorruptionError(`${label} violates its stored envelope`, {
      cause: error,
    });
  }
}

function validateExecution(execution: ModelExecution): void {
  ObservedIdsSchema.parse(execution.observedModelIds);
  const hasClass = execution.requestedClass !== undefined;
  const hasId = execution.requestedCliModelId !== undefined;
  if (
    hasClass !== hasId ||
    (!hasClass && execution.requestedEffort !== undefined)
  )
    throw new Error(
      "Model selection must be fully explicit or provider-default",
    );
  if (execution.verification === "verified" && !hasClass)
    throw new Error("Verified model execution requires an explicit selection");
  if (!hasClass && execution.verification !== "unverified")
    throw new Error("Provider-default execution must be unverified");
}

interface SessionRow {
  id: string;
  interaction_id: string;
  command: string;
  project_id: string;
  guild_id: string;
  channel_id: string;
  user_id: string;
  question: string;
  debate_config_json: string | null;
  status: SessionStatus;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}
interface RunRow {
  id: string;
  session_id: string;
  agent_id: string;
  requested_model_class: string | null;
  requested_model_id: string | null;
  requested_effort: string | null;
  observed_model_ids_json: string;
  model_verification: "verified" | "unverified";
  round_id: string | null;
  phase: string;
  purpose: string;
  input_board_id: string | null;
  output_board_id: string | null;
  request_json: string;
  response_json: string | null;
  status: AgentRunStatus;
  exit_code: number | null;
  duration_ms: number;
  diagnostics_json: string;
  created_at: string;
  finished_at: string | null;
}

function sessionFromRow(row: SessionRow): SessionRecord {
  return Object.freeze({
    id: row.id,
    interactionId: row.interaction_id,
    command: row.command,
    projectId: row.project_id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    userId: row.user_id,
    question: row.question,
    ...(row.debate_config_json === null
      ? {}
      : {
          debateConfig: parseStoredJson(
            row.debate_config_json,
            "Session debate config",
          ),
        }),
    status: row.status,
    createdAt: row.created_at,
    ...(row.started_at === null ? {} : { startedAt: row.started_at }),
    ...(row.finished_at === null ? {} : { finishedAt: row.finished_at }),
  });
}

export class SessionRepository {
  constructor(private readonly database: SqliteDatabase) {}

  create(input: CreateSessionInput): SessionRecord {
    const existing = this.findByInteractionId(input.interactionId);
    if (existing !== undefined) return existing;
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO sessions (id, interaction_id, command, project_id, guild_id, channel_id, user_id, question, debate_config_json, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?)`,
      )
      .run(
        id,
        input.interactionId,
        input.command,
        input.projectId,
        input.guildId,
        input.channelId,
        input.userId,
        input.question,
        input.debateConfig === undefined
          ? null
          : boundedJson(input.debateConfig, "Debate config"),
        createdAt,
      );
    return this.get(id);
  }
  findByInteractionId(interactionId: string): SessionRecord | undefined {
    const row = this.database
      .prepare("SELECT * FROM sessions WHERE interaction_id = ?")
      .get(interactionId) as SessionRow | undefined;
    return row === undefined ? undefined : sessionFromRow(row);
  }
  get(id: string): SessionRecord {
    const row = this.database
      .prepare("SELECT * FROM sessions WHERE id = ?")
      .get(id) as SessionRow | undefined;
    if (row === undefined) throw new Error(`Session not found: ${id}`);
    return sessionFromRow(row);
  }
  recent(limit: number): SessionRecord[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new Error("Recent session limit must be between 1 and 100");
    return (
      this.database
        .prepare(
          "SELECT * FROM sessions ORDER BY created_at DESC, id DESC LIMIT ?",
        )
        .all(limit) as SessionRow[]
    ).map(sessionFromRow);
  }
  private transition(
    id: string,
    from: readonly SessionStatus[],
    to: SessionStatus,
  ): void {
    const now = new Date().toISOString();
    const placeholders = from.map(() => "?").join(",");
    const result = this.database
      .prepare(
        `UPDATE sessions SET status = ?, started_at = CASE WHEN ? = 'running' THEN ? ELSE started_at END, finished_at = CASE WHEN ? IN ('completed','partial','failed','cancelled') THEN ? ELSE finished_at END WHERE id = ? AND status IN (${placeholders})`,
      )
      .run(to, to, now, to, now, id, ...from);
    if (result.changes !== 1)
      throw new Error(`Invalid session transition to ${to}`);
  }
  markRunning(id: string): void {
    this.transition(id, ["queued"], "running");
  }
  markCompleted(id: string): void {
    this.transition(id, ["running"], "completed");
  }
  markPartial(id: string): void {
    this.transition(id, ["running"], "partial");
  }
  markFailed(id: string): void {
    this.transition(id, ["queued", "running"], "failed");
  }
  markCancelled(id: string): void {
    this.transition(id, ["queued", "running"], "cancelled");
  }
  addMessage(input: AddMessageInput): void {
    if (!new Set(["user", "assistant", "system", "agent"]).has(input.role))
      throw new Error("Invalid message role");
    this.database
      .prepare(
        "INSERT INTO messages (id, session_id, role, agent_id, content, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        input.id ?? randomUUID(),
        input.sessionId,
        input.role,
        input.agentId ?? null,
        input.content,
        input.createdAt ?? new Date().toISOString(),
      );
  }
  messages(sessionId: string): readonly unknown[] {
    return this.database
      .prepare(
        "SELECT * FROM messages WHERE session_id = ? ORDER BY created_at, id",
      )
      .all(sessionId);
  }
  addError(input: AddErrorInput): void {
    this.database
      .prepare(
        "INSERT INTO errors (id, session_id, code, message, context_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        input.id ?? randomUUID(),
        input.sessionId ?? null,
        input.code,
        input.message,
        boundedJson(input.context, "Error context", 262_144),
        input.createdAt ?? new Date().toISOString(),
      );
  }
  errors(sessionId: string): readonly unknown[] {
    return this.database
      .prepare(
        "SELECT * FROM errors WHERE session_id = ? ORDER BY created_at, id",
      )
      .all(sessionId);
  }

  createAgentRun(input: CreateAgentRunInput): void {
    validateExecution(input.modelExecution);
    if (
      !new Set(["ask", "initial", "cross_examination", "final"]).has(
        input.phase,
      )
    )
      throw new Error("Invalid agent-run phase");
    if (input.status !== undefined && input.status !== "running")
      throw new Error("Agent runs must be created in running status");
    if ((input.durationMs ?? 0) < 0)
      throw new Error("Agent run duration must be nonnegative");
    if (input.outputBoardId !== undefined)
      throw new Error(
        "Agent output boards may be linked only after response persistence",
      );
    const debatePhase = input.phase !== "ask";
    if (debatePhase && input.roundId === undefined)
      throw new Error("Debate-phase agent runs require a debate round");
    if (
      !debatePhase &&
      (input.roundId !== undefined || input.inputBoardId !== undefined)
    )
      throw new Error("Ask agent runs cannot link debate rounds or boards");
    const requestJson = providerEnvelopeJson(
      input.request,
      input.phase,
      "Agent request",
    );
    this.database.transaction(() => {
      if (input.roundId !== undefined) {
        const round = this.database
          .prepare(
            "SELECT 1 FROM debate_rounds WHERE id=? AND session_id=? AND phase=? AND input_board_id IS ? AND status='running'",
          )
          .get(
            input.roundId,
            input.sessionId,
            input.phase,
            input.inputBoardId ?? null,
          );
        if (round === undefined)
          throw new Error(
            "Agent run must match its running round phase and input board",
          );
      }
      this.database
        .prepare(
          `INSERT INTO agent_runs (id, session_id, agent_id, requested_model_class, requested_model_id, requested_effort, observed_model_ids_json, model_verification, round_id, phase, purpose, input_board_id, output_board_id, request_json, response_json, status, exit_code, duration_ms, diagnostics_json, created_at, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'running', NULL, ?, ?, ?, NULL)`,
        )
        .run(
          input.id ?? randomUUID(),
          input.sessionId,
          input.agentId,
          input.modelExecution.requestedClass ?? null,
          input.modelExecution.requestedCliModelId ?? null,
          input.modelExecution.requestedEffort ?? null,
          JSON.stringify(input.modelExecution.observedModelIds),
          input.modelExecution.verification,
          input.roundId ?? null,
          input.phase,
          input.purpose,
          input.inputBoardId ?? null,
          input.outputBoardId ?? null,
          requestJson,
          input.durationMs ?? 0,
          boundedJson(input.diagnostics ?? {}, "Agent diagnostics", 262_144),
          input.createdAt ?? new Date().toISOString(),
        );
    })();
  }
  finishAgentRun(input: FinishAgentRunInput): void {
    if (!(["completed", "failed", "cancelled"] as const).includes(input.status))
      throw new Error("Agent run finish status must be terminal");
    if (input.durationMs !== undefined && input.durationMs < 0)
      throw new Error("Agent run duration must be nonnegative");
    if (input.outputBoardId !== undefined)
      throw new Error(
        "Agent output boards are linked when their round finishes",
      );
    if (input.modelExecution !== undefined)
      validateExecution(input.modelExecution);
    this.database.transaction(() => {
      const row = this.database
        .prepare("SELECT phase, status FROM agent_runs WHERE id=?")
        .get(input.id) as { phase: string; status: AgentRunStatus } | undefined;
      if (row === undefined || row.status !== "running")
        throw new Error("Invalid agent-run transition");
      if (input.status === "completed" && input.response === undefined)
        throw new Error("Completed agent runs require a response");
      const responseJson =
        input.response === undefined
          ? null
          : providerEnvelopeJson(input.response, row.phase, "Agent response");
      this.database
        .prepare(
          "UPDATE agent_runs SET requested_model_class = COALESCE(?, requested_model_class), requested_model_id = COALESCE(?, requested_model_id), requested_effort = COALESCE(?, requested_effort), observed_model_ids_json = COALESCE(?, observed_model_ids_json), model_verification = COALESCE(?, model_verification), response_json = ?, output_board_id = COALESCE(?, output_board_id), status = ?, exit_code = ?, duration_ms = COALESCE(?, duration_ms), diagnostics_json = ?, finished_at = ? WHERE id = ? AND status = 'running'",
        )
        .run(
          input.modelExecution?.requestedClass ?? null,
          input.modelExecution?.requestedCliModelId ?? null,
          input.modelExecution?.requestedEffort ?? null,
          input.modelExecution === undefined
            ? null
            : JSON.stringify(input.modelExecution.observedModelIds),
          input.modelExecution?.verification ?? null,
          responseJson,
          input.outputBoardId ?? null,
          input.status,
          input.exitCode ?? null,
          input.durationMs ?? null,
          boundedJson(input.diagnostics, "Agent diagnostics", 262_144),
          new Date().toISOString(),
          input.id,
        );
    })();
  }
  getAgentRun(id: string): AgentRunRecord {
    const row = this.database
      .prepare("SELECT * FROM agent_runs WHERE id = ?")
      .get(id) as RunRow | undefined;
    if (row === undefined) throw new Error(`Agent run not found: ${id}`);
    const debatePhase = new Set(["initial", "cross_examination", "final"]).has(
      row.phase,
    );
    if (
      (!debatePhase && row.phase !== "ask") ||
      (debatePhase && row.round_id === null) ||
      (row.phase === "ask" &&
        (row.round_id !== null ||
          row.input_board_id !== null ||
          row.output_board_id !== null))
    )
      throw new StorageCorruptionError(
        `Agent run ${row.id} violates its phase linkage contract`,
      );
    const observed = parseStoredJson(
      row.observed_model_ids_json,
      "Observed model IDs",
    );
    let observedModelIds: string[];
    try {
      observedModelIds = ObservedIdsSchema.parse(observed);
    } catch (error: unknown) {
      throw new StorageCorruptionError(
        "Observed model IDs violate their stored schema",
        { cause: error },
      );
    }
    const execution: ModelExecution = {
      ...(row.requested_model_class === null
        ? {}
        : {
            requestedClass: row.requested_model_class,
            requestedCliModelId: row.requested_model_id as string,
            ...(row.requested_effort === null
              ? {}
              : { requestedEffort: row.requested_effort }),
          }),
      observedModelIds,
      verification: row.model_verification,
    };
    try {
      validateExecution(execution);
    } catch (error: unknown) {
      throw new StorageCorruptionError(
        "Model execution violates its stored schema",
        { cause: error },
      );
    }
    return Object.freeze({
      id: row.id,
      sessionId: row.session_id,
      agentId: row.agent_id,
      modelExecution: execution,
      ...(row.round_id === null ? {} : { roundId: row.round_id }),
      phase: row.phase,
      purpose: row.purpose,
      ...(row.input_board_id === null
        ? {}
        : { inputBoardId: row.input_board_id }),
      ...(row.output_board_id === null
        ? {}
        : { outputBoardId: row.output_board_id }),
      request: parseStoredEnvelope(
        row.request_json,
        row.phase,
        "Agent request",
      ),
      ...(row.response_json === null
        ? {}
        : {
            response: parseStoredEnvelope(
              row.response_json,
              row.phase,
              "Agent response",
            ),
          }),
      status: row.status,
      ...(row.exit_code === null ? {} : { exitCode: row.exit_code }),
      durationMs: row.duration_ms,
      diagnostics: parseStoredJson(row.diagnostics_json, "Agent diagnostics"),
      createdAt: row.created_at,
      ...(row.finished_at === null ? {} : { finishedAt: row.finished_at }),
    });
  }
  agentRuns(sessionId: string): readonly AgentRunRecord[] {
    const ids = this.database
      .prepare(
        "SELECT id FROM agent_runs WHERE session_id = ? ORDER BY created_at, id",
      )
      .all(sessionId) as readonly { id: string }[];
    return Object.freeze(ids.map(({ id }) => this.getAgentRun(id)));
  }
}
