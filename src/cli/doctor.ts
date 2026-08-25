import { access } from "node:fs/promises";
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
  write?: (line: string) => void;
}

function reportCapability(
  provider: "codex" | "claude",
  capability: Awaited<ReturnType<CodexAdapter["probe"]>>,
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
  try {
    await access(options.databaseFile);
  } catch {
    // SQLite creates the database only after its parent directory exists.
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
  try {
    await ProjectService.create(config.projects);
    write("Projects: valid");
  } catch (error) {
    healthy = false;
    write(
      `Projects: invalid (${error instanceof Error ? error.message : "unknown error"})`,
    );
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
    healthy &&= capability.available;
  }
  write(
    "Managed provider settings can outrank inline controls; fallback may incur cost before post-execution model-class rejection.",
  );
  write(
    "Account entitlement and effective managed settings are runtime-only. Provider-default executions are unverified.",
  );
  return healthy;
}
