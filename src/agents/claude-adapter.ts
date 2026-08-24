import { z } from "zod";
import type { AgentConfig } from "../config/schema.js";
import {
  assertGitIntegrityUnchanged,
  captureGitIntegrity,
} from "../permissions/git-integrity.js";
import { type ProcessResult, runProcess } from "../platform/process-runner.js";
import {
  AgentBoundaryError,
  normalizeModelExecution,
  validateModelCapabilities,
} from "./agent-registry.js";
import { requireHelpFlags } from "./help-capabilities.js";
import { buildSafeEnvironment } from "./safe-environment.js";
import {
  type AgentAdapter,
  type AgentCapabilities,
  type AgentRequest,
  type AgentResult,
  type ResolvedModelSelection,
} from "./types.js";

export const CLAUDE_SETTINGS =
  '{"fallbackModel":[],"switchModelsOnFlag":false}';
export const MAX_RESPONSE_SCHEMA_BYTES = 32_768;

export interface ClaudeArgumentOptions {
  schema: string;
  modelSelection?: ResolvedModelSelection | undefined;
}

export function buildClaudeArguments(options: ClaudeArgumentOptions): string[] {
  const args = [
    "--bare",
    "--settings",
    CLAUDE_SETTINGS,
    "--tools",
    "Read,Glob,Grep",
    "--disallowedTools",
    "mcp__*",
    "--permission-mode",
    "plan",
    "--no-session-persistence",
    "-p",
    "--output-format",
    "json",
    "--json-schema",
    options.schema,
  ];
  if (options.modelSelection !== undefined) {
    args.push("--model", options.modelSelection.cliModelId);
    if (options.modelSelection.requestedEffort !== undefined) {
      args.push("--effort", options.modelSelection.requestedEffort);
    }
  }
  return args;
}

export function parseClaudeResult(output: string): string {
  const parsed: unknown = JSON.parse(output);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Claude result was not a JSON object");
  }
  const result = parsed as {
    is_error?: unknown;
    result?: unknown;
    subtype?: unknown;
  };
  if (result.is_error === true || result.subtype === "error_during_execution") {
    throw new Error("Claude rejected the request");
  }
  if (typeof result.result !== "string") {
    throw new Error("Claude result did not contain a response string");
  }
  return result.result;
}

export const CLAUDE_MINIMUM_HARDENED_VERSION = "2.1.233";
const PROBE_TIMEOUT_MS = 10_000;
const PROBE_MAX_OUTPUT_BYTES = 256 * 1024;
const CLAUDE_FLAGS = [
  "--bare",
  "--settings",
  "--tools",
  "--disallowedTools",
  "--permission-mode",
  "--no-session-persistence",
  "--output-format",
  "--json-schema",
  "--model",
  "--effort",
] as const;
type Dependencies = Readonly<{
  runProcess?: typeof runProcess;
  captureGitIntegrity?: typeof captureGitIntegrity;
}>;
function atLeast(value: string): boolean {
  const match = value.match(/(\d+)\.(\d+)\.(\d+)/);
  if (match === null) return false;
  const have = match.slice(1).map(Number);
  const need = CLAUDE_MINIMUM_HARDENED_VERSION.split(".").map(Number);
  for (let index = 0; index < need.length; index += 1) {
    const actual = have[index] ?? 0;
    const required = need[index] ?? 0;
    if (actual !== required) return actual > required;
  }
  return true;
}
function statusOf(result: ProcessResult): AgentResult["status"] {
  if (result.termination === "cancelled") return "cancelled";
  if (result.termination === "timed_out") return "timed_out";
  return result.exitCode === 0 && result.termination === "exit"
    ? "completed"
    : "failed";
}
function observed(output: string): string[] {
  const parsed = JSON.parse(output) as { modelUsage?: unknown };
  if (
    typeof parsed.modelUsage !== "object" ||
    parsed.modelUsage === null ||
    Array.isArray(parsed.modelUsage)
  )
    return [];
  return [
    ...new Set(Object.keys(parsed.modelUsage).map((id) => id.trim())),
  ].sort();
}

export class ClaudeAdapter implements AgentAdapter {
  readonly id = "claude" as const;
  private readonly process: typeof runProcess;
  private readonly integrity: typeof captureGitIntegrity;
  constructor(
    private readonly config: AgentConfig,
    dependencies: Dependencies = {},
  ) {
    this.process = dependencies.runProcess ?? runProcess;
    this.integrity = dependencies.captureGitIntegrity ?? captureGitIntegrity;
  }
  async probe(): Promise<AgentCapabilities> {
    const signal = new AbortController().signal;
    try {
      const common = {
        command: this.config.command,
        cwd: process.cwd(),
        env: buildSafeEnvironment(process.env, [
          "ANTHROPIC_API_KEY",
          "CLAUDE_CONFIG_DIR",
        ]),
        timeoutMs: PROBE_TIMEOUT_MS,
        maxOutputBytes: PROBE_MAX_OUTPUT_BYTES,
        signal,
      };
      const version = await this.process({ ...common, args: ["--version"] });
      const help = await this.process({ ...common, args: ["--help"] });
      if (
        version.exitCode !== 0 ||
        help.exitCode !== 0 ||
        version.termination !== "exit" ||
        help.termination !== "exit" ||
        !atLeast(version.stdout)
      )
        throw new Error(
          `Unsupported Claude version; require ${CLAUDE_MINIMUM_HARDENED_VERSION} or later`,
        );
      requireHelpFlags(help.stdout, CLAUDE_FLAGS);
      if (
        !/(^|\s)(--print|-p)(?:\s|$)/m.test(help.stdout) ||
        !/modelUsage/.test(help.stdout)
      )
        throw new Error(
          "Missing required CLI capability: print mode or modelUsage",
        );
      const effort = help.stdout
        .match(
          /--effort[^\n]*(?:values|one of)[: ]+([a-z]+(?:[|,][a-z]+)*)/i,
        )?.[1]
        ?.split(/[|,]/);
      const versionText = version.stdout.match(/\d+\.\d+\.\d+/)?.[0];
      return {
        available: true,
        ...(versionText === undefined ? {} : { version: versionText }),
        nonInteractive: true,
        structuredOutput: true,
        readOnlyEnforcement: true,
        modelOption: { supported: true, flag: "--model" },
        effortOption: {
          supported: true,
          flag: "--effort",
          ...(effort === undefined ? {} : { allowedValues: effort }),
        },
        observedModelReporting: { supported: true, source: "modelUsage" },
        diagnostics: [],
      };
    } catch (error) {
      return {
        available: false,
        nonInteractive: false,
        structuredOutput: false,
        readOnlyEnforcement: false,
        modelOption: { supported: false },
        effortOption: { supported: false },
        observedModelReporting: { supported: false },
        diagnostics: [
          error instanceof Error ? error.message : "Claude probe failed",
        ],
      };
    }
  }
  async run(request: AgentRequest, signal: AbortSignal): Promise<AgentResult> {
    this.validateSelection(request.modelSelection);
    const capabilities = await this.probe();
    if (!capabilities.available)
      return this.failed(request, 0, capabilities.diagnostics);
    validateModelCapabilities(capabilities, request.modelSelection);
    if (request.responseSchema === undefined)
      return this.failed(request, 0, [
        "OBSERVE mode with a response schema is required",
      ]);
    const schema = JSON.stringify(z.toJSONSchema(request.responseSchema));
    if (Buffer.byteLength(schema, "utf8") > MAX_RESPONSE_SCHEMA_BYTES)
      return this.failed(request, 0, ["Response schema exceeds 32768 bytes"]);
    const before = await this.integrity(request.projectRoot);
    try {
      const processResult = await this.process({
        command: this.config.command,
        args: buildClaudeArguments({
          schema,
          modelSelection: request.modelSelection,
        }),
        cwd: request.projectRoot,
        stdin: request.prompt,
        env: buildSafeEnvironment(process.env, [
          "ANTHROPIC_API_KEY",
          "CLAUDE_CONFIG_DIR",
        ]),
        timeoutMs: request.timeoutMs,
        maxOutputBytes: request.maxOutputBytes,
        signal,
      });
      const diagnostics = [processResult.stdout, processResult.stderr].filter(
        (value) => value !== "",
      );
      try {
        assertGitIntegrityUnchanged(
          before,
          await this.integrity(request.projectRoot),
        );
      } catch {
        return this.failed(
          request,
          processResult.durationMs,
          [...diagnostics, "PROJECT_INTEGRITY_CHANGED"],
          "failed",
          processResult,
        );
      }
      const status = statusOf(processResult);
      if (status !== "completed")
        return this.failed(
          request,
          processResult.durationMs,
          diagnostics,
          status,
          processResult,
        );
      const response = parseClaudeResult(processResult.stdout);
      const structured = request.responseSchema.parse(JSON.parse(response));
      const ids = observed(processResult.stdout);
      let execution: ReturnType<typeof normalizeModelExecution>;
      try {
        execution = normalizeModelExecution(
          request.modelSelection,
          ids,
          request.modelSelection === undefined ? "unverified" : "verified",
        );
      } catch (error) {
        return this.failed(
          request,
          processResult.durationMs,
          [
            ...diagnostics,
            error instanceof Error
              ? error.message
              : "MODEL_OBSERVATION_INVALID",
          ],
          "failed",
          processResult,
        );
      }
      if (request.modelSelection !== undefined) {
        if (ids.length === 0)
          return this.failed(
            request,
            processResult.durationMs,
            [...diagnostics, "MODEL_OBSERVATION_UNAVAILABLE"],
            "failed",
            processResult,
            execution,
          );
        const policy = this.config.models.selections.find(
          (entry) => entry.class === request.modelSelection?.class,
        )?.acceptedObservedModels;
        const accepted =
          policy !== undefined &&
          ids.every(
            (id) =>
              policy.exactIds.includes(id) ||
              policy.literalPrefixes.some((prefix) => id.startsWith(prefix)),
          );
        if (!accepted)
          return this.failed(
            request,
            processResult.durationMs,
            [...diagnostics, "MODEL_CLASS_CHANGED"],
            "failed",
            processResult,
            execution,
          );
      }
      return {
        agentId: this.id,
        status: "completed",
        structured,
        response,
        ...(processResult.exitCode === null
          ? {}
          : { exitCode: processResult.exitCode }),
        durationMs: processResult.durationMs,
        modelExecution: execution,
        diagnostics,
      };
    } catch (error) {
      return this.failed(request, 0, [
        error instanceof Error ? error.message : "Claude adapter failed",
      ]);
    }
  }
  private execution(
    selection: ResolvedModelSelection | undefined,
    ids: string[] = [],
  ) {
    return {
      ...(selection === undefined
        ? {}
        : {
            requestedClass: selection.class,
            requestedCliModelId: selection.cliModelId,
            ...(selection.requestedEffort === undefined
              ? {}
              : { requestedEffort: selection.requestedEffort }),
          }),
      observedModelIds: ids,
      verification:
        selection === undefined
          ? ("unverified" as const)
          : ("verified" as const),
    };
  }
  private validateSelection(
    selection: ResolvedModelSelection | undefined,
  ): void {
    if (selection === undefined) return;
    const configured = this.config.models.selections.find(
      (entry) => entry.class === selection.class,
    );
    if (
      configured === undefined ||
      configured.cliModelId !== selection.cliModelId ||
      configured.requestedEffort !== selection.requestedEffort
    ) {
      throw new AgentBoundaryError(
        "AGENT_MODEL_UNSUPPORTED",
        "Resolved model selection does not match configured model policy",
      );
    }
  }
  private failed(
    request: AgentRequest,
    durationMs: number,
    diagnostics: string[],
    status: AgentResult["status"] = "failed",
    processResult?: ProcessResult,
    execution: ReturnType<typeof normalizeModelExecution> = this.execution(
      request.modelSelection,
    ),
  ): AgentResult {
    return {
      agentId: this.id,
      status,
      ...(processResult?.exitCode === undefined ||
      processResult.exitCode === null
        ? {}
        : { exitCode: processResult.exitCode }),
      durationMs,
      modelExecution: execution,
      diagnostics,
    };
  }
}
