import { describe, expect, test } from "vitest";
import { compareSiteReviews } from "../../../src/site-review/comparison.js";
import type { SiteReviewAgentResponse } from "../../../src/site-review/structured-response.js";

function review(
  agentId: "codex" | "claude",
  finding: string,
  uncertainty?: string,
): Readonly<{
  agentId: "codex" | "claude";
  response: SiteReviewAgentResponse;
}> {
  return {
    agentId,
    response: {
      phase: "site-review",
      summary: "Public pricing page.",
      observations: [
        {
          id: `obs-${agentId}`,
          url: "https://example.com/pricing",
          title: "Pricing",
          viewport: "desktop",
          behavior: "Pricing is visible.",
        },
      ],
      findings: [
        {
          id: `finding-${agentId}`,
          category: "visual",
          statement: finding,
          observationIds: [`obs-${agentId}`],
        },
      ],
      uncertainties:
        uncertainty === undefined
          ? []
          : [
              {
                id: `uncertainty-${agentId}`,
                statement: uncertainty,
                observationIds: [`obs-${agentId}`],
              },
            ],
      recommendations: [],
    },
  };
}

describe("compareSiteReviews", () => {
  test("marks matching evidence-linked findings as agreed", () => {
    const result = compareSiteReviews(
      review("codex", "The plan comparison is easy to scan."),
      review("claude", "The plan comparison is easy to scan."),
    );

    expect(result.agreed).toEqual([
      {
        category: "visual",
        statement: "The plan comparison is easy to scan.",
        sourceAgents: ["claude", "codex"],
      },
    ]);
    expect(result.different).toEqual([]);
  });

  test("keeps non-matching findings separate", () => {
    const result = compareSiteReviews(
      review("codex", "The plan comparison is easy to scan."),
      review("claude", "The price labels are too small."),
    );

    expect(result.agreed).toEqual([]);
    expect(result.different.map((item) => item.statement)).toEqual([
      "The plan comparison is easy to scan.",
      "The price labels are too small.",
    ]);
  });

  test("retains agent uncertainties without presenting them as agreement", () => {
    const result = compareSiteReviews(
      review(
        "codex",
        "The plan comparison is easy to scan.",
        "Checkout was excluded by the safety policy.",
      ),
      review("claude", "The plan comparison is easy to scan."),
    );

    expect(result.uncertain).toEqual([
      {
        statement: "Checkout was excluded by the safety policy.",
        sourceAgents: ["codex"],
      },
    ]);
  });
});
