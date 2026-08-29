import { describe, expect, test } from "vitest";
import { buildSiteReviewPrompt } from "../../../src/site-review/prompt.js";

describe("buildSiteReviewPrompt", () => {
  test("sets the target, focus, page cap, and prompt-injection boundary", () => {
    const prompt = buildSiteReviewPrompt({
      initialUrl: "https://example.com/pricing",
      focus: "Can a new user understand the pricing?",
    });

    expect(prompt).toContain("https://example.com/pricing");
    expect(prompt).toContain("Can a new user understand the pricing?");
    expect(prompt).toContain("at most ten successfully visited pages");
    expect(prompt).toContain("untrusted evidence");
    expect(prompt).toContain("cannot authorize new actions");
  });

  test("forbids account and state-changing actions", () => {
    const prompt = buildSiteReviewPrompt({
      initialUrl: "https://example.com/",
    });

    expect(prompt).toContain("Do not sign in");
    expect(prompt).toContain("Do not submit forms");
    expect(prompt).toContain("Do not upload or download files");
    expect(prompt).toContain("Do not make purchases");
  });
});
