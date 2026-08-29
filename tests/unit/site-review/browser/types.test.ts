import { describe, expect, test } from "vitest";
import {
  REVIEW_BROWSER_TOOL_NAMES,
  createReviewBrowserBinding,
} from "../../../../src/site-review/browser/types.js";

describe("review browser binding", () => {
  test("exposes only the fixed review tool allowlist", () => {
    expect(REVIEW_BROWSER_TOOL_NAMES).toEqual([
      "list_pages",
      "open_page",
      "navigate_same_origin",
      "follow_visible_link",
      "inspect_rendered_page",
      "inspect_accessibility",
      "capture_screenshot",
      "read_console_summary",
      "read_network_summary",
    ]);
    expect(REVIEW_BROWSER_TOOL_NAMES).not.toContain("evaluate_script");
    expect(REVIEW_BROWSER_TOOL_NAMES).not.toContain("mcp__*");
  });

  test("keeps the generated MCP command and arguments as inert values", () => {
    const binding = createReviewBrowserBinding({
      configHome: "C:/private/codex-home",
      mcpConfigPath: "C:/private/claude-mcp.json",
      gatewayCommand: "node",
      gatewayArgs: ["C:/private/gateway.mjs", "--session", "r;$(inert)"],
    });

    expect(binding).toEqual({
      configHome: "C:/private/codex-home",
      mcpConfigPath: "C:/private/claude-mcp.json",
      gateway: {
        command: "node",
        args: ["C:/private/gateway.mjs", "--session", "r;$(inert)"],
      },
      toolNames: REVIEW_BROWSER_TOOL_NAMES,
    });
  });
});
