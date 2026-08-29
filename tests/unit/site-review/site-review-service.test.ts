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
    const service = new SiteReviewService({
      reviews: new SiteReviewRepository(database),
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
    database.close();
  });

  test("persists cancellation when an active review is stopped", async () => {
    const database = openDatabase(":memory:");
    migrateDatabase(database);
    const activeRuns = new ActiveRuns();
    const service = new SiteReviewService({
      reviews: new SiteReviewRepository(database),
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
    database.close();
  });
});
