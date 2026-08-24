import { describe, expect, test } from "vitest";
import {
  DebateContextLimitError,
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
