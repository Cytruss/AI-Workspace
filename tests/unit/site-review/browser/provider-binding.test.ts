import { describe, expect, test } from "vitest";
import {
  renderClaudeReviewMcpConfig,
  renderCodexReviewMcpConfig,
} from "../../../../src/site-review/browser/provider-binding.js";

const binding = {
  gateway: {
    command: "node",
    args: ["C:/private/gateway.js", "--review", "r1"],
  },
  toolNames: ["list_pages", "inspect_rendered_page"] as const,
};

describe("review provider bindings", () => {
  test("renders a single explicit Codex stdio server", () => {
    expect(renderCodexReviewMcpConfig(binding)).toBe(
      '[mcp_servers.review_browser]\ncommand = "node"\nargs = ["C:/private/gateway.js", "--review", "r1"]\n',
    );
  });

  test("renders Claude config and its exact MCP allowlist", () => {
    expect(renderClaudeReviewMcpConfig(binding)).toEqual({
      config: JSON.stringify({
        mcpServers: {
          review_browser: {
            command: "node",
            args: ["C:/private/gateway.js", "--review", "r1"],
          },
        },
      }),
      allowedTools:
        "mcp__review_browser__list_pages,mcp__review_browser__inspect_rendered_page",
    });
  });
});
