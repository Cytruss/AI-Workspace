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
    if (
      ids.some(
        (id, index) => index > 0 && id.localeCompare(ids[index - 1] ?? "") < 0,
      )
    )
      context.addIssue({
        code: "custom",
        message: "Observed model IDs must be sorted",
      });
  });

function ownObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected a JSON object");
  return value as Record<string, unknown>;
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
      : { debateConfig: JSON.parse(row.debate_config_json) as unknown }),
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
    this.database
      .prepare(
        `INSERT INTO agent_runs (id, session_id, agent_id, requested_model_class, requested_model_id, requested_effort, observed_model_ids_json, model_verification, round_id, phase, purpose, input_board_id, output_board_id, request_json, response_json, status, exit_code, duration_ms, diagnostics_json, created_at, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?, ?, NULL)`,
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
        boundedJson(input.request, "Agent request"),
        input.status ?? "running",
        input.durationMs ?? 0,
        boundedJson(input.diagnostics ?? {}, "Agent diagnostics", 262_144),
        input.createdAt ?? new Date().toISOString(),
      );
  }
  finishAgentRun(input: FinishAgentRunInput): void {
    const result = this.database
      .prepare(
        "UPDATE agent_runs SET response_json = ?, output_board_id = COALESCE(?, output_board_id), status = ?, exit_code = ?, duration_ms = COALESCE(?, duration_ms), diagnostics_json = ?, finished_at = ? WHERE id = ? AND status = 'running'",
      )
      .run(
        input.response === undefined
          ? null
          : boundedJson(input.response, "Agent response"),
        input.outputBoardId ?? null,
        input.status,
        input.exitCode ?? null,
        input.durationMs ?? null,
        boundedJson(input.diagnostics, "Agent diagnostics", 262_144),
        new Date().toISOString(),
        input.id,
      );
    if (result.changes !== 1) throw new Error("Invalid agent-run transition");
  }
  getAgentRun(id: string): AgentRunRecord {
    const row = this.database
      .prepare("SELECT * FROM agent_runs WHERE id = ?")
      .get(id) as RunRow | undefined;
    if (row === undefined) throw new Error(`Agent run not found: ${id}`);
    const observed = JSON.parse(row.observed_model_ids_json) as unknown;
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
      observedModelIds: ObservedIdsSchema.parse(observed),
      verification: row.model_verification,
    };
    validateExecution(execution);
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
      request: ownObject(JSON.parse(row.request_json) as unknown),
      ...(row.response_json === null
        ? {}
        : { response: JSON.parse(row.response_json) as unknown }),
      status: row.status,
      ...(row.exit_code === null ? {} : { exitCode: row.exit_code }),
      durationMs: row.duration_ms,
      diagnostics: JSON.parse(row.diagnostics_json) as unknown,
      createdAt: row.created_at,
      ...(row.finished_at === null ? {} : { finishedAt: row.finished_at }),
    });
  }
}
