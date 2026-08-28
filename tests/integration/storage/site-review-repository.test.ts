import { describe, expect, test } from "vitest";
import { SiteReviewRepository } from "../../../src/storage/site-review-repository.js";
import { openDatabase } from "../../../src/storage/database.js";
import { migrateDatabase } from "../../../src/storage/migrations.js";

describe("SiteReviewRepository", () => {
  test("creates idempotently and permits only legal lifecycle transitions", () => {
    const database = openDatabase(":memory:");
    migrateDatabase(database);
    const repository = new SiteReviewRepository(database);
    const input = {
      interactionId: "interaction-1",
      guildId: "guild-1",
      channelId: "channel-1",
      userId: "user-1",
      initialUrl: "https://example.com/",
      focus: "checkout flow",
    };

    const created = repository.create(input);
    expect(repository.create(input)).toEqual(created);
    repository.markRunning(created.id);
    repository.markCompleted(created.id);
    expect(repository.get(created.id)).toMatchObject({ status: "completed" });
    expect(() => repository.markRunning(created.id)).toThrow(
      "Invalid site review transition",
    );
    database.close();
  });

  test("returns reviews only from the caller's Discord scope", () => {
    const database = openDatabase(":memory:");
    migrateDatabase(database);
    const repository = new SiteReviewRepository(database);
    repository.create({
      interactionId: "interaction-1",
      guildId: "guild-1",
      channelId: "channel-1",
      userId: "user-1",
      initialUrl: "https://example.com/",
    });
    repository.create({
      interactionId: "interaction-2",
      guildId: "guild-1",
      channelId: "channel-1",
      userId: "user-2",
      initialUrl: "https://example.com/two",
    });

    expect(
      repository.recentForScope(
        { guildId: "guild-1", channelId: "channel-1", userId: "user-1" },
        10,
      ),
    ).toHaveLength(1);
    database.close();
  });
});
