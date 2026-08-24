import { describe, expect, test } from "vitest";
import { canonicalizeEvidence } from "../../../src/debate/evidence-canonicalizer.js";

describe("canonicalizeEvidence", () => {
  test("keeps same local IDs from separate runs distinct while merging identical references", async () => {
    const evidence = await canonicalizeEvidence(process.cwd(), [
      {
        agentId: "codex",
        runId: "run-c",
        draft: { localId: "e1", trackedPath: "missing-file" } as never,
      },
      {
        agentId: "claude",
        runId: "run-a",
        draft: { localId: "e1", trackedPath: "missing-file" } as never,
      },
    ]);
    expect(evidence.evidence).toHaveLength(1);
    expect(evidence.evidence[0]?.id).toBe("evidence-0001");
    expect(evidence.evidence[0]?.origins).toHaveLength(2);
  });
});
