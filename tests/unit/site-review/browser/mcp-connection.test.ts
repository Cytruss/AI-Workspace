/* eslint-disable @typescript-eslint/require-await */
import { describe, expect, test, vi } from "vitest";
import { createChromeDevtoolsMcpConnection } from "../../../../src/site-review/browser/mcp-connection.js";

describe("createChromeDevtoolsMcpConnection", () => {
  test("connects the stdio client and exposes only the required raw port operations", async () => {
    const close = vi.fn(async () => undefined);
    const transport = { close };
    const connect = vi.fn(async () => undefined);
    const listTools = vi.fn(async () => ({
      tools: [{ name: "list_pages" }, { name: "navigate_page" }],
    }));
    const callTool = vi.fn(async () => ({
      content: [{ type: "text", text: "ok" }],
    }));
    const createTransport = vi.fn(() => transport);
    const createClient = vi.fn(() => ({ connect, listTools, callTool }));

    const connection = await createChromeDevtoolsMcpConnection(
      {
        command: process.execPath,
        args: ["C:/app/node_modules/chrome-devtools-mcp/bin.js", "--isolated"],
      },
      { createTransport, createClient },
    );

    expect(createTransport).toHaveBeenCalledWith({
      command: process.execPath,
      args: ["C:/app/node_modules/chrome-devtools-mcp/bin.js", "--isolated"],
      stderr: "pipe",
    });
    expect(connect).toHaveBeenCalledWith(transport);
    await expect(connection.listTools()).resolves.toEqual([
      "list_pages",
      "navigate_page",
    ]);
    await connection.callTool({
      name: "navigate_page",
      arguments: { url: "https://example.com" },
    });
    expect(callTool).toHaveBeenCalledWith({
      name: "navigate_page",
      arguments: { url: "https://example.com" },
    });
    await connection.close();
    expect(close).toHaveBeenCalledOnce();
  });

  test("closes the transport if the MCP initialization fails", async () => {
    const close = vi.fn(async () => undefined);
    const createTransport = vi.fn(() => ({ close }));
    const createClient = vi.fn(() => ({
      connect: async () => {
        throw new Error("server did not initialize");
      },
      listTools: async () => ({ tools: [] }),
      callTool: async () => ({ content: [] }),
    }));

    await expect(
      createChromeDevtoolsMcpConnection(
        { command: process.execPath, args: ["server.js"] },
        { createTransport, createClient },
      ),
    ).rejects.toThrow("server did not initialize");
    expect(close).toHaveBeenCalledOnce();
  });
});
