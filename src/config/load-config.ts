import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { AppConfigSchema, type AppConfig } from "./schema.js";

export async function loadConfig(
  configFile: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AppConfig> {
  const parsedJson: unknown = JSON.parse(await readFile(configFile, "utf8"));
  const config = AppConfigSchema.parse(parsedJson);
  const token = env[config.discord.tokenEnv];
  if (token === undefined || token.length === 0) {
    throw new Error(
      `${config.discord.tokenEnv} is required and must be non-empty`,
    );
  }
  return config;
}

async function applyMode(path: string, mode: number): Promise<void> {
  if (process.platform !== "win32") {
    await chmod(path, mode);
  }
}

export async function saveConfig(
  configFile: string,
  config: AppConfig,
): Promise<void> {
  const validated = AppConfigSchema.parse(config);
  const directory = dirname(configFile);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await applyMode(directory, 0o700);

  const temporaryFile = join(directory, `.${randomUUID()}.tmp`);
  try {
    await writeFile(
      temporaryFile,
      `${JSON.stringify(validated, undefined, 2)}\n`,
      {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      },
    );
    await applyMode(temporaryFile, 0o600);
    await rename(temporaryFile, configFile);
    await applyMode(configFile, 0o600);
  } catch (error) {
    await rm(temporaryFile, { force: true });
    throw error;
  }
}
