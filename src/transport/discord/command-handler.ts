import type { AgentSelection } from "../../agents/types.js";
import type { DebateConfig } from "../../config/schema.js";
import { DebateService } from "../../debate/debate-service.js";
import { AskService } from "../../orchestrator/ask-service.js";
import { ActiveRuns } from "../../orchestrator/active-runs.js";
import type { RegisteredProject } from "../../projects/project-service.js";
import type { ProjectScope } from "../../storage/project-repository.js";
import type { AgentRunRecord } from "../../storage/session-repository.js";
import { authorize, DiscordAuthorizationError } from "./authorization.js";
import { formatAskReport, formatDebateReport, formatModels, type DiscordPayload } from "./response-format.js";

export { createSlashCommands } from "./commands.js";
export type { DiscordPayload } from "./response-format.js";

export interface InteractionPort {
  interactionId: string;
  commandName: string;
  guildId?: string;
  channelId: string;
  userId: string;
  getString(name: string, required?: boolean): string | undefined;
  deferReply(): Promise<void>;
  reply(content: DiscordPayload): Promise<void>;
  editReply(content: DiscordPayload): Promise<void>;
}

interface ProjectPort {
  list(): readonly RegisteredProject[];
  get(projectId: string): RegisteredProject;
}

interface ProjectRepositoryPort {
  setActive(scope: ProjectScope, projectId: string): void;
  getActive(scope: ProjectScope): RegisteredProject | undefined;
}

interface HandlerConfig {
  guildIds: readonly string[];
  allowedUserIds: readonly string[];
  models: Readonly<Record<"codex" | "claude", { defaultModel?: string | undefined; selections: readonly { class: string; cliModelId: string; acceptedObservedModels: { exactIds: readonly string[]; literalPrefixes: readonly string[] } }[] }>>;
  debate?: DebateConfig;
}

export interface CommandHandlerDependencies {
  config: HandlerConfig;
  projects: ProjectPort;
  projectRepository: ProjectRepositoryPort;
  askService: Pick<AskService, "ask">;
  debateService: Pick<DebateService, "debate">;
  activeRuns: ActiveRuns;
  sessions?: { agentRuns(sessionId: string): readonly AgentRunRecord[] };
}

function message(content: string): DiscordPayload {
  return { content };
}

function requestedModel(
  value: string | undefined,
  configured: readonly { class: string }[],
): string | undefined {
  if (value === undefined) return undefined;
  if (!configured.some((selection) => selection.class === value))
    throw new Error("That model class is not configured for this provider.");
  return value;
}

function selection(value: string | undefined): AgentSelection {
  if (value === "codex" || value === "claude" || value === "both") return value;
  throw new Error("Choose Codex, Claude, or Both.");
}

function required(port: InteractionPort, name: string): string {
  const value = port.getString(name, true)?.trim();
  if (value === undefined || value.length === 0) throw new Error(`A ${name} is required.`);
  return value;
}

function knownError(error: unknown): string {
  if (error instanceof DiscordAuthorizationError) return error.message;
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  if (code === "PROJECT_NOT_SELECTED") return "No active project is selected. Use /switch first.";
  if (code === "PROJECT_REQUIRED") return "Select a project for this debate.";
  if (code === "PROJECT_NOT_FOUND") return "That project is not registered.";
  if (code === "INTERACTION_IN_PROGRESS") return "This interaction is already in progress.";
  if (code === "AGENT_MODEL_UNSUPPORTED" || code === "AGENT_EFFORT_UNSUPPORTED") return "That configured model selection cannot be used by this provider.";
  if (code === "AGENT_UNAVAILABLE") return "The selected agent is currently unavailable.";
  return error instanceof Error ? error.message : "The command could not be completed.";
}

export function createCommandHandler(dependencies: CommandHandlerDependencies) {
  const scope = (port: InteractionPort) => authorize(port, dependencies.config);
  const defaults: DebateConfig = { maxRounds: 3, maxBoardClaims: 40, maxBoardBytes: 65_536 };
  return async (port: InteractionPort): Promise<void> => {
    let authorized: ProjectScope;
    try {
      authorized = scope(port);
    } catch (error) {
      await port.reply(message(knownError(error)));
      return;
    }
    const deferred = port.commandName === "ask" || port.commandName === "debate";
    if (deferred) await port.deferReply();
    try {
      if (port.commandName === "projects") {
        const projects = dependencies.projects.list();
        await port.reply(message(projects.length === 0 ? "No projects are registered." : projects.map((project) => `${project.id}: ${project.name}`).join("\n")));
        return;
      }
      if (port.commandName === "models") {
        await port.reply(formatModels(dependencies.config.models));
        return;
      }
      if (port.commandName === "switch") {
        const project = dependencies.projects.get(required(port, "project"));
        dependencies.projectRepository.setActive(authorized, project.id);
        await port.reply(message(`Active project switched to ${project.id}.`));
        return;
      }
      if (port.commandName === "status") {
        const runs = dependencies.activeRuns.list().filter((run) => run.ownerUserId === authorized.userId);
        await port.reply(message(runs.length === 0 ? "You have no active runs." : `Your active runs: ${runs.map((run) => run.runId).join(", ")}`));
        return;
      }
      if (port.commandName === "stop") {
        const run = port.getString("run") ?? dependencies.activeRuns.list().find((item) => item.ownerUserId === authorized.userId)?.runId;
        await port.reply(message(run !== undefined && dependencies.activeRuns.cancel(run, authorized.userId) ? `Stopping run ${run}.` : "No matching active run is available to stop."));
        return;
      }
      if (port.commandName === "ask") {
        if (dependencies.projectRepository.getActive(authorized) === undefined)
          throw Object.assign(new Error("No active project is selected. Use /switch first."), {
            code: "PROJECT_NOT_SELECTED",
          });
        const codexModel = requestedModel(port.getString("codex_model"), dependencies.config.models.codex.selections);
        const claudeModel = requestedModel(port.getString("claude_model"), dependencies.config.models.claude.selections);
        const report = await dependencies.askService.ask({
          scope: authorized, interactionId: port.interactionId,
          selection: selection(required(port, "agent")), question: required(port, "question"),
          ...(codexModel === undefined ? {} : { codexModel }),
          ...(claudeModel === undefined ? {} : { claudeModel }),
        });
        await port.editReply(formatAskReport(report));
        return;
      }
      if (port.commandName === "debate") {
        const projectId = port.getString("project") ?? dependencies.projectRepository.getActive(authorized)?.id;
        const codexModel = requestedModel(port.getString("codex_model"), dependencies.config.models.codex.selections);
        const claudeModel = requestedModel(port.getString("claude_model"), dependencies.config.models.claude.selections);
        const report = await dependencies.debateService.debate({
          scope: authorized, interactionId: port.interactionId, topic: required(port, "topic"),
          ...(projectId === undefined ? {} : { projectId }),
          ...(codexModel === undefined ? {} : { codexModel }),
          ...(claudeModel === undefined ? {} : { claudeModel }),
        }, dependencies.config.debate ?? defaults);
        await port.editReply(
          formatDebateReport(
            report,
            dependencies.sessions?.agentRuns(report.sessionId) ?? [],
          ),
        );
        return;
      }
      await port.reply(message("Unsupported command."));
    } catch (error) {
      const output = message(knownError(error));
      if (deferred) await port.editReply(output); else await port.reply(output);
    }
  };
}
