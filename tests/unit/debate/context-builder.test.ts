import { describe, expect, test } from "vitest";
import {
  DebateContextLimitError,
  carryStanceEvidence,
  buildDeliberationContext,
} from "../../../src/debate/context-builder.js";

const board = {
  version: 1,
  claims: [
    {
      id: "claim-0001" as never,
      text: "A material claim",
      material: true,
      evidenceIds: [],
      origins: [
        { agentId: "codex", agentRunId: "run", providerLocalId: "local" },
      ],
    },
  ],
  evidence: [],
};

describe("buildDeliberationContext", () => {
  test("carries evidence cited during cross-examination into later compact board context", () => {
    const carried = carryStanceEvidence(
      {
        ...board,
        evidence: [
          {
            id: "evidence-0001" as never,
            status: "VERIFIED" as const,
            trackedPath: "src/example.ts",
            origins: [
              {
                agentId: "claude",
                agentRunId: "cross-run",
                providerLocalId: "new-evidence",
              },
            ],
          },
        ],
      },
      [
        {
          claimId: "claim-0001" as never,
          value: "DISPUTE",
          reasoning: "The implementation differs",
          evidenceIds: ["evidence-0001" as never],
          agentId: "claude",
          agentRunId: "cross-run",
          roundId: "cross-round",
        },
      ],
    );

    const next = buildDeliberationContext(
      { maxRounds: 2, maxBoardClaims: 2, maxBoardBytes: 4096 },
      {
        phase: "final",
        topic: "topic",
        rules: [],
        board: carried,
        reviewClaimIds: ["claim-0001"],
        responseSchema: "final",
      },
    );

    expect(next.board.claims[0]?.evidenceIds).toEqual(["evidence-0001"]);
    expect(next.board.evidence.map((item) => item.id)).toEqual([
      "evidence-0001",
    ]);
  });

  test("fails rather than truncating a board over its claim limit", () => {
    expect(() =>
      buildDeliberationContext(
        { maxRounds: 1, maxBoardClaims: 0, maxBoardBytes: 4096 },
        {
          phase: "final",
          topic: "topic",
          rules: [],
          board,
          reviewClaimIds: ["claim-0001"],
          responseSchema: "final",
        },
      ),
    ).toThrow(DebateContextLimitError);
  });
});
