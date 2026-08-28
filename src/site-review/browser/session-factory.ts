import { buildChromeDevtoolsArguments } from "./chrome-launch.js";
import { ChromeDevtoolsClient } from "./chrome-devtools-client.js";

const REQUIRED_RAW_TOOLS = [
  "list_pages",
  "new_page",
  "navigate_page",
  "take_snapshot",
  "take_screenshot",
  "list_console_messages",
  "list_network_requests",
] as const;

export interface RawBrowserConnection {
  listTools(): Promise<readonly string[]>;
  callTool(input: {
    name: string;
    arguments: Record<string, unknown>;
  }): Promise<unknown>;
  close(): Promise<void>;
}

export interface BrowserSessionFactoryDependencies {
  modulePath: string;
  connect(input: {
    command: string;
    args: readonly string[];
  }): Promise<RawBrowserConnection>;
}

export class BrowserSessionFactoryError extends Error {
  readonly code = "SITE_BROWSER_CAPABILITY_UNAVAILABLE";

  constructor(message: string) {
    super(message);
    this.name = "BrowserSessionFactoryError";
  }
}

export class BrowserSessionFactory {
  constructor(
    private readonly dependencies: BrowserSessionFactoryDependencies,
  ) {}

  async create(input: { logFile: string }): Promise<{
    client: ChromeDevtoolsClient;
    close(): Promise<void>;
  }> {
    const connection = await this.dependencies.connect({
      command: process.execPath,
      args: [
        this.dependencies.modulePath,
        ...buildChromeDevtoolsArguments({ logFile: input.logFile }),
      ],
    });
    try {
      const available = new Set(await connection.listTools());
      const missing = REQUIRED_RAW_TOOLS.find((tool) => !available.has(tool));
      if (missing !== undefined) {
        throw new BrowserSessionFactoryError(
          `Chrome DevTools MCP is missing required tool: ${missing}`,
        );
      }
      return Object.freeze({
        client: new ChromeDevtoolsClient(connection),
        close: () => connection.close(),
      });
    } catch (error) {
      await connection.close();
      throw error;
    }
  }
}
