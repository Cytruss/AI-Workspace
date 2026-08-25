import { randomUUID } from "node:crypto";
import {
  AgentBoundaryError,
  AgentRegistry,
  normalizeModelExecution,
  resolveModelSelection,
  validateModelCapabilities,
} from "../agents/agent-registry.js";
import {
  createCrossExaminationPhaseResponseSchema,
  createFinalPhaseResponseSchema,
  InitialPhaseResponseSchema,
  type ClaimBoard,
  type StanceRecord,
} from "../agents/structured-response.js";
import type {
  AgentAdapter,
  AgentResult,
  AgentStructuredResult,
  ResolvedModelSelection,
} from "../agents/types.js";
import type { AgentConfig, DebateConfig } from "../config/schema.js";
import type {
  ProjectService,
  RegisteredProject,
} from "../projects/project-service.js";
import type { DeliberationRepository } from "../storage/deliberation-repository.js";
import type { SessionRepository } from "../storage/session-repository.js";
import { canonicalJson } from "../storage/session-repository.js";
import { ActiveRuns } from "../orchestrator/active-runs.js";
import { ConcurrencyGate } from "../orchestrator/concurrency-gate.js";
import { appendPhaseEvidence, createInitialClaimBoard } from "./claim-board.js";
import { buildDeliberationContext } from "./context-builder.js";
import type { DebateInput, DebateReport, DebateRoundSummary } from "./types.js";
import { deriveVerdicts } from "./verdicts.js";

export type { DebateInput, DebateReport } from "./types.js";

interface PreparedAgent {
  adapter: AgentAdapter;
  config: AgentConfig;
  selection: ResolvedModelSelection | undefined;
}

export interface DebateServiceDependencies {
  config: Readonly<{
    concurrency: number;
    agents: Readonly<Record<"codex" | "claude", AgentConfig>>;
  }>;
  registry: AgentRegistry;
  projects: ProjectService;
  sessions: SessionRepository;
  deliberation: DeliberationRepository;
  activeRuns: ActiveRuns;
  gate?: ConcurrencyGate;
}

export class DebateServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DebateServiceError";
  }
}

function storedPhase(
  phase: "initial" | "cross-examination" | "final",
): "initial" | "cross_examination" | "final" {
  return phase === "cross-examination" ? "cross_examination" : phase;
}

function phaseRules(): readonly string[] {
  return Object.freeze([
    "OBSERVE only. Do not change files or run hidden-session continuation.",
    "Use only the supplied compact board and canonical namespaces.",
    "VERIFIED evidence proves cited bytes, not semantic truth.",
  ]);
}

function resultStatus(error: unknown): "failed" | "cancelled" {
  return error instanceof DOMException && error.name === "AbortError"
    ? "cancelled"
    : "failed";
}

export class DebateService {
  private readonly gate: ConcurrencyGate;
  constructor(private readonly dependencies: DebateServiceDependencies) {
    this.gate =
      dependencies.gate ?? new ConcurrencyGate(dependencies.config.concurrency);
  }

  private async prepare(input: DebateInput): Promise<readonly PreparedAgent[]> {
    const requested = {
      codex: input.codexModel,
      claude: input.claudeModel,
    } as const;
    return Promise.all(
      (["codex", "claude"] as const).map(async (agentId) => {
        const adapter = this.dependencies.registry.get(agentId);
        const config = this.dependencies.config.agents[agentId];
        const selection = resolveModelSelection(
          config.models,
          requested[agentId],
        );
        const capability = await adapter.probe();
        if (!capability.available)
          throw new DebateServiceError(
            "AGENT_UNAVAILABLE",
            `Agent unavailable: ${agentId}`,
          );
        validateModelCapabilities(capability, selection);
        return { adapter, config, selection };
      }),
    );
  }

  private project(input: DebateInput): RegisteredProject {
    if (input.projectId !== undefined)
      return this.dependencies.projects.get(input.projectId);
    const projects = this.dependencies.projects.list();
    if (projects.length !== 1 || projects[0] === undefined)
      throw new DebateServiceError(
        "PROJECT_REQUIRED",
        "A debate project must be selected",
      );
    return projects[0];
  }

  private persistBoard(sessionId: string, board: ClaimBoard) {
    const record = this.dependencies.deliberation.createClaimBoard({
      sessionId,
      version: board.version,
      payload: board,
    });
    for (const claim of board.claims) {
      this.dependencies.deliberation.addClaim({
        boardId: record.id,
        canonicalId: claim.id,
        normalizedText: claim.text,
        material: claim.material,
      });
      for (const origin of claim.origins)
        this.dependencies.deliberation.addClaimOrigin({
          boardId: record.id,
          canonicalClaimId: claim.id,
          agentId: origin.agentId,
          agentRunId: origin.agentRunId,
          providerLocalId: origin.providerLocalId,
        });
    }
    for (const evidence of board.evidence) {
      this.dependencies.deliberation.addEvidenceReference({
        boardId: record.id,
        sessionId,
        canonicalId: evidence.id,
        trackedPath: evidence.trackedPath,
        ...(evidence.lineStart === undefined || evidence.lineEnd === undefined
          ? {}
          : { lineStart: evidence.lineStart, lineEnd: evidence.lineEnd }),
        ...(evidence.expectedHash === undefined
          ? {}
          : { contentHash: evidence.expectedHash }),
        resolution: evidence.status,
        ...(evidence.resolvedHash === undefined
          ? {}
          : { resolvedHash: evidence.resolvedHash }),
      });
      for (const origin of evidence.origins)
        this.dependencies.deliberation.addEvidenceOrigin({
          boardId: record.id,
          sessionId,
          canonicalEvidenceId: evidence.id,
          agentId: origin.agentId,
          agentRunId: origin.agentRunId,
          providerLocalId: origin.providerLocalId,
        });
    }
    for (const claim of board.claims)
      for (const evidenceId of claim.evidenceIds)
        this.dependencies.deliberation.linkClaimEvidence({
          boardId: record.id,
          canonicalClaimId: claim.id,
          canonicalEvidenceId: evidenceId,
        });
    return record;
  }

  private assertBoardBounds(config: DebateConfig, board: ClaimBoard): void {
    if (
      board.claims.length > config.maxBoardClaims ||
      Buffer.byteLength(canonicalJson(board), "utf8") > config.maxBoardBytes
    )
      throw new DebateServiceError(
        "DEBATE_CONTEXT_LIMIT",
        "Claim board exceeds the effective configured bounds",
      );
  }

  private persistInputSnapshot(
    config: DebateConfig,
    sessionId: string,
    board: ClaimBoard,
  ) {
    this.assertBoardBounds(config, board);
    return {
      board,
      record: this.persistBoard(sessionId, board),
    };
  }

  private boundedRequest(
    config: DebateConfig,
    phase: "cross-examination" | "final",
    topic: string,
    board: ClaimBoard,
    reviewClaimIds: readonly string[],
  ) {
    const request = this.request(phase, topic, board, reviewClaimIds);
    if (
      board.claims.length > config.maxBoardClaims ||
      Buffer.byteLength(canonicalJson(request), "utf8") > config.maxBoardBytes
    )
      throw new DebateServiceError(
        "DEBATE_CONTEXT_LIMIT",
        "Debate request exceeds the effective configured bounds",
      );
    return request;
  }

  private request(
    phase: "initial" | "cross-examination" | "final",
    topic: string,
    board?: ClaimBoard,
    reviewClaimIds: readonly string[] = [],
  ) {
    return {
      phase,
      topic,
      rules: phaseRules(),
      responseSchema: phase,
      ...(board === undefined ? {} : { board }),
      ...(phase === "initial" ? {} : { reviewClaimIds: [...reviewClaimIds] }),
    };
  }

  private async invoke(
    prepared: PreparedAgent,
    runId: string,
    project: RegisteredProject,
    request: ReturnType<DebateService["request"]>,
    schema: import("zod").z.ZodType<AgentStructuredResult>,
    signal: AbortSignal,
  ): Promise<AgentResult> {
    try {
      const result = await this.gate.run(signal, () =>
        prepared.adapter.run(
          {
            runId,
            projectRoot: project.root,
            mode: "observe",
            prompt: JSON.stringify(request),
            timeoutMs: prepared.config.timeoutMs,
            maxOutputBytes: prepared.config.maxOutputBytes,
            responseSchema: schema,
            ...(prepared.selection === undefined
              ? {}
              : { modelSelection: prepared.selection }),
          },
          signal,
        ),
      );
      if (
        result.status !== "completed" ||
        !schema.safeParse(result.structured).success
      ) {
        return {
          ...result,
          status: result.status === "completed" ? "failed" : result.status,
          diagnostics: [
            ...result.diagnostics,
            ...(result.status === "completed"
              ? ["DEBATE_RESPONSE_INVALID"]
              : []),
          ],
        };
      }
      return result;
    } catch (error: unknown) {
      return {
        agentId: prepared.adapter.id,
        status: resultStatus(error),
        durationMs: 0,
        modelExecution: normalizeModelExecution(
          prepared.selection,
          [],
          "unverified",
        ),
        diagnostics: [
          error instanceof Error ? error.message : "Provider execution failed",
        ],
      };
    }
  }

  private finishRun(
    runId: string,
    result: AgentResult,
    response?: object,
  ): void {
    this.dependencies.sessions.finishAgentRun({
      id: runId,
      status:
        result.status === "completed" && response !== undefined
          ? "completed"
          : result.status === "cancelled"
            ? "cancelled"
            : "failed",
      modelExecution: this.storageExecution(result.modelExecution),
      ...(response === undefined ? {} : { response }),
      ...(result.exitCode === undefined ? {} : { exitCode: result.exitCode }),
      durationMs: result.durationMs,
      diagnostics: result.diagnostics,
    });
  }

  private storageExecution(execution: AgentResult["modelExecution"]) {
    return {
      ...(execution.requestedClass === undefined
        ? {}
        : {
            requestedClass: execution.requestedClass,
            requestedCliModelId: execution.requestedCliModelId as string,
            ...(execution.requestedEffort === undefined
              ? {}
              : { requestedEffort: execution.requestedEffort }),
          }),
      observedModelIds: execution.observedModelIds,
      verification: execution.verification,
    };
  }

  private report(
    sessionId: string,
    projectId: string,
    status: DebateReport["status"],
    classification: DebateReport["classification"],
    rounds: readonly DebateRoundSummary[],
    board: ClaimBoard | undefined,
    stances: readonly StanceRecord[],
    analyses: DebateReport["analyses"],
  ): DebateReport {
    const verdicts = board === undefined ? [] : deriveVerdicts(board, stances);
    const by = (classificationName: string) =>
      verdicts.filter(
        (verdict) => verdict.classification === classificationName,
      );
    return Object.freeze({
      sessionId,
      projectId,
      status,
      classification,
      rounds: Object.freeze([...rounds]),
      ...(board === undefined ? {} : { board }),
      verdicts: Object.freeze(verdicts),
      consensus: Object.freeze(by("CONSENSUS")),
      disagreements: Object.freeze(by("DISAGREEMENT")),
      rejected: Object.freeze(by("REJECTED")),
      unresolved: Object.freeze(by("UNRESOLVED")),
      analyses: Object.freeze([...analyses]),
    });
  }

  persistedReport(interactionId: string): DebateReport | undefined {
    const session =
      this.dependencies.sessions.findByInteractionId(interactionId);
    if (
      session === undefined ||
      session.command !== "debate" ||
      !["completed", "partial", "failed", "cancelled"].includes(session.status)
    )
      return undefined;
    const persisted = this.dependencies.deliberation.load(session.id);
    const finalRound = [...persisted.rounds]
      .filter((round) => round.phase === "final")
      .at(-1);
    const boardRecord =
      finalRound?.outputBoardId === undefined
        ? persisted.boards.at(-1)
        : persisted.boards.find(
            (board) => board.id === finalRound.outputBoardId,
          );
    const evidenceByStance = new Map(
      persisted.stanceEvidence.reduce<readonly [string, readonly string[]][]>(
        (entries, link) => {
          const current =
            entries.find(([id]) => id === link.stanceId)?.[1] ?? [];
          return [
            ...entries.filter(([id]) => id !== link.stanceId),
            [link.stanceId, [...current, link.canonicalEvidenceId]],
          ];
        },
        [],
      ),
    );
    const finalStances = persisted.stances
      .filter((stance) => stance.roundId === finalRound?.id)
      .map(
        (stance) =>
          ({
            claimId: stance.canonicalClaimId,
            value: stance.stance,
            reasoning: stance.reasoning,
            evidenceIds: evidenceByStance.get(stance.id) ?? [],
            agentId: stance.agentId,
            agentRunId: stance.agentRunId,
            roundId: stance.roundId,
          }) as StanceRecord,
      );
    const analyses = persisted.runs
      .filter((run) => run.phase === "initial")
      .sort((left, right) =>
        left.agentId === right.agentId ? 0 : left.agentId === "codex" ? -1 : 1,
      )
      .map((run) => {
        const content =
          run.response !== null &&
          typeof run.response === "object" &&
          "content" in run.response &&
          typeof run.response.content === "string"
            ? run.response.content
            : undefined;
        return {
          agentId: run.agentId,
          runId: run.id,
          status: run.status,
          ...(content === undefined ? {} : { content }),
        } as DebateReport["analyses"][number];
      });
    const rounds: DebateRoundSummary[] = persisted.rounds.map((round) => ({
      id: round.id,
      number: round.roundNumber,
      phase: (round.phase === "cross_examination"
        ? "cross-examination"
        : round.phase) as DebateRoundSummary["phase"],
      status: round.status === "running" ? "failed" : round.status,
    }));
    const status =
      session.status === "completed" ||
      session.status === "partial" ||
      session.status === "failed" ||
      session.status === "cancelled"
        ? session.status
        : "failed";
    return this.report(
      session.id,
      session.projectId,
      status,
      boardRecord === undefined ? "DEBATE_NOT_ESTABLISHED" : "DEBATE",
      rounds,
      boardRecord?.payload as ClaimBoard | undefined,
      finalStances,
      analyses,
    );
  }

  async debate(
    input: DebateInput,
    config: DebateConfig,
  ): Promise<DebateReport> {
    const project = this.project(input);
    const prepared = await this.prepare(input); // all model classes/efforts resolve before creating a session or process
    const session = this.dependencies.sessions.create({
      interactionId: input.interactionId,
      command: "debate",
      projectId: project.id,
      guildId: input.scope.guildId,
      channelId: input.scope.channelId,
      userId: input.scope.userId,
      question: input.topic,
      debateConfig: config,
    });
    if (session.status !== "queued")
      return this.report(
        session.id,
        project.id,
        session.status === "cancelled"
          ? "cancelled"
          : session.status === "completed"
            ? "completed"
            : session.status === "failed"
              ? "failed"
              : "partial",
        "DEBATE_NOT_ESTABLISHED",
        [],
        undefined,
        [],
        [],
      );
    const controller = new AbortController();
    this.dependencies.activeRuns.register(
      session.id,
      input.scope.userId,
      controller,
    );
    const rounds: DebateRoundSummary[] = [];
    const analyses: import("./types.js").IndependentAnalysis[] = [];
    try {
      this.dependencies.sessions.markRunning(session.id);
      const initialRound = this.dependencies.deliberation.createRound({
        sessionId: session.id,
        roundNumber: 1,
        phase: "initial",
        status: "running",
      });
      const initialRequest = this.request("initial", input.topic);
      const initialRuns = prepared.map((agent) => ({
        agent,
        id: randomUUID(),
      }));
      for (const run of initialRuns)
        this.dependencies.sessions.createAgentRun({
          id: run.id,
          sessionId: session.id,
          agentId: run.agent.adapter.id,
          modelExecution: this.storageExecution(
            normalizeModelExecution(run.agent.selection, [], "unverified"),
          ),
          roundId: initialRound.id,
          phase: "initial",
          purpose: "independent initial analysis",
          request: initialRequest,
          diagnostics: {},
        });
      const initialResults = await Promise.all(
        initialRuns.map(async (run) => ({
          ...run,
          result: await this.invoke(
            run.agent,
            run.id,
            project,
            initialRequest,
            InitialPhaseResponseSchema,
            controller.signal,
          ),
        })),
      );
      for (const item of initialResults) {
        const parsed = InitialPhaseResponseSchema.safeParse(
          item.result.structured,
        );
        this.finishRun(
          item.id,
          item.result,
          parsed.success && item.result.status === "completed"
            ? parsed.data
            : undefined,
        );
        analyses.push({
          agentId: item.agent.adapter.id,
          runId: item.id,
          ...(item.result.response === undefined
            ? {}
            : { content: item.result.response }),
          status: item.result.status,
        });
      }
      const successfulInitial = initialResults.filter(
        (item) =>
          item.result.status === "completed" &&
          InitialPhaseResponseSchema.safeParse(item.result.structured).success,
      );
      if (successfulInitial.length !== 2) {
        const cancelled =
          controller.signal.aborted ||
          initialResults.some((item) => item.result.status === "cancelled");
        this.dependencies.deliberation.finishRound(
          initialRound.id,
          cancelled
            ? "cancelled"
            : successfulInitial.length === 0
              ? "failed"
              : "partial",
        );
        rounds.push({
          id: initialRound.id,
          number: 1,
          phase: "initial",
          status: cancelled
            ? "cancelled"
            : successfulInitial.length === 0
              ? "failed"
              : "partial",
        });
        if (cancelled) this.dependencies.sessions.markCancelled(session.id);
        else if (successfulInitial.length === 0)
          this.dependencies.sessions.markFailed(session.id);
        else this.dependencies.sessions.markPartial(session.id);
        return this.report(
          session.id,
          project.id,
          cancelled
            ? "cancelled"
            : successfulInitial.length === 0
              ? "failed"
              : "partial",
          "DEBATE_NOT_ESTABLISHED",
          rounds,
          undefined,
          [],
          analyses,
        );
      }
      let board = await createInitialClaimBoard(
        project.root,
        successfulInitial.map((item) => ({
          agentId: item.agent.adapter.id,
          runId: item.id,
          response: InitialPhaseResponseSchema.parse(item.result.structured),
        })),
      );
      this.assertBoardBounds(config, board);
      let boardRecord = this.persistBoard(session.id, board);
      this.dependencies.deliberation.finishRound(
        initialRound.id,
        "completed",
        boardRecord.id,
      );
      rounds.push({
        id: initialRound.id,
        number: 1,
        phase: "initial",
        status: "completed",
      });

      let unresolved = board.claims
        .filter((claim) => claim.material)
        .map((claim) => claim.id);
      let degraded: "partial" | "cancelled" | undefined;
      for (
        let roundNumber = 1;
        unresolved.length > 0 && roundNumber <= config.maxRounds;
        roundNumber += 1
      ) {
        const context = buildDeliberationContext(config, {
          phase: "cross-examination",
          topic: input.topic,
          rules: phaseRules(),
          board,
          reviewClaimIds: unresolved,
          responseSchema: "cross-examination",
        });
        const request = this.boundedRequest(
          config,
          "cross-examination",
          input.topic,
          context.board,
          context.reviewClaimIds,
        );
        const inputSnapshot = this.persistInputSnapshot(
          config,
          session.id,
          context.board,
        );
        const round = this.dependencies.deliberation.createRound({
          sessionId: session.id,
          roundNumber: roundNumber + 1,
          phase: "cross_examination",
          status: "running",
          inputBoardId: inputSnapshot.record.id,
        });
        const schema = createCrossExaminationPhaseResponseSchema(
          context.reviewClaimIds,
          context.board.evidence.map((item) => item.id),
        );
        const runs = prepared.map((agent) => ({ agent, id: randomUUID() }));
        for (const run of runs)
          this.dependencies.sessions.createAgentRun({
            id: run.id,
            sessionId: session.id,
            agentId: run.agent.adapter.id,
            modelExecution: this.storageExecution(
              normalizeModelExecution(run.agent.selection, [], "unverified"),
            ),
            roundId: round.id,
            phase: storedPhase("cross-examination"),
            purpose: "bounded cross-examination",
            inputBoardId: inputSnapshot.record.id,
            request,
            diagnostics: {},
          });
        const results = await Promise.all(
          runs.map(async (run) => ({
            ...run,
            result: await this.invoke(
              run.agent,
              run.id,
              project,
              request,
              schema,
              controller.signal,
            ),
          })),
        );
        for (const item of results) {
          const parsed = schema.safeParse(item.result.structured);
          this.finishRun(
            item.id,
            item.result,
            parsed.success && item.result.status === "completed"
              ? parsed.data
              : undefined,
          );
        }
        const valid = results.filter(
          (item) =>
            item.result.status === "completed" &&
            schema.safeParse(item.result.structured).success,
        );
        const appended = await appendPhaseEvidence(
          project.root,
          board,
          valid.flatMap((item) =>
            schema.parse(item.result.structured).newEvidence.map((draft) => ({
              agentId: item.agent.adapter.id,
              runId: item.id,
              draft,
            })),
          ),
        );
        const output = {
          ...appended.board,
          version: inputSnapshot.board.version + 1,
        };
        this.assertBoardBounds(config, output);
        const outputRecord = this.persistBoard(session.id, output);
        const roundStatus = controller.signal.aborted
          ? "cancelled"
          : valid.length === 2
            ? "completed"
            : valid.length === 0
              ? "failed"
              : "partial";
        this.dependencies.deliberation.finishRound(
          round.id,
          roundStatus,
          outputRecord.id,
        );
        rounds.push({
          id: round.id,
          number: roundNumber + 1,
          phase: "cross-examination",
          status: roundStatus,
        });
        const crossStances: StanceRecord[] = [];
        for (const item of valid)
          for (const stance of schema.parse(item.result.structured).stances) {
            const record = this.dependencies.deliberation.addStance({
              boardId: outputRecord.id,
              canonicalClaimId: stance.claimId,
              roundId: round.id,
              agentRunId: item.id,
              agentId: item.agent.adapter.id,
              stance: stance.value,
              reasoning: stance.reasoning,
            });
            const evidenceIds = [
              ...stance.existingEvidenceIds,
              ...stance.newEvidenceLocalIds.map((localId) => {
                const id = appended.localToCanonical.get(
                  `${item.agent.adapter.id}\u0000${item.id}\u0000${localId}`,
                );
                if (id === undefined)
                  throw new DebateServiceError(
                    "DANGLING_EVIDENCE",
                    "New evidence was not canonicalized",
                  );
                return id;
              }),
            ];
            for (const evidenceId of evidenceIds)
              this.dependencies.deliberation.linkStanceEvidence({
                stanceId: record.id,
                boardId: outputRecord.id,
                canonicalEvidenceId: evidenceId,
              });
            crossStances.push({
              claimId: stance.claimId,
              value: stance.value,
              reasoning: stance.reasoning,
              evidenceIds: evidenceIds as StanceRecord["evidenceIds"],
              agentId: item.agent.adapter.id,
              agentRunId: item.id,
              roundId: round.id,
            });
          }
        board = output;
        boardRecord = outputRecord;
        unresolved = board.claims
          .filter(
            (claim) =>
              claim.material &&
              crossStances.some(
                (stance) =>
                  stance.claimId === claim.id && stance.value !== "ACCEPT",
              ),
          )
          .map((claim) => claim.id);
        if (roundStatus !== "completed") {
          degraded = roundStatus === "cancelled" ? "cancelled" : "partial";
          break;
        }
      }

      this.assertBoardBounds(config, board);
      const finalContext = buildDeliberationContext(config, {
        phase: "final",
        topic: input.topic,
        rules: phaseRules(),
        board,
        reviewClaimIds: board.claims.map((claim) => claim.id),
        responseSchema: "final",
      });
      const request = this.boundedRequest(
        config,
        "final",
        input.topic,
        finalContext.board,
        finalContext.reviewClaimIds,
      );
      const finalInputSnapshot = this.persistInputSnapshot(
        config,
        session.id,
        finalContext.board,
      );
      const finalRound = this.dependencies.deliberation.createRound({
        sessionId: session.id,
        roundNumber: rounds.length + 1,
        phase: "final",
        status: "running",
        inputBoardId: finalInputSnapshot.record.id,
      });
      const finalSchema = createFinalPhaseResponseSchema(
        finalContext.board.claims.map((claim) => claim.id),
        finalContext.board.evidence.map((item) => item.id),
      );
      const finalRuns = prepared.map((agent) => ({ agent, id: randomUUID() }));
      for (const run of finalRuns)
        this.dependencies.sessions.createAgentRun({
          id: run.id,
          sessionId: session.id,
          agentId: run.agent.adapter.id,
          modelExecution: this.storageExecution(
            normalizeModelExecution(run.agent.selection, [], "unverified"),
          ),
          roundId: finalRound.id,
          phase: "final",
          purpose: "independent final position",
          inputBoardId: finalInputSnapshot.record.id,
          request,
          diagnostics: {},
        });
      const finalResults = await Promise.all(
        finalRuns.map(async (run) => ({
          ...run,
          result: await this.invoke(
            run.agent,
            run.id,
            project,
            request,
            finalSchema,
            controller.signal,
          ),
        })),
      );
      for (const item of finalResults) {
        const parsed = finalSchema.safeParse(item.result.structured);
        this.finishRun(
          item.id,
          item.result,
          parsed.success && item.result.status === "completed"
            ? parsed.data
            : undefined,
        );
      }
      const completedFinal = finalResults.filter(
        (item) =>
          item.result.status === "completed" &&
          finalSchema.safeParse(item.result.structured).success,
      );
      const appended = await appendPhaseEvidence(
        project.root,
        board,
        completedFinal.flatMap((item) =>
          finalSchema
            .parse(item.result.structured)
            .newEvidence.map((draft) => ({
              agentId: item.agent.adapter.id,
              runId: item.id,
              draft,
            })),
        ),
      );
      const output = {
        ...appended.board,
        version: finalInputSnapshot.board.version + 1,
      };
      this.assertBoardBounds(config, output);
      const outputRecord = this.persistBoard(session.id, output);
      const finalStatus = controller.signal.aborted
        ? "cancelled"
        : completedFinal.length === 2
          ? "completed"
          : completedFinal.length === 0
            ? "failed"
            : "partial";
      this.dependencies.deliberation.finishRound(
        finalRound.id,
        finalStatus,
        outputRecord.id,
      );
      rounds.push({
        id: finalRound.id,
        number: rounds.length + 1,
        phase: "final",
        status: finalStatus,
      });
      const finalStances: StanceRecord[] = [];
      for (const item of completedFinal) {
        for (const stance of finalSchema.parse(item.result.structured)
          .stances) {
          const evidenceIds = [
            ...stance.existingEvidenceIds,
            ...stance.newEvidenceLocalIds.map((localId) => {
              const id = appended.localToCanonical.get(
                `${item.agent.adapter.id}\u0000${item.id}\u0000${localId}`,
              );
              if (id === undefined)
                throw new DebateServiceError(
                  "DANGLING_EVIDENCE",
                  "New evidence was not canonicalized",
                );
              return id;
            }),
          ];
          finalStances.push({
            claimId: stance.claimId,
            value: stance.value,
            reasoning: stance.reasoning,
            evidenceIds: evidenceIds as StanceRecord["evidenceIds"],
            agentId: item.agent.adapter.id,
            agentRunId: item.id,
            roundId: finalRound.id,
          });
          const record = this.dependencies.deliberation.addStance({
            boardId: outputRecord.id,
            canonicalClaimId: stance.claimId,
            roundId: finalRound.id,
            agentRunId: item.id,
            agentId: item.agent.adapter.id,
            stance: stance.value,
            reasoning: stance.reasoning,
          });
          for (const evidenceId of evidenceIds)
            this.dependencies.deliberation.linkStanceEvidence({
              stanceId: record.id,
              boardId: outputRecord.id,
              canonicalEvidenceId: evidenceId,
            });
        }
      }
      for (const item of completedFinal) {
        const response = finalSchema.parse(item.result.structured);
        this.dependencies.deliberation.addFinalPosition({
          sessionId: session.id,
          boardId: outputRecord.id,
          roundId: finalRound.id,
          agentRunId: item.id,
          agentId: item.agent.adapter.id,
          position: response,
          stances: response.stances.map((stance) => ({
            canonicalClaimId: stance.claimId,
            stance: stance.value,
          })),
        });
      }
      const persistedVerdicts = deriveVerdicts(output, finalStances);
      const codexRunId = finalResults.find(
        (item) => item.agent.adapter.id === "codex",
      )?.id;
      const claudeRunId = finalResults.find(
        (item) => item.agent.adapter.id === "claude",
      )?.id;
      for (const verdict of persistedVerdicts) {
        this.dependencies.deliberation.addVerdict({
          sessionId: session.id,
          boardId: outputRecord.id,
          canonicalClaimId: String(verdict.claimId),
          roundId: finalRound.id,
          ...(codexRunId === undefined ? {} : { codexRunId }),
          ...(claudeRunId === undefined ? {} : { claudeRunId }),
          classification: verdict.classification,
          evidenceSupport:
            verdict.support === "UNSUPPORTED" ? "UNSUPPORTED" : "SUPPORTED",
          verdict,
        });
      }
      const status =
        degraded ??
        (finalStatus === "completed"
          ? "completed"
          : finalStatus === "cancelled"
            ? "cancelled"
            : "partial");
      if (status === "completed")
        this.dependencies.sessions.markCompleted(session.id);
      else if (status === "cancelled")
        this.dependencies.sessions.markCancelled(session.id);
      else this.dependencies.sessions.markPartial(session.id);
      return this.report(
        session.id,
        project.id,
        status,
        "DEBATE",
        rounds,
        output,
        finalStances,
        analyses,
      );
    } catch (error: unknown) {
      this.dependencies.sessions.addError({
        sessionId: session.id,
        code:
          error instanceof DebateServiceError ||
          error instanceof AgentBoundaryError
            ? error.code
            : "DEBATE_FAILED",
        message: error instanceof Error ? error.message : "Debate failed",
        context: {},
      });
      if (controller.signal.aborted)
        this.dependencies.sessions.markCancelled(session.id);
      else this.dependencies.sessions.markFailed(session.id);
      throw error;
    } finally {
      this.dependencies.activeRuns.unregister(session.id);
    }
  }
}
