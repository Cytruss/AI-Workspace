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

type SetupEvent =
  | { kind: "ask"; text: string }
  | { kind: "secret"; text: string }
  | { kind: "write"; text: string };

function setupIo(
  answers: string[],
  token = "secret-token",
): {
  io: SetupIo;
  rendered: string[];
  events: SetupEvent[];
} {
  const rendered: string[] = [];
  const events: SetupEvent[] = [];
  return {
    io: {
      ask: (question) => {
        events.push({ kind: "ask", text: question });
        const answer = answers.shift();
        if (answer === undefined)
          return Promise.reject(new Error("Unexpected setup prompt"));
        return Promise.resolve(answer);
      },
      readSecret: (prompt) => {
        events.push({ kind: "secret", text: prompt });
        return Promise.resolve(token);
      },
      write: (line) => {
        events.push({ kind: "write", text: line });
        rendered.push(line);
      },
    },
    rendered,
    events,
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
      resolveAgentCommand: ({ configuredCommand }) =>
        Promise.resolve({
          command: configuredCommand,
          source: "configured",
          diagnostic:
            "Configured native executable was verified with --version.",
        }),
      saveConfig: (_configFile, config) => {
        savedConfigs.push(config);
        return Promise.resolve();
      },
      writeEnvironmentFile: (_envFile, line) => {
        environmentLines.push(line);
        return Promise.resolve();
      },
    },
    savedConfigs,
    environmentLines,
  };
}

describe("setup IO", () => {
  test("rejects asynchronously when scripted answers are exhausted", async () => {
    const { io } = setupIo([]);

    await expect(io.ask("Discord application ID: ")).rejects.toThrow(
      "Unexpected setup prompt",
    );
  });
});

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

  test("reports Ctrl+C with the stable setup cancellation code", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const reading = readSecret(input, output, "Discord token: ");
    input.end("\u0003");

    await expect(reading).rejects.toMatchObject({ code: "SETUP_CANCELLED" });
  });
});

describe("setup draft persistence", () => {
  test.each([
    ["Codex executable confirmation", [...initialAnswers.slice(0, 6), "no"]],
    ["Claude executable confirmation", [...initialAnswers.slice(0, 10), "no"]],
    ["final write confirmation", [...initialAnswers, "no"]],
  ])(
    "marks a decline at %s as cancellation with no write",
    async (_label, answers) => {
      const { io } = setupIo(answers);
      const { dependencies, savedConfigs, environmentLines } =
        setupDependencies();

      await expect(collectSetupDraft(io, dependencies)).rejects.toMatchObject({
        code: "SETUP_CANCELLED",
      });
      expect(savedConfigs).toEqual([]);
      expect(environmentLines).toEqual([]);
    },
  );

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
    const { io, rendered, events } = setupIo([...initialAnswers, "yes"]);
    const { dependencies, savedConfigs, environmentLines } =
      setupDependencies();

    const draft = await collectSetupDraft(io, dependencies);
    await writeSetupDraft(draft, paths, "C:/setup-workspace", dependencies);

    const review = rendered.find((line) =>
      line.startsWith("Configuration review:\n"),
    );
    expect(review).toBeDefined();
    const reviewPrefix = "Configuration review:\n";
    const redactedSuffix = "\nDiscord token: [REDACTED]\n";
    expect(review?.endsWith(redactedSuffix)).toBe(true);
    const serializedConfig = review?.slice(
      reviewPrefix.length,
      -redactedSuffix.length,
    );
    expect(JSON.parse(serializedConfig ?? "null")).toEqual(draft.config);
    const reviewIndex = events.findIndex(
      (event) => event.kind === "write" && event.text === review,
    );
    const confirmationIndex = events.findIndex(
      (event) =>
        event.kind === "ask" &&
        event.text === "Create local configuration and .env now? (yes/no): ",
    );
    expect(reviewIndex).toBeGreaterThanOrEqual(0);
    expect(reviewIndex).toBeLessThan(confirmationIndex);

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
