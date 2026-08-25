import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { openDatabase } from "../../../src/storage/database.js";
import { migrateDatabase } from "../../../src/storage/migrations.js";

const cleanup: string[] = [];
afterEach(() => {
  cleanup.splice(0).forEach((path) => {
    rmSync(path, { recursive: true, force: true });
  });
});

describe("SQLite database", () => {
  test("enables integrity and concurrency pragmas for file databases", () => {
    const directory = mkdtempSync(join(tmpdir(), "ai-workspace-storage-"));
    cleanup.push(directory);
    const database = openDatabase(join(directory, "state.sqlite"));
    expect(database.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(database.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(database.pragma("busy_timeout", { simple: true })).toBe(5000);
    database.close();
  });

  test("applies the initial migration once and enforces database checks", () => {
    const database = openDatabase(":memory:");
    migrateDatabase(database);
    migrateDatabase(database);
    expect(
      database.prepare("SELECT version FROM schema_migrations").all(),
    ).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }]);
    expect(() =>
      database
        .prepare("INSERT INTO active_projects VALUES (?, ?, ?, ?)")
        .run("g", "c", "u", "missing"),
    ).toThrow();
    database.close();
  });
});
