import { describe, expect, test } from "vitest";
import { parseCommand } from "../../../src/cli/parse-command.js";

describe("parseCommand", () => {
  test.each(["setup", "onboarding", "doctor", "start"] as const)(
    "parses the %s command exactly",
    (name) => {
      expect(parseCommand([name])).toEqual({ name });
    },
  );

  test.each([[[]], [["help"]], [["setup", "extra"]], [["START"]]])(
    "rejects unsupported command arguments",
    (argv) => {
      expect(() => parseCommand(argv)).toThrow("Usage: ai-workspace");
    },
  );
});
