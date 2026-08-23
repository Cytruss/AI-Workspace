import { describe, expect, it } from "vitest";
import { getAppPaths } from "../../../src/config/app-paths.js";

describe("getAppPaths", () => {
  it("uses XDG data on Linux", () => {
    expect(getAppPaths("linux", { XDG_DATA_HOME: "/data" })).toEqual({
      dataDir: "/data/ai-workspace",
      configFile: "/data/ai-workspace/config.json",
      databaseFile: "/data/ai-workspace/ai-workspace.sqlite",
      logDir: "/data/ai-workspace/logs",
    });
  });

  it("falls back to the Linux home data directory", () => {
    expect(getAppPaths("linux", { HOME: "/home/operator" }).dataDir).toBe(
      "/home/operator/.local/share/ai-workspace",
    );
  });

  it("uses APPDATA on Windows", () => {
    expect(getAppPaths("win32", { APPDATA: "C:\\AppData" }).dataDir).toBe(
      "C:\\AppData\\ai-workspace",
    );
  });

  it("uses the macOS Application Support directory", () => {
    expect(getAppPaths("darwin", { HOME: "/Users/operator" }).dataDir).toBe(
      "/Users/operator/Library/Application Support/ai-workspace",
    );
  });

  it("fails when the platform data directory cannot be resolved", () => {
    expect(() => getAppPaths("linux", {})).toThrow("HOME is required");
    expect(() => getAppPaths("win32", {})).toThrow("APPDATA is required");
  });
});
