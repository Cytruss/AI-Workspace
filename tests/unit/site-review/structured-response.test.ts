import { describe, expect, test } from "vitest";
import { SiteReviewAgentResponseSchema } from "../../../src/site-review/structured-response.js";

const valid = {
  phase: "site-review",
  summary: "A public pricing page.",
  observations: [
    {
      id: "obs-1",
      url: "https://example.com/pricing",
      title: "Pricing",
      viewport: "desktop",
      behavior: "The plans are visible without signing in.",
    },
  ],
  findings: [
    {
      id: "finding-1",
      category: "visual",
      statement: "The price comparison is easy to scan.",
      observationIds: ["obs-1"],
    },
  ],
  uncertainties: [],
  recommendations: [],
};

describe("SiteReviewAgentResponseSchema", () => {
  test("accepts findings supported by a recorded observation", () => {
    expect(SiteReviewAgentResponseSchema.parse(valid)).toMatchObject(valid);
  });

  test("rejects a finding that references an unknown observation", () => {
    expect(() =>
      SiteReviewAgentResponseSchema.parse({
        ...valid,
        findings: [
          {
            ...valid.findings[0],
            observationIds: ["invented-observation"],
          },
        ],
      }),
    ).toThrow("unknown observation");
  });

  test("keeps recommendations separate from observed findings", () => {
    expect(() =>
      SiteReviewAgentResponseSchema.parse({
        ...valid,
        recommendations: [
          {
            id: "recommendation-1",
            statement: "Add a comparison toggle.",
            observationIds: ["obs-1"],
          },
        ],
      }),
    ).not.toThrow();
  });
});
