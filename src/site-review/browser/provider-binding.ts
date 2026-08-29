import type { ReviewBrowserBinding, ReviewBrowserToolName } from "./types.js";

type BindingSource = Pick<ReviewBrowserBinding, "gateway"> & {
  toolNames: readonly ReviewBrowserToolName[];
};

function tomlString(value: string): string {
  return JSON.stringify(value);
}

export function renderCodexReviewMcpConfig(binding: BindingSource): string {
  return [
    "[mcp_servers.review_browser]",
    `command = ${tomlString(binding.gateway.command)}`,
    `args = [${binding.gateway.args.map(tomlString).join(", ")}]`,
    "",
  ].join("\n");
}

export function renderClaudeReviewMcpConfig(binding: BindingSource): {
  config: string;
  allowedTools: string;
} {
  return Object.freeze({
    config: JSON.stringify({
      mcpServers: {
        review_browser: {
          command: binding.gateway.command,
          args: binding.gateway.args,
        },
      },
    }),
    allowedTools: binding.toolNames
      .map((name) => `mcp__review_browser__${name}`)
      .join(","),
  });
}
