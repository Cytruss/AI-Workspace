import type { DebateConfig } from "../config/schema.js";
import type {
  CanonicalClaim,
  CanonicalEvidence,
  ClaimBoard,
  StanceRecord,
  Verdict,
} from "../agents/structured-response.js";

export type { DebateConfig } from "../config/schema.js";
export type VerdictClassification =
  "CONSENSUS" | "DISAGREEMENT" | "REJECTED" | "UNRESOLVED";
export type EvidenceStatus = "VERIFIED" | "INVALID" | "MISSING";

export interface DebateInput {
  scope: { guildId: string; channelId: string; userId: string };
  interactionId: string;
  projectId?: string;
  codexModel?: string;
  claudeModel?: string;
  topic: string;
}

export interface DebateReport {
  sessionId: string;
  status: "completed" | "partial" | "failed" | "cancelled";
  classification: "DEBATE" | "DEBATE_NOT_ESTABLISHED";
  projectId: string;
  rounds: readonly DebateRoundSummary[];
  board?: ClaimBoard;
  verdicts: readonly Verdict[];
  consensus: readonly Verdict[];
  disagreements: readonly Verdict[];
  rejected: readonly Verdict[];
  unresolved: readonly Verdict[];
  analyses: readonly IndependentAnalysis[];
}

export interface DebateRoundSummary {
  id: string;
  number: number;
  phase: "initial" | "cross-examination" | "final";
  status: "completed" | "partial" | "failed" | "cancelled";
}

export interface IndependentAnalysis {
  agentId: string;
  runId: string;
  content?: string;
  status: "completed" | "failed" | "cancelled" | "timed_out";
}

export interface VerdictInput {
  claim: CanonicalClaim;
  evidence: readonly CanonicalEvidence[];
  finalStances: readonly StanceRecord[];
}

export interface DeliberationContext {
  phase: "cross-examination" | "final";
  topic: string;
  rules: readonly string[];
  board: ClaimBoard;
  reviewClaimIds: readonly string[];
  responseSchema: "cross-examination" | "final";
}

export type DebateConfigSnapshot = DebateConfig;
