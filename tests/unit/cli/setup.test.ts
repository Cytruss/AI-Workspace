import { PassThrough } from "node:stream";
import { describe, expect, test } from "vitest";
import type { AppPaths } from "../../../src/config/app-paths.js";
import type { AppConfig } from "../../../src/config/schema.js";
import {
  collectSetupDraft,
  readSecret,
  writeSetupDraft,
  type SetupDependencies,
  type SetupIo,
} from "../../../src/cli/setup.js";

const paths: AppPaths = {
  dataDir: "C:/Users/test/AppData/Roaming/ai-workspace",
  configFile: "C:/Users/test/AppData/Roaming/ai-workspace/config.json",
  databaseFile:
    "C:/Users/test/AppData/Roaming/ai-workspace/ai-workspace.sqlite",
  logDir: "C:/Users/test/AppData/Roaming/ai-workspace/logs",
};

function setupIo(
  answers: string[],
  token = "secret-token",
): {
  io: SetupIo;
  rendered: string[];
} {
  const rendered: string[] = [];
  return {
    io: {
      ask: async () => {
        const answer = answers.shift();
        if (answer === undefined) throw new Error("Unexpected setup prompt");
        return answer;
      },
      readSecret: async () => token,
      write: (line) => rendered.push(line),
    },
    rendered,
  };
}

function setupDependencies(): {
  dependencies: SetupDependencies;
  savedConfigs: AppConfig[];
  environmentLines: string[];
} {
  const savedConfigs: AppConfig[] = [];
  const environmentLines: string[] = [];
  return {
    dependencies: {
      resolveAgentCommand: async ({ configuredCommand }) => ({
        command: configuredCommand,
        source: "configured",
        diagnostic: "Configured native executable was verified with --version.",
      }),
      saveConfig: async (_configFile, config) => {
        savedConfigs.push(config);
      },
      writeEnvironmentFile: async (_envFile, line) => {
        environmentLines.push(line);
      },
    },
    savedConfigs,
    environmentLines,
  };
}

const initialAnswers = [
  "application-id",
  "guild-one, guild-two",
  "user-one, user-two",
  `workspace|AI Workspace|${process.cwd()}`,
  "",
  "C:/tools/codex.exe",
  "yes",
  "",
  "",
  "C:/tools/claude.exe",
  "yes",
  "",
  "",
];

describe("readSecret", () => {
  test("reads a token without writing it to the terminal output", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const rendered: Buffer[] = [];
    output.on("data", (chunk: Buffer) => rendered.push(chunk));
    const reading = readSecret(input, output, "Discord token: ");
    input.end("secret-token\n");

    await expect(reading).resolves.toBe("secret-token");
    expect(Buffer.concat(rendered).toString("utf8")).not.toContain(
      "secret-token",
    );
  });
});

describe("setup draft persistence", () => {
  test("declining final confirmation writes neither configuration nor environment", async () => {
    const { io } = setupIo([...initialAnswers, "no"]);
    const { dependencies, savedConfigs, environmentLines } =
      setupDependencies();

    await expect(collectSetupDraft(io, dependencies)).rejects.toThrow(
      "Setup cancelled before writing local files",
    );

    expect(savedConfigs).toEqual([]);
    expect(environmentLines).toEqual([]);
  });

  test("writes the completed setup draft and never renders its token", async () => {
    const { io, rendered } = setupIo([...initialAnswers, "yes"]);
    const { dependencies, savedConfigs, environmentLines } =
      setupDependencies();

    const draft = await collectSetupDraft(io, dependencies);
    await writeSetupDraft(draft, paths, "C:/setup-workspace", dependencies);

    expect(savedConfigs).toEqual([
      {
        version: 1,
        mode: "observe",
        discord: {
          applicationId: "application-id",
          guildIds: ["guild-one", "guild-two"],
          allowedUserIds: ["user-one", "user-two"],
          tokenEnv: "AI_WORKSPACE_DISCORD_TOKEN",
        },
        projects: [
          {
            id: "workspace",
            name: "AI Workspace",
            root: process.cwd(),
          },
        ],
        agents: {
          codex: {
            command: "C:/tools/codex.exe",
            timeoutMs: 300_000,
            maxOutputBytes: 1_048_576,
            models: { selections: [] },
          },
          claude: {
            command: "C:/tools/claude.exe",
            timeoutMs: 300_000,
            maxOutputBytes: 1_048_576,
            models: { selections: [] },
          },
        },
        debate: {
          maxRounds: 3,
          maxBoardClaims: 40,
          maxBoardBytes: 65_536,
        },
        concurrency: 2,
        logging: { level: "info" },
        retention: { mode: "manual" },
      },
    ]);
    expect(environmentLines).toEqual([
      "AI_WORKSPACE_DISCORD_TOKEN=secret-token\n",
    ]);
    expect(rendered.join("")).not.toContain("secret-token");
  });
});
