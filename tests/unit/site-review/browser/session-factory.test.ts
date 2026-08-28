import { describe, expect, test, vi } from "vitest";
import {
  BrowserSessionFactory,
  BrowserSessionFactoryError,
} from "../../../../src/site-review/browser/session-factory.js";

const rawTools = [
  "list_pages",
  "new_page",
  "navigate_page",
  "take_snapshot",
  "take_screenshot",
  "list_console_messages",
  "list_network_requests",
];

describe("BrowserSessionFactory", () => {
  test("connects one raw DevTools process with isolated arguments", async () => {
    const close = vi.fn(async () => undefined);
    const callTool = vi.fn(async () => ({ content: [] }));
    const connect = vi.fn(async () => ({
      listTools: async () => rawTools,
      callTool,
      close,
    }));
    const factory = new BrowserSessionFactory({
      modulePath: "C:/app/node_modules/chrome-devtools-mcp/bin.js",
      connect,
    });

    const session = await factory.create({
      logFile: "C:/private/review-1/codex/devtools.log",
    });

    expect(connect).toHaveBeenCalledWith({
      command: process.execPath,
      args: [
        "C:/app/node_modules/chrome-devtools-mcp/bin.js",
        "--headless",
        "--isolated",
        "--logFile",
        "C:/private/review-1/codex/devtools.log",
      ],
    });
    await session.client.call("inspect_rendered_page", { verbose: false });
    expect(callTool).toHaveBeenCalledWith({
      name: "take_snapshot",
      arguments: { verbose: false },
    });
    await session.close();
    expect(close).toHaveBeenCalledOnce();
  });

  test("fails closed and closes the connection when a raw capability is missing", async () => {
    const close = vi.fn(async () => undefined);
    const factory = new BrowserSessionFactory({
      modulePath: "C:/app/node_modules/chrome-devtools-mcp/bin.js",
      connect: async () => ({
        listTools: async () => ["list_pages"],
        callTool: async () => ({ content: [] }),
        close,
      }),
    });

    await expect(
      factory.create({ logFile: "C:/private/review-1/codex/devtools.log" }),
    ).rejects.toThrow(BrowserSessionFactoryError);
    expect(close).toHaveBeenCalledOnce();
  });
});
