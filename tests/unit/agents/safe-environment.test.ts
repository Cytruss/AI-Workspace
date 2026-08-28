import { describe, expect, test } from "vitest";
import { buildSafeEnvironment } from "../../../src/agents/safe-environment.js";

describe("buildSafeEnvironment", () => {
  test("preserves only runtime and adapter allowlisted variables", () => {
    const result = buildSafeEnvironment(
      {
        PATH: "runtime-path",
        LANG: "en_US.UTF-8",
        OPENAI_API_KEY: "adapter-secret",
        UNRELATED_SECRET: "remove-me",
        AI_WORKSPACE_DISCORD_TOKEN: "never-pass-me",
      },
      ["OPENAI_API_KEY", "AI_WORKSPACE_DISCORD_TOKEN"],
    );
    expect(result).toEqual({
      PATH: "runtime-path",
      LANG: "en_US.UTF-8",
      OPENAI_API_KEY: "adapter-secret",
    });
  });

  test.runIf(process.platform === "win32")(
    "normalizes allowlisted variable names on Windows",
    () => {
      expect(
        buildSafeEnvironment({ Path: "value", appdata: "config" }, []),
      ).toEqual({ PATH: "value", APPDATA: "config" });
    },
  );
});
