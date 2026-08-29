export const REVIEW_BROWSER_TOOL_NAMES = Object.freeze([
  "list_pages",
  "open_page",
  "navigate_same_origin",
  "follow_visible_link",
  "inspect_rendered_page",
  "inspect_accessibility",
  "capture_screenshot",
  "read_console_summary",
  "read_network_summary",
] as const);

export type ReviewBrowserToolName = (typeof REVIEW_BROWSER_TOOL_NAMES)[number];

export interface ReviewBrowserBinding {
  configHome: string;
  mcpConfigPath: string;
  gateway: Readonly<{
    command: string;
    args: readonly string[];
  }>;
  toolNames: typeof REVIEW_BROWSER_TOOL_NAMES;
}

export interface CreateReviewBrowserBindingInput {
  configHome: string;
  mcpConfigPath: string;
  gatewayCommand: string;
  gatewayArgs: readonly string[];
}

export function createReviewBrowserBinding(
  input: CreateReviewBrowserBindingInput,
): ReviewBrowserBinding {
  return Object.freeze({
    configHome: input.configHome,
    mcpConfigPath: input.mcpConfigPath,
    gateway: Object.freeze({
      command: input.gatewayCommand,
      args: Object.freeze([...input.gatewayArgs]),
    }),
    toolNames: REVIEW_BROWSER_TOOL_NAMES,
  });
}
