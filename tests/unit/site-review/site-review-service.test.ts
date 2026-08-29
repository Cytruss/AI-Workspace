/* eslint-disable @typescript-eslint/require-await */
import { describe, expect, test } from "vitest";
import { SiteReviewService } from "../../../src/site-review/site-review-service.js";
import { UrlPolicy } from "../../../src/site-review/url-policy.js";
import { SiteReviewRepository } from "../../../src/storage/site-review-repository.js";
import { openDatabase } from "../../../src/storage/database.js";
import { migrateDatabase } from "../../../src/storage/migrations.js";
import { ActiveRuns } from "../../../src/orchestrator/active-runs.js";

const response = (summary: string) => ({
  phase: "site-review" as const,
  summary,
  observations: [],
  findings: [],
  uncertainties: [],
  recommendations: [],
});

describe("SiteReviewService", () => {
  test("runs both agents without an active project and compares results", async () => {
    const database = openDatabase(":memory:");
    migrateDatabase(database);
    const reviews = new SiteReviewRepository(database);
    const service = new SiteReviewService({
      reviews,
      policy: new UrlPolicy({ resolveHost: async () => ["93.184.216.34"] }),
      activeRuns: new ActiveRuns(),
      runAgent: async ({ agentId }) => response(agentId),
    });
    await expect(
      service.review({
        interactionId: "i1",
        scope: { guildId: "g", channelId: "c", userId: "u" },
        url: "https://example.com/",
      }),
    ).resolves.toMatchObject({ status: "completed" });
    const review = reviews.findByInteractionId("i1");
    expect(review).toBeDefined();
    expect(reviews.agentResponses(review?.id ?? "missing")).toHaveLength(2);
    expect(reviews.report(review?.id ?? "missing")).toMatchObject({
      status: "completed",
    });
    database.close();
  });

  test("persists cancellation when an active review is stopped", async () => {
    const database = openDatabase(":memory:");
    migrateDatabase(database);
    const activeRuns = new ActiveRuns();
    const reviews = new SiteReviewRepository(database);
    const service = new SiteReviewService({
      reviews,
      policy: new UrlPolicy({ resolveHost: async () => ["93.184.216.34"] }),
      activeRuns,
      runAgent: async ({ signal }) => {
        signal.throwIfAborted();
        activeRuns.cancel(activeRuns.list()[0]?.runId ?? "missing", "u");
        throw new DOMException("Cancelled", "AbortError");
      },
    });
    await expect(
      service.review({
        interactionId: "i2",
        scope: { guildId: "g", channelId: "c", userId: "u" },
        url: "https://example.com/",
      }),
    ).resolves.toMatchObject({ status: "cancelled" });
    const review = reviews.findByInteractionId("i2");
    expect(reviews.report(review?.id ?? "missing")).toMatchObject({
      status: "cancelled",
    });
    database.close();
  });

  test("replays a persisted terminal review without invoking agents again", async () => {
    const database = openDatabase(":memory:");
    migrateDatabase(database);
    let calls = 0;
    const service = new SiteReviewService({
      reviews: new SiteReviewRepository(database),
      policy: new UrlPolicy({ resolveHost: async () => ["93.184.216.34"] }),
      activeRuns: new ActiveRuns(),
      runAgent: async ({ agentId }) => {
        calls += 1;
        return response(agentId);
      },
    });
    const input = {
      interactionId: "i3",
      scope: { guildId: "g", channelId: "c", userId: "u" },
      url: "https://example.com/",
    };
    await service.review(input);
    await expect(service.review(input)).resolves.toMatchObject({
      status: "completed",
    });
    expect(calls).toBe(2);
    database.close();
  });

  test("persists a failed terminal review for interaction replay", async () => {
    const database = openDatabase(":memory:");
    migrateDatabase(database);
    const reviews = new SiteReviewRepository(database);
    const service = new SiteReviewService({
      reviews,
      policy: new UrlPolicy({ resolveHost: async () => ["93.184.216.34"] }),
      activeRuns: new ActiveRuns(),
      runAgent: async () => {
        throw new Error("provider unavailable");
      },
    });

    await expect(
      service.review({
        interactionId: "i4",
        scope: { guildId: "g", channelId: "c", userId: "u" },
        url: "https://example.com/",
      }),
    ).resolves.toMatchObject({ status: "failed" });
    const review = reviews.findByInteractionId("i4");
    expect(reviews.report(review?.id ?? "missing")).toMatchObject({
      status: "failed",
    });
    database.close();
  });
});
