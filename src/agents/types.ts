import type { z } from "zod";
import type { ProcessResult } from "../platform/process-runner.js";
import type {
  ModelExecution,
  ProviderPhaseResponse,
} from "./structured-response.js";

export type { ModelExecution } from "./structured-response.js";

export type AgentId = "codex" | "claude" | (string & {});
export type BuiltInAgentId = "codex" | "claude";
export type AgentSelection = BuiltInAgentId | "both";

export type ResolvedModelSelection = Readonly<{
  class: string;
  cliModelId: string;
  requestedEffort?: string;
}>;

export interface AgentCapabilities {
  available: boolean;
  version?: string;
  authenticated?: boolean;
  nonInteractive: boolean;
  structuredOutput: boolean;
  readOnlyEnforcement: boolean;
  modelOption: { supported: boolean; flag?: string };
  effortOption: {
    supported: boolean;
    flag?: string;
    allowedValues?: readonly string[];
  };
  observedModelReporting: { supported: boolean; source?: string };
  diagnostics: string[];
}

export interface AgentRequest {
  runId: string;
  projectRoot: string;
  mode: "observe";
  prompt: string;
  timeoutMs: number;
  maxOutputBytes: number;
  responseSchema?: z.ZodType<ProviderPhaseResponse>;
  modelSelection?: ResolvedModelSelection;
}

export type AgentStructuredResult =
  ProviderPhaseResponse | Readonly<{ phase: "ask"; content: string }>;

export interface AgentResult {
  agentId: AgentId;
  status: "completed" | "failed" | "cancelled" | "timed_out";
  response?: string;
  structured?: AgentStructuredResult;
  exitCode?: Exclude<ProcessResult["exitCode"], null>;
  durationMs: number;
  modelExecution: ModelExecution;
  diagnostics: string[];
}

export interface AgentAdapter {
  readonly id: AgentId;
  probe(): Promise<AgentCapabilities>;
  run(request: AgentRequest, signal: AbortSignal): Promise<AgentResult>;
}
