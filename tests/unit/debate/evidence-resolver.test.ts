import { describe, expect, test } from "vitest";
import { resolveEvidence } from "../../../src/debate/evidence-resolver.js";

describe("resolveEvidence", () => {
  test("rejects an escaping path mechanically", async () => {
    await expect(
      resolveEvidence(process.cwd(), { trackedPath: "../outside.txt" }),
    ).resolves.toMatchObject({ status: "INVALID" });
  });
});
