import { describe, expect, test } from "vitest";
import { requireHelpFlags } from "../../../src/agents/help-capabilities.js";

describe("requireHelpFlags", () => {
  test("accepts complete help option tokens", () => {
    expect(() => {
      requireHelpFlags("Usage: tool [--json] --read-only=<mode>", [
        "--json",
        "--read-only",
      ]);
    }).not.toThrow();
  });

  test("accepts a complete short option token", () => {
    expect(() => {
      requireHelpFlags("Usage: tool -C <directory> -p", ["-C", "-p"]);
    }).not.toThrow();
  });

  test("does not accept a longer option as a required token", () => {
    expect(() => {
      requireHelpFlags("Usage: tool --json-schema", ["--json", "--read-only"]);
    }).toThrow("Missing required CLI capabilities: --json, --read-only");
  });

  test("uses the singular actionable diagnostic", () => {
    expect(() => {
      requireHelpFlags("Usage: tool --json", ["--json", "--read-only"]);
    }).toThrow("Missing required CLI capability: --read-only");
    try {
      requireHelpFlags("Usage: tool", ["--json"]);
    } catch (error) {
      expect(error).toMatchObject({ code: "AGENT_CAPABILITY_UNSUPPORTED" });
    }
  });
});
