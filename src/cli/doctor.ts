import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { promisify } from "node:util";
import type { AgentCapabilities } from "../agents/types.js";
import { validateModelCapabilities } from "../agents/agent-registry.js";
import { AppConfigSchema, type AppConfig } from "../config/schema.js";
import { CodexAdapter } from "../agents/codex-adapter.js";
import { ClaudeAdapter } from "../agents/claude-adapter.js";
import { openDatabase } from "../storage/database.js";
import { migrateDatabase } from "../storage/migrations.js";
import { ProjectService } from "../projects/project-service.js";
import { resolveAgentCommand } from "./resolve-agent-command.js";

export interface DoctorOptions {
  config: AppConfig;
  databaseFile: string;
  configFile?: string;
  write?: (line: string) => void;
}

const executeFile = promisify(execFile);

export function capabilitySatisfiesConfiguredSelections(
  capability: AgentCapabilities,
  selections: AppConfig["agents"]["codex"]["models"]["selections"],
): boolean {
  if (
    !capability.available ||
    !capability.nonInteractive ||
    !capability.structuredOutput ||
    !capability.readOnlyEnforcement ||
    !capability.modelOption.supported ||
    !capability.observedModelReporting.supported
  )
    return false;
  try {
    for (const selection of selections) {
      validateModelCapabilities(capability, {
        class: selection.class,
        cliModelId: selection.cliModelId,
        ...(selection.requestedEffort === undefined
          ? {}
          : { requestedEffort: selection.requestedEffort }),
      });
    }
    return true;
  } catch {
    return false;
  }
}

function redactPath(value: string): string {
  const home = homedir();
  return value.startsWith(home) ? `~${value.slice(home.length)}` : value;
}

function reportCapability(
  provider: "codex" | "claude",
  capability: AgentCapabilities,
  write: (line: string) => void,
): void {
  write(
    `${provider}: ${capability.available ? "available" : "unavailable"}; ${capability.diagnostics.join(" ")}`,
  );
  write(
    `${provider}: model=${String(capability.modelOption.supported)} effort=${String(capability.effortOption.supported)} observed-model=${String(capability.observedModelReporting.supported)}.`,
  );
}

export async function runDoctor(options: DoctorOptions): Promise<boolean> {
  const write = options.write ?? console.log;
  const config = AppConfigSchema.parse(options.config);
  let healthy = true;
  write(`OS: ${process.platform}`);
  write(`Node: ${process.version}`);
  write(
    `Config: ${options.configFile === undefined ? "configured path unavailable" : redactPath(options.configFile)}`,
  );
  try {
    const { stdout } = await executeFile("git", ["--version"]);
    write(`Git: ${stdout.trim()}`);
  } catch (error) {
    healthy = false;
    write(
      `Git: unavailable (${error instanceof Error ? error.message : "unknown error"})`,
    );
  }
  try {
    const database = openDatabase(options.databaseFile);
    migrateDatabase(database);
    database.prepare("SELECT 1").get();
    database.close();
    write("Database: writable");
  } catch (error) {
    healthy = false;
    write(
      `Database: unavailable (${error instanceof Error ? error.message : "unknown error"})`,
    );
  }
  for (const project of config.projects) {
    try {
      await ProjectService.create([project]);
      write(`Project ${project.id}: valid`);
    } catch (error) {
      healthy = false;
      write(
        `Project ${project.id}: invalid (${error instanceof Error ? error.message : "unknown error"})`,
      );
    }
  }
  for (const provider of ["codex", "claude"] as const) {
    const resolution = await resolveAgentCommand({
      provider,
      configuredCommand: config.agents[provider].command,
    });
    write(
      `${provider}: executable=${resolution.source}; ${resolution.diagnostic}`,
    );
    if (resolution.command === undefined) {
      healthy = false;
      continue;
    }
    const adapter =
      provider === "codex"
        ? new CodexAdapter({
            ...config.agents.codex,
            command: resolution.command,
          })
        : new ClaudeAdapter({
            ...config.agents.claude,
            command: resolution.command,
          });
    const capability = await adapter.probe();
    reportCapability(provider, capability, write);
    if (
      !capabilitySatisfiesConfiguredSelections(
        capability,
        config.agents[provider].models.selections,
      )
    ) {
      healthy = false;
      write(
        `${provider}: mandatory safety, model, effort, or observation contract is unavailable.`,
      );
    }
  }
  write(
    "Managed provider settings can outrank inline controls; fallback may incur cost before post-execution model-class rejection.",
  );
  write(
    "Account entitlement and effective managed settings are runtime-only. Provider-default executions are unverified.",
  );
  return healthy;
}
