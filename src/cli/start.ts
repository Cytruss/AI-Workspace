import { config as loadEnvironment } from "dotenv";
import { AgentRegistry } from "../agents/agent-registry.js";
import { ClaudeAdapter } from "../agents/claude-adapter.js";
import { CodexAdapter } from "../agents/codex-adapter.js";
import { getAppPaths } from "../config/app-paths.js";
import { loadConfig } from "../config/load-config.js";
import { DebateService } from "../debate/debate-service.js";
import { ActiveRuns } from "../orchestrator/active-runs.js";
import { AskService } from "../orchestrator/ask-service.js";
import { ProjectService } from "../projects/project-service.js";
import { openDatabase } from "../storage/database.js";
import { DeliberationRepository } from "../storage/deliberation-repository.js";
import { migrateDatabase } from "../storage/migrations.js";
import { ProjectRepository } from "../storage/project-repository.js";
import { SessionRepository } from "../storage/session-repository.js";
import { DiscordRuntime } from "../transport/discord/discord-runtime.js";
import { resolveAgentCommand } from "./resolve-agent-command.js";

async function waitForRuns(activeRuns: ActiveRuns): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (activeRuns.list().length > 0 && Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
}

export async function startApplication(): Promise<void> {
  loadEnvironment();
  const paths = getAppPaths();
  const config = await loadConfig(paths.configFile);
  const resolved = await Promise.all(
    (["codex", "claude"] as const).map(async (provider) => {
      const result = await resolveAgentCommand({
        provider,
        configuredCommand: config.agents[provider].command,
      });
      if (result.command === undefined)
        throw new Error(`${provider}: ${result.diagnostic}`);
      return [provider, result.command] as const;
    }),
  );
  const commands = Object.fromEntries(resolved) as Record<
    "codex" | "claude",
    string
  >;
  const database = openDatabase(paths.databaseFile);
  migrateDatabase(database);
  const projects = await ProjectService.create(config.projects);
  const projectRepository = new ProjectRepository(database);
  for (const project of projects.list()) projectRepository.upsert(project);
  const sessions = new SessionRepository(database);
  const activeRuns = new ActiveRuns();
  const registry = new AgentRegistry([
    new CodexAdapter({ ...config.agents.codex, command: commands.codex }),
    new ClaudeAdapter({ ...config.agents.claude, command: commands.claude }),
  ]);
  const askService = new AskService({
    config,
    registry,
    projects,
    projectRepository,
    sessions,
    activeRuns,
  });
  const debateService = new DebateService({
    config,
    registry,
    projects,
    sessions,
    deliberation: new DeliberationRepository(database),
    activeRuns,
  });
  const runtime = new DiscordRuntime({
    config,
    projects,
    projectRepository,
    askService,
    debateService,
    activeRuns,
    sessions,
  });
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    activeRuns.cancelAll();
    await waitForRuns(activeRuns);
    runtime.stop();
    database.close();
  };
  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());
  try {
    await runtime.start();
  } catch (error) {
    await stop();
    throw error;
  }
}
