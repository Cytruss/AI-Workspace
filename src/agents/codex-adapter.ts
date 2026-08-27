import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { AgentConfig } from "../config/schema.js";
import {
  assertGitIntegrityUnchanged,
  captureGitIntegrity,
} from "../permissions/git-integrity.js";
import { type ProcessResult, runProcess } from "../platform/process-runner.js";
import {
  AgentBoundaryError,
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

export const MAX_RESPONSE_SCHEMA_BYTES = 32_768;

export interface CodexArgumentOptions {
  projectRoot: string;
  schemaPath: string;
  modelSelection?: ResolvedModelSelection | undefined;
}

export function buildCodexArguments(options: CodexArgumentOptions): string[] {
  const args = [
    "exec",
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
    "--json",
    "--config",
    'permission_profile=":read-only"',
    "--config",
    'approval_policy="never"',
    "-C",
    options.projectRoot,
    "--output-schema",
    options.schemaPath,
  ];
  if (options.modelSelection !== undefined) {
    args.push("--model", options.modelSelection.cliModelId);
    if (options.modelSelection.requestedEffort !== undefined) {
      args.push(
        "--config",
        `model_reasoning_effort="${options.modelSelection.requestedEffort}"`,
      );
    }
  }
  args.push("-");
  return args;
}

export function parseCodexJsonl(output: string): unknown {
  let response: unknown;
  let agentMessageCompleted = false;
  let turnCompleted = false;
  for (const line of output.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const event: unknown = JSON.parse(line);
    if (turnCompleted) {
      throw new Error("Codex JSONL included an event after turn completion");
    }
    if (typeof event !== "object" || event === null) continue;
    const type = (event as { type?: unknown }).type;
    if (type === "turn.completed") {
      turnCompleted = true;
      continue;
    }
    if (type !== "item.completed") continue;
    const item = (event as { item?: unknown }).item;
    if (typeof item !== "object" || item === null) continue;
    if ((item as { type?: unknown }).type !== "agent_message") continue;
    const text = (item as { text?: unknown }).text;
    if (typeof text === "string") {
      response = JSON.parse(text);
      agentMessageCompleted = true;
    }
  }
  if (turnCompleted && agentMessageCompleted && response !== undefined) {
    return response;
  }
  throw new Error(
    "Codex JSONL did not include a completed structured response",
  );
}

export const CODEX_MINIMUM_HARDENED_VERSION = "0.76.0";
const PROBE_TIMEOUT_MS = 10_000;
const PROBE_MAX_OUTPUT_BYTES = 256 * 1024;
const CODEX_FLAGS = [
  "--ephemeral",
  "--ignore-user-config",
  "--ignore-rules",
  "--json",
  "--output-schema",
  "--model",
  "--config",
] as const;

type Dependencies = Readonly<{
  runProcess?: typeof runProcess;
  captureGitIntegrity?: typeof captureGitIntegrity;
}>;

function versionAtLeast(value: string, minimum: string): boolean {
  const match = value.match(/(\d+)\.(\d+)\.(\d+)/);
  if (match === null) return false;
  const numbers = match.slice(1).map(Number);
  const floor = minimum.split(".").map(Number);
  for (let index = 0; index < floor.length; index += 1) {
    const actual = numbers[index] ?? 0;
    const required = floor[index] ?? 0;
    if (actual !== required) return actual > required;
  }
  return true;
}

function resultStatus(result: ProcessResult): AgentResult["status"] {
  if (result.termination === "cancelled") return "cancelled";
  if (result.termination === "timed_out") return "timed_out";
  return result.exitCode === 0 && result.termination === "exit"
    ? "completed"
    : "failed";
}

export class CodexAdapter implements AgentAdapter {
  readonly id = "codex" as const;
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
          "OPENAI_API_KEY",
          "CODEX_HOME",
        ]),
        timeoutMs: PROBE_TIMEOUT_MS,
        maxOutputBytes: PROBE_MAX_OUTPUT_BYTES,
        signal,
      };
      const version = await this.process({ ...common, args: ["--version"] });
      const help = await this.process({ ...common, args: ["exec", "--help"] });
      if (
        version.exitCode !== 0 ||
        help.exitCode !== 0 ||
        version.termination !== "exit" ||
        help.termination !== "exit" ||
        !versionAtLeast(version.stdout, CODEX_MINIMUM_HARDENED_VERSION)
      )
        throw new Error(
          `Unsupported Codex version; require ${CODEX_MINIMUM_HARDENED_VERSION} or later`,
        );
      requireHelpFlags(help.stdout, CODEX_FLAGS);
      if (!/(^|\s)(--cd|-C)(?:\s|$)/m.test(help.stdout))
        throw new Error("Missing required CLI capability: --cd or -C");
      const effort = help.stdout
        .match(/model_reasoning_effort(?:=|\s+)([a-z]+(?:[|,][a-z]+)*)/i)?.[1]
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
          flag: "--config",
          ...(effort === undefined ? {} : { allowedValues: effort }),
        },
        observedModelReporting: { supported: false },
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
          error instanceof Error ? error.message : "Codex probe failed",
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
    const directory = await mkdtemp(join(tmpdir(), "ai-workspace-codex-"));
    const schemaPath = join(directory, "response-schema.json");
    try {
      await writeFile(schemaPath, schema, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
      const processResult = await this.process({
        command: this.config.command,
        args: buildCodexArguments({
          projectRoot: request.projectRoot,
          schemaPath,
          modelSelection: request.modelSelection,
        }),
        cwd: request.projectRoot,
        stdin: request.prompt,
        env: buildSafeEnvironment(process.env, [
          "OPENAI_API_KEY",
          "CODEX_HOME",
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
      const status = resultStatus(processResult);
      if (status !== "completed")
        return this.failed(
          request,
          processResult.durationMs,
          diagnostics,
          status,
          processResult,
        );
      const structured = request.responseSchema.parse(
        parseCodexJsonl(processResult.stdout),
      );
      return {
        agentId: this.id,
        status: "completed",
        structured,
        response: JSON.stringify(structured),
        ...(processResult.exitCode === null
          ? {}
          : { exitCode: processResult.exitCode }),
        durationMs: processResult.durationMs,
        modelExecution: this.execution(request.modelSelection),
        diagnostics,
      };
    } catch (error) {
      return this.failed(request, 0, [
        error instanceof Error ? error.message : "Codex adapter failed",
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 0 });
    }
  }

  private execution(selection: ResolvedModelSelection | undefined) {
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
      observedModelIds: [] as string[],
      verification: "unverified" as const,
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
  ): AgentResult {
    return {
      agentId: this.id,
      status,
      ...(processResult?.exitCode === undefined ||
      processResult.exitCode === null
        ? {}
        : { exitCode: processResult.exitCode }),
      durationMs,
      modelExecution: this.execution(request.modelSelection),
      diagnostics,
    };
  }
}
