import { randomUUID } from "node:crypto";
import {
  AgentBoundaryError,
  AgentRegistry,
  normalizeModelExecution,
  resolveModelSelection,
  validateModelCapabilities,
} from "../agents/agent-registry.js";
import type {
  AgentAdapter,
  AgentId,
  AgentRequest,
  AgentResult,
  AgentSelection,
  ResolvedModelSelection,
} from "../agents/types.js";
import type { AgentConfig } from "../config/schema.js";
import type {
  RegisteredProject,
  ProjectService,
} from "../projects/project-service.js";
import type { ProjectRepository } from "../storage/project-repository.js";
import type {
  AgentRunRecord,
  SessionRecord,
  SessionRepository,
} from "../storage/session-repository.js";
import { ActiveRuns } from "./active-runs.js";
import { ConcurrencyGate } from "./concurrency-gate.js";
import type { AskInput, AskReport } from "./types.js";

export type { AskInput, AskReport } from "./types.js";

type AskConfig = Readonly<{
  concurrency: number;
  agents: Readonly<Record<"codex" | "claude", AgentConfig>>;
}>;

export interface AskServiceDependencies {
  config: AskConfig;
  registry: AgentRegistry;
  projects: ProjectService;
  projectRepository: ProjectRepository;
  sessions: SessionRepository;
  activeRuns: ActiveRuns;
  gate?: ConcurrencyGate;
}

interface PreparedAgent {
  adapter: AgentAdapter;
  selection: ResolvedModelSelection | undefined;
  config: AgentConfig;
}

export class AskServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AskServiceError";
  }
}

function terminal(status: SessionRecord["status"]): boolean {
  return ["completed", "partial", "failed", "cancelled"].includes(status);
}

function resultOrder(left: AgentResult, right: AgentResult): number {
  return left.agentId === right.agentId
    ? 0
    : left.agentId === "codex"
      ? -1
      : right.agentId === "codex"
        ? 1
        : left.agentId < right.agentId
          ? -1
          : 1;
}

function storedResult(run: AgentRunRecord): AgentResult {
  const response = run.response;
  const content =
    response !== undefined &&
    response !== null &&
    typeof response === "object" &&
    "content" in response &&
    typeof response.content === "string"
      ? response.content
      : undefined;
  return {
    agentId: run.agentId,
    status: run.status === "running" ? "failed" : run.status,
    ...(content === undefined ? {} : { response: content }),
    ...(run.exitCode === undefined ? {} : { exitCode: run.exitCode }),
    durationMs: run.durationMs,
    modelExecution: run.modelExecution,
    diagnostics: Array.isArray(run.diagnostics)
      ? run.diagnostics.filter(
          (item): item is string => typeof item === "string",
        )
      : [],
  };
}

function storageExecution(
  execution: AgentResult["modelExecution"],
): AgentRunRecord["modelExecution"] {
  return {
    ...(execution.requestedClass === undefined
      ? {}
      : { requestedClass: execution.requestedClass }),
    ...(execution.requestedCliModelId === undefined
      ? {}
      : { requestedCliModelId: execution.requestedCliModelId }),
    ...(execution.requestedEffort === undefined
      ? {}
      : { requestedEffort: execution.requestedEffort }),
    observedModelIds: execution.observedModelIds,
    verification: execution.verification,
  };
}

function failureResult(
  agentId: AgentId,
  selection: ResolvedModelSelection | undefined,
  error: unknown,
  cancelled: boolean,
): AgentResult {
  const message =
    error instanceof Error ? error.message.slice(0, 1_000) : "Agent failed";
  return {
    agentId,
    status: cancelled ? "cancelled" : "failed",
    durationMs: 0,
    modelExecution: normalizeModelExecution(selection, [], "unverified"),
    diagnostics: [message],
  };
}

function resultStatus(
  results: readonly AgentResult[],
  cancelled: boolean,
): AskReport["status"] {
  if (cancelled || results.some((result) => result.status === "cancelled"))
    return "cancelled";
  const completed = results.filter((result) => result.status === "completed");
  if (completed.length === results.length) return "completed";
  return completed.length === 0 ? "failed" : "partial";
}

export class AskService {
  private readonly gate: ConcurrencyGate;

  constructor(private readonly dependencies: AskServiceDependencies) {
    this.gate =
      dependencies.gate ?? new ConcurrencyGate(dependencies.config.concurrency);
  }

  async ask(input: AskInput): Promise<AskReport> {
    const duplicate = this.dependencies.sessions.findByInteractionId(
      input.interactionId,
    );
    if (duplicate !== undefined) {
      if (terminal(duplicate.status)) return this.persistedReport(duplicate);
      throw new AskServiceError(
        "INTERACTION_IN_PROGRESS",
        "Interaction is already in progress",
      );
    }

    const project = this.resolveProject(input);
    const prepared = await this.prepare(input.selection, input);
    const session = this.dependencies.sessions.create({
      interactionId: input.interactionId,
      command: "ask",
      projectId: project.id,
      guildId: input.scope.guildId,
      channelId: input.scope.channelId,
      userId: input.scope.userId,
      question: input.question,
    });
    if (session.status !== "queued") {
      if (terminal(session.status)) return this.persistedReport(session);
      throw new AskServiceError(
        "INTERACTION_IN_PROGRESS",
        "Interaction is already in progress",
      );
    }

    const controller = new AbortController();
    this.dependencies.activeRuns.register(
      session.id,
      input.scope.userId,
      controller,
    );
    try {
      this.dependencies.sessions.addMessage({
        sessionId: session.id,
        role: "user",
        content: input.question,
      });
      this.dependencies.sessions.markRunning(session.id);
      const settled = await Promise.allSettled(
        prepared.map((agent) =>
          this.runAgent(
            session.id,
            project,
            input.question,
            agent,
            controller.signal,
          ),
        ),
      );
      const results = settled
        .map((entry, index) => {
          if (entry.status === "fulfilled") return entry.value;
          const agent = prepared[index];
          if (agent === undefined) throw entry.reason;
          return failureResult(
            agent.adapter.id,
            agent.selection,
            entry.reason,
            controller.signal.aborted,
          );
        })
        .sort(resultOrder);
      const status = resultStatus(results, controller.signal.aborted);
      this.markTerminal(session.id, status);
      return { sessionId: session.id, status, project, results };
    } catch (error) {
      if (!terminal(this.dependencies.sessions.get(session.id).status)) {
        this.dependencies.sessions.markFailed(session.id);
      }
      throw error;
    } finally {
      this.dependencies.activeRuns.unregister(session.id);
    }
  }

  private resolveProject(input: AskInput): RegisteredProject {
    if (input.projectId !== undefined)
      return this.dependencies.projects.get(input.projectId);
    const active = this.dependencies.projectRepository.getActive(input.scope);
    if (active === undefined)
      throw new AskServiceError(
        "PROJECT_NOT_SELECTED",
        "No active project is selected",
      );
    return this.dependencies.projects.get(active.id);
  }

  private async prepare(
    selection: AgentSelection,
    input: AskInput,
  ): Promise<readonly PreparedAgent[]> {
    const adapters = this.dependencies.registry.select(selection);
    const requested = new Map<AgentId, string | undefined>([
      ["codex", input.codexModel],
      ["claude", input.claudeModel],
    ]);
    const prepared = adapters.map((adapter) => {
      const config =
        this.dependencies.config.agents[adapter.id as "codex" | "claude"];
      return {
        adapter,
        config,
        selection: resolveModelSelection(
          config.models,
          requested.get(adapter.id),
        ),
      };
    });
    await Promise.all(
      prepared.map(async (agent) => {
        const capabilities = await agent.adapter.probe();
        if (!capabilities.available)
          throw new AskServiceError(
            "AGENT_UNAVAILABLE",
            `Agent unavailable: ${agent.adapter.id}`,
          );
        validateModelCapabilities(capabilities, agent.selection);
      }),
    );
    return Object.freeze(prepared);
  }

  private async runAgent(
    sessionId: string,
    project: RegisteredProject,
    question: string,
    agent: PreparedAgent,
    signal: AbortSignal,
  ): Promise<AgentResult> {
    const runId = randomUUID();
    const requested: AgentRequest = {
      runId,
      projectRoot: project.root,
      mode: "observe",
      prompt: question,
      timeoutMs: agent.config.timeoutMs,
      maxOutputBytes: agent.config.maxOutputBytes,
      ...(agent.selection === undefined
        ? {}
        : { modelSelection: agent.selection }),
    };
    this.dependencies.sessions.createAgentRun({
      id: runId,
      sessionId,
      agentId: agent.adapter.id,
      modelExecution: storageExecution(
        normalizeModelExecution(agent.selection, [], "unverified"),
      ),
      phase: "ask",
      purpose: "answer",
      request: { phase: "ask", prompt: question },
      diagnostics: [],
    });
    try {
      const result = await this.gate.run(signal, () =>
        agent.adapter.run(requested, signal),
      );
      const persistedStatus =
        result.status === "completed"
          ? "completed"
          : result.status === "cancelled"
            ? "cancelled"
            : "failed";
      this.dependencies.sessions.finishAgentRun({
        id: runId,
        status: persistedStatus,
        modelExecution: storageExecution(result.modelExecution),
        ...(result.status === "completed"
          ? { response: { phase: "ask", content: result.response ?? "" } }
          : {}),
        ...(result.exitCode === undefined ? {} : { exitCode: result.exitCode }),
        durationMs: result.durationMs,
        diagnostics: result.diagnostics,
      });
      if (result.status !== "completed") {
        this.dependencies.sessions.addError({
          sessionId,
          code:
            result.status === "cancelled" ? "AGENT_CANCELLED" : "AGENT_FAILED",
          message: result.diagnostics[0] ?? "Agent failed",
          context: { agentId: agent.adapter.id, runId },
        });
      }
      return result;
    } catch (error) {
      const result = failureResult(
        agent.adapter.id,
        agent.selection,
        error,
        signal.aborted,
      );
      this.dependencies.sessions.finishAgentRun({
        id: runId,
        status: result.status === "cancelled" ? "cancelled" : "failed",
        modelExecution: storageExecution(result.modelExecution),
        diagnostics: result.diagnostics,
      });
      this.dependencies.sessions.addError({
        sessionId,
        code: signal.aborted ? "AGENT_CANCELLED" : "AGENT_FAILED",
        message: result.diagnostics[0] ?? "Agent failed",
        context: { agentId: agent.adapter.id, runId },
      });
      return result;
    }
  }

  private markTerminal(sessionId: string, status: AskReport["status"]): void {
    if (status === "completed")
      this.dependencies.sessions.markCompleted(sessionId);
    else if (status === "partial")
      this.dependencies.sessions.markPartial(sessionId);
    else if (status === "cancelled")
      this.dependencies.sessions.markCancelled(sessionId);
    else this.dependencies.sessions.markFailed(sessionId);
  }

  private persistedReport(session: SessionRecord): AskReport {
    if (!terminal(session.status))
      throw new AskServiceError(
        "INTERACTION_IN_PROGRESS",
        "Interaction is already in progress",
      );
    return {
      sessionId: session.id,
      status: session.status as AskReport["status"],
      project: this.dependencies.projects.get(session.projectId),
      results: [...this.dependencies.sessions.agentRuns(session.id)]
        .map(storedResult)
        .sort(resultOrder),
    };
  }
}

export { AgentBoundaryError };
