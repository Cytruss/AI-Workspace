import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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
import { createReviewBrowserBinding } from "../site-review/browser/types.js";
import { createSiteReviewRunner } from "../site-review/site-review-runner.js";
import { SiteReviewService } from "../site-review/site-review-service.js";
import { UrlPolicy } from "../site-review/url-policy.js";
import { openDatabase } from "../storage/database.js";
import { DeliberationRepository } from "../storage/deliberation-repository.js";
import { migrateDatabase } from "../storage/migrations.js";
import { ProjectRepository } from "../storage/project-repository.js";
import { SessionRepository } from "../storage/session-repository.js";
import { SiteReviewRepository } from "../storage/site-review-repository.js";
import { DiscordRuntime } from "../transport/discord/discord-runtime.js";
import { resolveAgentCommand } from "./resolve-agent-command.js";

async function waitForRuns(
  activeRuns: Pick<ActiveRuns, "list">,
): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (activeRuns.list().length > 0 && Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
}

interface ShutdownDependencies {
  runtime: Pick<DiscordRuntime, "stopAcceptingInteractions" | "stop">;
  activeRuns: Pick<ActiveRuns, "cancelAll" | "list">;
  closeDatabase: () => void;
  exit?: (code: number) => void;
}

export function toNodeImportSpecifier(path: string): string {
  return pathToFileURL(path).href;
}

export function createShutdownHandler(dependencies: ShutdownDependencies) {
  let stopping = false;
  return async (exitProcess = false): Promise<void> => {
    if (stopping) return;
    stopping = true;
    dependencies.runtime.stopAcceptingInteractions();
    dependencies.activeRuns.cancelAll();
    await waitForRuns(dependencies.activeRuns);
    dependencies.runtime.stop();
    dependencies.closeDatabase();
    if (exitProcess) (dependencies.exit ?? process.exit)(0);
  };
}

export async function startApplication(): Promise<void> {
  loadEnvironment();
  const paths = getAppPaths();
  await mkdir(paths.dataDir, { recursive: true });
  await mkdir(paths.logDir, { recursive: true });
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
  const codex = new CodexAdapter({
    ...config.agents.codex,
    command: commands.codex,
  });
  const claude = new ClaudeAdapter({
    ...config.agents.claude,
    command: commands.claude,
  });
  const registry = new AgentRegistry([codex, claude]);
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
  const gatewaySource = fileURLToPath(
    new URL("../site-review/browser/gateway-server.ts", import.meta.url),
  );
  const tsxLoader = toNodeImportSpecifier(
    createRequire(import.meta.url).resolve("tsx/esm"),
  );
  const siteReviews = new SiteReviewRepository(database);
  const siteReviewService = new SiteReviewService({
    reviews: siteReviews,
    policy: new UrlPolicy(),
    activeRuns,
    runAgent: createSiteReviewRunner({
      codex,
      claude,
      workingDirectory: paths.dataDir,
      createBrowserBinding: ({ reviewId, agentId, url }) =>
        createReviewBrowserBinding({
          configHome: paths.dataDir,
          mcpConfigPath: join(paths.dataDir, `${reviewId}-${agentId}.mcp.json`),
          gatewayCommand: process.execPath,
          gatewayArgs: [
            "--import",
            tsxLoader,
            gatewaySource,
            `--url=${url}`,
            `--log-file=${join(paths.logDir, `site-review-${reviewId}-${agentId}.log`)}`,
          ],
        }),
    }),
  });
  const runtime = new DiscordRuntime({
    config,
    projects,
    projectRepository,
    askService,
    debateService,
    siteReviewService,
    siteReviews,
    activeRuns,
    sessions,
  });
  const stop = createShutdownHandler({
    runtime,
    activeRuns,
    closeDatabase: () => database.close(),
  });
  process.once("SIGINT", () => void stop(true));
  process.once("SIGTERM", () => void stop(true));
  try {
    await runtime.start();
  } catch (error) {
    await stop();
    throw error;
  }
}
