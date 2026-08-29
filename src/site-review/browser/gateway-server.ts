import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { BrowserSessionFactory } from "./session-factory.js";
import { createChromeDevtoolsMcpConnection } from "./mcp-connection.js";
import { ReviewBrowserGateway } from "./policy-gateway.js";
import { UrlPolicy } from "../url-policy.js";

function required(name: string): string {
  const value = process.argv
    .slice(2)
    .find((entry) => entry.startsWith(`--${name}=`));
  if (value === undefined) throw new Error(`Missing --${name}`);
  return value.slice(name.length + 3);
}

async function main(): Promise<void> {
  const initial = await new UrlPolicy().validateInitial(required("url"));
  const require = createRequire(import.meta.url);
  const modulePath =
    require.resolve("chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js");
  const session = await new BrowserSessionFactory({
    modulePath,
    connect: createChromeDevtoolsMcpConnection,
  }).create({ logFile: required("log-file") });
  const gateway = new ReviewBrowserGateway({
    client: session.client,
    urlPolicy: new UrlPolicy(),
    initial,
  });
  const server = new McpServer({ name: "review-browser", version: "1.0.0" });
  for (const name of [
    "list_pages",
    "inspect_rendered_page",
    "inspect_accessibility",
    "capture_screenshot",
    "read_console_summary",
    "read_network_summary",
  ] as const) {
    server.registerTool(
      name,
      { inputSchema: {} },
      () => gateway.call(name, {}) as never,
    );
  }
  for (const name of [
    "open_page",
    "navigate_same_origin",
    "follow_visible_link",
  ] as const) {
    server.registerTool(
      name,
      { inputSchema: { url: z.url() } },
      ({ url }) => gateway.call(name, { url }) as never,
    );
  }
  process.once("SIGTERM", () => void session.close());
  process.once("SIGINT", () => void session.close());
  await server.connect(new StdioServerTransport());
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "gateway failed");
  process.exitCode = 1;
});
