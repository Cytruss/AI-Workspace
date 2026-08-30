import { createHash, randomUUID } from "node:crypto";
import type { SiteReviewAgentResponse } from "../site-review/structured-response.js";
import type { ProjectScope } from "./project-repository.js";
import type { SqliteDatabase } from "./database.js";

export type SiteReviewStatus =
  "queued" | "running" | "completed" | "partial" | "failed" | "cancelled";

export interface CreateSiteReviewInput {
  interactionId: string;
  guildId: string;
  channelId: string;
  userId: string;
  initialUrl: string;
  focus?: string;
}

export interface SiteReviewRecord extends CreateSiteReviewInput {
  id: string;
  status: SiteReviewStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
}

interface Row {
  id: string;
  interaction_id: string;
  guild_id: string;
  channel_id: string;
  user_id: string;
  initial_url: string;
  focus: string | null;
  status: SiteReviewStatus;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

function record(row: Row): SiteReviewRecord {
  return Object.freeze({
    id: row.id,
    interactionId: row.interaction_id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    userId: row.user_id,
    initialUrl: row.initial_url,
    ...(row.focus === null ? {} : { focus: row.focus }),
    status: row.status,
    createdAt: row.created_at,
    ...(row.started_at === null ? {} : { startedAt: row.started_at }),
    ...(row.finished_at === null ? {} : { finishedAt: row.finished_at }),
  });
}

export class SiteReviewRepository {
  constructor(private readonly database: SqliteDatabase) {}

  create(input: CreateSiteReviewInput): SiteReviewRecord {
    const existing = this.findByInteractionId(input.interactionId);
    if (existing !== undefined) return existing;
    this.database
      .prepare(
        "INSERT INTO site_reviews (id, interaction_id, guild_id, channel_id, user_id, initial_url, focus, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?)",
      )
      .run(
        randomUUID(),
        input.interactionId,
        input.guildId,
        input.channelId,
        input.userId,
        input.initialUrl,
        input.focus ?? null,
        new Date().toISOString(),
      );
    return this.findByInteractionId(input.interactionId) as SiteReviewRecord;
  }

  findByInteractionId(interactionId: string): SiteReviewRecord | undefined {
    const row = this.database
      .prepare("SELECT * FROM site_reviews WHERE interaction_id=?")
      .get(interactionId) as Row | undefined;
    return row === undefined ? undefined : record(row);
  }

  get(id: string): SiteReviewRecord {
    const row = this.database
      .prepare("SELECT * FROM site_reviews WHERE id=?")
      .get(id) as Row | undefined;
    if (row === undefined) throw new Error(`Site review not found: ${id}`);
    return record(row);
  }

  recentForScope(
    scope: ProjectScope,
    limit: number,
  ): readonly SiteReviewRecord[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new Error("Recent review limit must be between 1 and 100");
    return (
      this.database
        .prepare(
          "SELECT * FROM site_reviews WHERE guild_id=? AND channel_id=? AND user_id=? ORDER BY created_at DESC, id DESC LIMIT ?",
        )
        .all(scope.guildId, scope.channelId, scope.userId, limit) as Row[]
    ).map(record);
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

  persistAgentResponse(
    reviewId: string,
    agentId: "codex" | "claude",
    response: SiteReviewAgentResponse,
  ): void {
    const now = new Date().toISOString();
    const runId = randomUUID();
    this.database.transaction(() => {
      this.database
        .prepare(
          "INSERT INTO site_review_agent_runs (id, review_id, agent_id, observed_model_ids_json, model_verification, gateway_session_id, status, response_json, diagnostics_json, created_at, finished_at) VALUES (?, ?, ?, '[]', 'unverified', ?, 'completed', ?, '[]', ?, ?)",
        )
        .run(
          runId,
          reviewId,
          agentId,
          randomUUID(),
          JSON.stringify(response),
          now,
          now,
        );
      for (const observation of response.observations) {
        this.database
          .prepare(
            "INSERT INTO site_observations (id, review_id, agent_run_id, url, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
          )
          .run(
            observation.id,
            reviewId,
            runId,
            observation.url,
            JSON.stringify(observation),
            now,
          );
      }
      for (const finding of response.findings) {
        this.database
          .prepare(
            "INSERT INTO site_findings (id, review_id, agent_run_id, category, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
          )
          .run(
            finding.id,
            reviewId,
            runId,
            finding.category,
            JSON.stringify(finding),
            now,
          );
      }
      for (const uncertainty of response.uncertainties) {
        this.database
          .prepare(
            "INSERT INTO site_uncertainties (id, review_id, agent_run_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?)",
          )
          .run(
            uncertainty.id,
            reviewId,
            runId,
            JSON.stringify(uncertainty),
            now,
          );
      }
      for (const recommendation of response.recommendations) {
        this.database
          .prepare(
            "INSERT INTO site_recommendations (id, review_id, agent_run_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?)",
          )
          .run(
            recommendation.id,
            reviewId,
            runId,
            JSON.stringify(recommendation),
            now,
          );
      }
    })();
  }

  persistAgentFailure(
    reviewId: string,
    agentId: "codex" | "claude",
    diagnostics: readonly string[],
  ): void {
    const now = new Date().toISOString();
    this.database
      .prepare(
        "INSERT INTO site_review_agent_runs (id, review_id, agent_id, observed_model_ids_json, model_verification, gateway_session_id, status, diagnostics_json, created_at, finished_at) VALUES (?, ?, ?, '[]', 'unverified', ?, 'failed', ?, ?, ?)",
      )
      .run(
        randomUUID(),
        reviewId,
        agentId,
        randomUUID(),
        JSON.stringify(diagnostics),
        now,
        now,
      );
  }

  agentResponses(reviewId: string): readonly {
    agentId: string;
    status: string;
    response: SiteReviewAgentResponse;
  }[] {
    return (
      this.database
        .prepare(
          "SELECT agent_id, status, response_json FROM site_review_agent_runs WHERE review_id=? AND status='completed' ORDER BY agent_id",
        )
        .all(reviewId) as {
        agent_id: string;
        status: string;
        response_json: string;
      }[]
    ).map((row) => ({
      agentId: row.agent_id,
      status: row.status,
      response: JSON.parse(row.response_json) as SiteReviewAgentResponse,
    }));
  }

  persistReport(reviewId: string, report: unknown): void {
    const payload = JSON.stringify(report);
    this.database
      .prepare(
        "INSERT OR REPLACE INTO site_review_reports (review_id, payload_json, content_hash, created_at) VALUES (?, ?, ?, ?)",
      )
      .run(
        reviewId,
        payload,
        createHash("sha256").update(payload).digest("hex"),
        new Date().toISOString(),
      );
  }

  report(reviewId: string): unknown {
    const row = this.database
      .prepare("SELECT payload_json FROM site_review_reports WHERE review_id=?")
      .get(reviewId) as { payload_json: string } | undefined;
    return row === undefined ? undefined : JSON.parse(row.payload_json);
  }

  private transition(
    id: string,
    from: readonly SiteReviewStatus[],
    to: SiteReviewStatus,
  ): void {
    const now = new Date().toISOString();
    const changes = this.database
      .prepare(
        `UPDATE site_reviews SET status=?, started_at=CASE WHEN ?='running' THEN ? ELSE started_at END, finished_at=CASE WHEN ? IN ('completed','partial','failed','cancelled') THEN ? ELSE finished_at END WHERE id=? AND status IN (${from.map(() => "?").join(",")})`,
      )
      .run(to, to, now, to, now, id, ...from).changes;
    if (changes !== 1)
      throw new Error(`Invalid site review transition to ${to}`);
  }
}
