import { describe, expect, test } from "vitest";
import { deriveVerdict } from "../../../src/debate/verdicts.js";

describe("deriveVerdict", () => {
  test.each([
    ["ACCEPT", "ACCEPT", "CONSENSUS"],
    ["ACCEPT", "DISPUTE", "DISAGREEMENT"],
    ["DISPUTE", "ACCEPT", "DISAGREEMENT"],
    ["DISPUTE", "DISPUTE", "REJECTED"],
    ["UNCERTAIN", "ACCEPT", "UNRESOLVED"],
    ["UNCERTAIN", "DISPUTE", "UNRESOLVED"],
    ["UNCERTAIN", "UNCERTAIN", "UNRESOLVED"],
  ] as const)("maps %s/%s to %s", (codex, claude, expected) => {
    expect(deriveVerdict([codex, claude])).toBe(expected);
  });

  test("fails closed unless there are exactly two final positions", () => {
    expect(deriveVerdict([])).toBe("UNRESOLVED");
    expect(deriveVerdict(["ACCEPT"])).toBe("UNRESOLVED");
    expect(deriveVerdict(["ACCEPT", "ACCEPT", "ACCEPT"])).toBe("UNRESOLVED");
  });
});
