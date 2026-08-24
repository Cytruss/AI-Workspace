import { describe, expect, test } from "vitest";
import { createInitialClaimBoard } from "../../../src/debate/claim-board.js";

describe("createInitialClaimBoard", () => {
  test("merges normalized duplicate claims while retaining both origins", async () => {
    const board = await createInitialClaimBoard(process.cwd(), [
      {
        agentId: "codex",
        runId: "run-c",
        response: {
          phase: "initial",
          evidence: [],
          claims: [
            {
              localId: "c1",
              text: "  Same\nclaim ",
              material: true,
              evidenceLocalIds: [],
            },
          ],
        } as never,
      },
      {
        agentId: "claude",
        runId: "run-a",
        response: {
          phase: "initial",
          evidence: [],
          claims: [
            {
              localId: "c2",
              text: "Same claim",
              material: true,
              evidenceLocalIds: [],
            },
          ],
        } as never,
      },
    ]);

    expect(board.claims).toHaveLength(1);
    expect(board.claims[0]).toMatchObject({
      id: "claim-0001",
      text: "Same claim",
    });
    expect(board.claims[0]?.origins.map((origin) => origin.agentId)).toEqual([
      "claude",
      "codex",
    ]);
  });
});
