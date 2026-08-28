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

export class ChromeDevtoolsClient {
  private readonly policy = new ReviewBrowserToolPolicy();

  constructor(private readonly port: RawDevtoolsPort) {}

  async call(
    tool: string,
    arguments_: Record<string, unknown>,
  ): Promise<unknown> {
    this.policy.assertAllowed(tool);
    return this.port.callTool({
      name: RAW_TOOL_NAMES[tool as ReviewBrowserToolName],
      arguments: arguments_,
    });
  }
}
