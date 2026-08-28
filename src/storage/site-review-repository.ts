import { randomUUID } from "node:crypto";
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
