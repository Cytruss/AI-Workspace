import { ReviewBrowserToolPolicy } from "./policy-gateway.js";
import type { ReviewBrowserToolName } from "./types.js";

interface RawDevtoolsPort {
  callTool(input: {
    name: string;
    arguments: Record<string, unknown>;
  }): Promise<unknown>;
}

const RAW_TOOL_NAMES: Readonly<Record<ReviewBrowserToolName, string>> = {
  list_pages: "list_pages",
  open_page: "new_page",
  navigate_same_origin: "navigate_page",
  follow_visible_link: "navigate_page",
  inspect_rendered_page: "take_snapshot",
  inspect_accessibility: "take_snapshot",
  capture_screenshot: "take_screenshot",
  read_console_summary: "list_console_messages",
  read_network_summary: "list_network_requests",
};

function navigationArguments(
  arguments_: Record<string, unknown>,
): Record<string, unknown> {
  if (typeof arguments_["url"] !== "string")
    throw new Error("Review navigation requires a URL");
  return {
    type: "url",
    url: arguments_["url"],
    handleBeforeUnload: "dismiss",
    timeout: 10_000,
  };
}

function safeArguments(
  tool: ReviewBrowserToolName,
  arguments_: Record<string, unknown>,
): Record<string, unknown> {
  if (tool === "open_page") return navigationArguments(arguments_);
  if (tool === "navigate_same_origin" || tool === "follow_visible_link")
    return navigationArguments(arguments_);
  return {};
}

export class ChromeDevtoolsClient {
  private readonly policy = new ReviewBrowserToolPolicy();

  constructor(private readonly port: RawDevtoolsPort) {}

  async call(
    tool: string,
    arguments_: Record<string, unknown>,
  ): Promise<unknown> {
    this.policy.assertAllowed(tool);
    const reviewTool = tool as ReviewBrowserToolName;
    return this.port.callTool({
      name: RAW_TOOL_NAMES[reviewTool],
      arguments: safeArguments(reviewTool, arguments_),
    });
  }
}
