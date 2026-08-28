import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

interface McpTransport {
  close(): Promise<void>;
}

interface McpClient {
  connect(transport: McpTransport): Promise<void>;
  listTools(): Promise<{ tools: readonly { name: string }[] }>;
  callTool(input: {
    name: string;
    arguments: Record<string, unknown>;
  }): Promise<unknown>;
}

export interface ChromeDevtoolsMcpConnection {
  listTools(): Promise<readonly string[]>;
  callTool(input: {
    name: string;
    arguments: Record<string, unknown>;
  }): Promise<unknown>;
  close(): Promise<void>;
}

export interface ChromeDevtoolsMcpConnectionDependencies {
  createTransport(input: {
    command: string;
    args: readonly string[];
    stderr: "pipe";
  }): McpTransport;
  createClient(): McpClient;
}

const defaultDependencies: ChromeDevtoolsMcpConnectionDependencies = {
  createTransport: (input) =>
    new StdioClientTransport({
      command: input.command,
      args: [...input.args],
      stderr: input.stderr,
    }),
  createClient: () => {
    const client = new Client({
      name: "ai-workspace-site-review",
      version: "0.1.0",
    });
    return {
      connect: (transport) => client.connect(transport as Transport),
      listTools: () => client.listTools(),
      callTool: (input) => client.callTool(input),
    };
  },
};

export async function createChromeDevtoolsMcpConnection(
  input: { command: string; args: readonly string[] },
  dependencies: ChromeDevtoolsMcpConnectionDependencies = defaultDependencies,
): Promise<ChromeDevtoolsMcpConnection> {
  const transport = dependencies.createTransport({
    command: input.command,
    args: input.args,
    stderr: "pipe",
  });
  const client = dependencies.createClient();

  try {
    await client.connect(transport);
  } catch (error) {
    await transport.close();
    throw error;
  }

  return Object.freeze({
    listTools: async () =>
      (await client.listTools()).tools.map((tool) => tool.name),
    callTool: (tool: { name: string; arguments: Record<string, unknown> }) =>
      client.callTool(tool),
    close: () => transport.close(),
  });
}
