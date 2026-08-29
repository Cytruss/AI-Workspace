import { describe, expect, test, vi } from "vitest";
import { createSiteReviewRunner } from "../../../src/site-review/site-review-runner.js";
import { SiteReviewAgentResponseSchema } from "../../../src/site-review/structured-response.js";
import type { ReviewBrowserBinding } from "../../../src/site-review/browser/types.js";

const response = {
  phase: "site-review" as const,
  summary: "Review complete",
  observations: [],
  findings: [],
  uncertainties: [],
  recommendations: [],
};

const browser: ReviewBrowserBinding = {
  configHome: "C:/config",
  mcpConfigPath: "C:/config/mcp.json",
  gateway: { command: "node", args: ["gateway.js"] },
  toolNames: [
    "list_pages",
    "open_page",
    "navigate_same_origin",
    "follow_visible_link",
    "inspect_rendered_page",
    "inspect_accessibility",
    "capture_screenshot",
    "read_console_summary",
    "read_network_summary",
  ],
};

describe("createSiteReviewRunner", () => {
  test("runs the requested provider with a per-agent browser binding", async () => {
    const codex = {
      runReview: vi
        .fn()
        .mockResolvedValue({ status: "completed", response, diagnostics: [] }),
    };
    const claude = { runReview: vi.fn() };
    const createBrowserBinding = vi.fn(() => browser);
    const runAgent = createSiteReviewRunner({
      codex,
      claude,
      workingDirectory: "C:/workspace",
      createBrowserBinding,
    });

    await expect(
      runAgent({
        reviewId: "review-1",
        agentId: "codex",
        url: "https://example.com/",
        focus: "signup",
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual(response);

    expect(createBrowserBinding).toHaveBeenCalledWith({
      reviewId: "review-1",
      agentId: "codex",
      url: "https://example.com/",
    });
    expect(codex.runReview).toHaveBeenCalledWith(
      expect.objectContaining({
        workingDirectory: "C:/workspace",
        browser,
        responseSchema: SiteReviewAgentResponseSchema,
        prompt: expect.stringContaining("signup"),
      }),
      expect.any(AbortSignal),
    );
  });

  test("surfaces a provider failure so the service can return partial results", async () => {
    const runAgent = createSiteReviewRunner({
      codex: {
        runReview: vi
          .fn()
          .mockResolvedValue({
            status: "failed",
            diagnostics: ["gateway unavailable"],
          }),
      },
      claude: { runReview: vi.fn() },
      workingDirectory: "C:/workspace",
      createBrowserBinding: () => browser,
    });

    await expect(
      runAgent({
        reviewId: "review-1",
        agentId: "codex",
        url: "https://example.com/",
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("codex failed: gateway unavailable");
  });
});
