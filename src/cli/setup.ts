import { chmod, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { ProjectService } from "../projects/project-service.js";
import { saveConfig } from "../config/load-config.js";
import {
  AppConfigSchema,
  type AppConfig,
  type ModelSelection,
} from "../config/schema.js";
import type { AppPaths } from "../config/app-paths.js";
import { resolveAgentCommand } from "./resolve-agent-command.js";

export interface SetupDraft {
  config: AppConfig;
  token: string;
}

export interface SetupIo {
  ask(question: string): Promise<string>;
  readSecret(prompt: string): Promise<string>;
  write(line: string): void;
}

export class SetupCancelledError extends Error {
  readonly code = "SETUP_CANCELLED";

  constructor(message: string) {
    super(message);
    this.name = "SetupCancelledError";
  }
}

export function isSetupCancellation(error: unknown): boolean {
  const legacyMessages = new Set([
    "Setup cancelled",
    "Setup cancelled before writing local files",
    "Setup requires explicit confirmation for executable paths",
  ]);
  return (
    error instanceof SetupCancelledError ||
    (error instanceof Error &&
      (("code" in error && error.code === "SETUP_CANCELLED") ||
        legacyMessages.has(error.message)))
  );
}

export interface SetupDependencies {
  resolveAgentCommand: typeof resolveAgentCommand;
  saveConfig: typeof saveConfig;
  writeEnvironmentFile(envFile: string, line: string): Promise<void>;
}

async function writeEnvironmentFile(
  envFile: string,
  line: string,
): Promise<void> {
  await writeFile(envFile, line, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  if (process.platform !== "win32") await chmod(envFile, 0o600);
}

const productionDependencies: SetupDependencies = {
  resolveAgentCommand,
  saveConfig,
  writeEnvironmentFile,
};

function splitRequired(value: string, label: string): string[] {
  const values = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (values.length === 0) throw new Error(`${label} must not be empty`);
  return values;
}

function parseProject(value: string) {
  const [id, name, root] = value.split("|").map((item) => item.trim());
  if (!id || !name || !root)
    throw new Error("Projects must use id|name|absolute-root format");
  return { id, name, root };
}

function parseModel(value: string): ModelSelection {
  const [modelClass, cliModelId, effort, exactIds = "", prefixes = ""] = value
    .split("|")
    .map((item) => item.trim());
  if (!modelClass || !cliModelId)
    throw new Error(
      "Models must use class|cli-id|effort?|exact-ids|prefixes format",
    );
  return {
    class: modelClass,
    cliModelId,
    ...(effort ? { requestedEffort: effort } : {}),
    acceptedObservedModels: {
      exactIds: exactIds ? splitRequired(exactIds, "Exact observed IDs") : [],
      literalPrefixes: prefixes
        ? splitRequired(prefixes, "Observed prefixes")
        : [],
    },
  };
}

function renderSetupReview(config: AppConfig): string {
  return `Configuration review:\n${JSON.stringify(config, undefined, 2)}\nDiscord token: [REDACTED]\n`;
}

async function collectMany(io: SetupIo, prompt: string): Promise<string[]> {
  const values: string[] = [];
  for (;;) {
    const value = (await io.ask(prompt)).trim();
    if (!value) return values;
    values.push(value);
  }
}

export async function readSecret(
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
  prompt: string,
): Promise<string> {
  output.write(prompt);
  const terminalInput = input as NodeJS.ReadStream;
  const restoreRaw = terminalInput.isTTY && !terminalInput.isRaw;
  if (restoreRaw) terminalInput.setRawMode(true);
  return new Promise<string>((resolve, reject) => {
    let value = "";
    const finish = () => {
      input.off("data", receive);
      input.off("error", fail);
      if (restoreRaw) terminalInput.setRawMode(false);
      output.write("\n");
      resolve(value);
    };
    const fail = (error: Error) => {
      input.off("data", receive);
      if (restoreRaw) terminalInput.setRawMode(false);
      reject(error);
    };
    const receive = (chunk: string | Buffer) => {
      for (const character of chunk.toString()) {
        if (character === "\r" || character === "\n") {
          finish();
          return;
        }
        if (character === "\u0003") {
          fail(new SetupCancelledError("Setup cancelled"));
          return;
        }
        if (character === "\b" || character === "\u007f")
          value = value.slice(0, -1);
        else value += character;
      }
    };
    input.on("data", receive);
    input.once("error", fail);
    terminalInput.resume();
  });
}

export async function collectSetupDraft(
  io: SetupIo,
  dependencies: SetupDependencies = productionDependencies,
): Promise<SetupDraft> {
  const applicationId = (await io.ask("Discord application ID: ")).trim();
  const guildIds = splitRequired(
    await io.ask("Discord guild IDs (comma-separated): "),
    "Guild IDs",
  );
  const allowedUserIds = splitRequired(
    await io.ask("Authorized user IDs (comma-separated): "),
    "Authorized user IDs",
  );
  const projectEntries = await collectMany(
    io,
    "Project id|name|absolute-root (blank to finish): ",
  );
  const projects = projectEntries.map(parseProject);
  await ProjectService.create(projects);
  const agentModels = {} as Record<
    "codex" | "claude",
    { selections: ModelSelection[]; defaultModel?: string }
  >;
  const commands = {} as Record<"codex" | "claude", string>;
  for (const provider of ["codex", "claude"] as const) {
    io.write(
      `${provider} optional examples: ${provider === "codex" ? "sol, terra, luna" : "opus, fable, sonnet, haiku"}. These are not entitlement claims.\n`,
    );
    const explicit = (
      await io.ask(`${provider} native executable path (optional): `)
    ).trim();
    const resolution = await dependencies.resolveAgentCommand({
      provider,
      configuredCommand: explicit || provider,
    });
    if (resolution.command === undefined)
      throw new Error(resolution.diagnostic);
    io.write(`${provider}: ${resolution.source} native executable verified.\n`);
    if (
      (
        await io.ask(
          `Save this portable native executable path for ${provider}? (yes/no): `,
        )
      ).trim() !== "yes"
    )
      throw new SetupCancelledError(
        "Setup requires explicit confirmation for executable paths",
      );
    commands[provider] = resolution.command;
    const selections = (
      await collectMany(
        io,
        `${provider} model class|CLI ID|effort?|exact observed IDs|prefixes (blank to finish): `,
      )
    ).map(parseModel);
    const defaultModel = (
      await io.ask(
        `${provider} default model class (blank for provider default): `,
      )
    ).trim();
    agentModels[provider] = {
      selections,
      ...(defaultModel ? { defaultModel } : {}),
    };
  }
  const token = await io.readSecret("Discord token: ");
  const config: AppConfig = AppConfigSchema.parse({
    version: 1,
    mode: "observe",
    discord: {
      applicationId,
      guildIds,
      allowedUserIds,
      tokenEnv: "AI_WORKSPACE_DISCORD_TOKEN",
    },
    projects,
    agents: {
      codex: { command: commands.codex, models: agentModels.codex },
      claude: { command: commands.claude, models: agentModels.claude },
    },
  });
  io.write(renderSetupReview(config));
  if (
    (
      await io.ask("Create local configuration and .env now? (yes/no): ")
    ).trim() !== "yes"
  )
    throw new SetupCancelledError("Setup cancelled before writing local files");
  return { config, token };
}

export async function writeSetupDraft(
  draft: SetupDraft,
  paths: AppPaths,
  cwd: string,
  dependencies: SetupDependencies = productionDependencies,
): Promise<void> {
  await dependencies.saveConfig(paths.configFile, draft.config);
  await dependencies.writeEnvironmentFile(
    resolve(cwd, ".env"),
    `AI_WORKSPACE_DISCORD_TOKEN=${draft.token}\n`,
  );
}

export async function runSetup(paths: AppPaths): Promise<void> {
  const terminal = createInterface({ input: stdin, output: stdout });
  try {
    const io: SetupIo = {
      ask: (question) => terminal.question(question),
      readSecret: async (prompt) => {
        terminal.pause();
        const token = await readSecret(stdin, stdout, prompt);
        terminal.resume();
        return token;
      },
      write: (line) => stdout.write(line),
    };
    const draft = await collectSetupDraft(io);
    await writeSetupDraft(draft, paths, process.cwd());
    stdout.write("Local configuration saved. Run pnpm run doctor next.\n");
  } finally {
    terminal.close();
  }
}
