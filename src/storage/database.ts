import Database from "better-sqlite3";

export type SqliteDatabase = Database.Database;

export function openDatabase(filename: string): SqliteDatabase {
  const database = new Database(filename);
  try {
    database.pragma("foreign_keys = ON");
    database.pragma("busy_timeout = 5000");
    if (filename !== ":memory:") database.pragma("journal_mode = WAL");
    return database;
  } catch (error: unknown) {
    database.close();
    throw error;
  }
}
