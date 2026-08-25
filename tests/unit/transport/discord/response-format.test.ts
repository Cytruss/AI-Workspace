import { describe, expect, test } from "vitest";
import {
  formatAskReport,
  formatDebateReport,
  formatModels,
} from "../../../../src/transport/discord/response-format.js";

describe("Discord response formatting", () => {
  test("formats configured model classes without exposing configurable raw input values", () => {
    const payload = formatModels({
      codex: {
        defaultModel: "sol",
        selections: [{ class: "sol", cliModelId: "raw-codex-value", acceptedObservedModels: { exactIds: ["observed"], literalPrefixes: [] } }],
      },
      claude: { selections: [] },
    });
    expect(payload.content).toContain("Codex: sol (default)");
    expect(payload.content).toContain("Claude: provider default (no configured class)");
    expect(payload.content).toContain("Observation policy: exact IDs and literal prefixes");
    expect(payload.content).toContain("not entitlement verification");
    expect(payload.content).not.toContain("raw-codex-value");
  });

  test("formats each ask agent separately with persisted model evidence and safe diagnostics", () => {
    const payload = formatAskReport({
      sessionId: "session-1",
      status: "partial",
      project: { id: "demo", name: "Demo", root: "C:\\secret-root" },
      results: [
        { agentId: "codex", status: "completed", response: "answer", durationMs: 1, diagnostics: [], modelExecution: { requestedClass: "sol", requestedCliModelId: "gpt-sol", requestedEffort: "high", observedModelIds: ["gpt-sol"], verification: "verified" } },
        { agentId: "claude", status: "failed", durationMs: 1, diagnostics: ["provider failed /private/value"], modelExecution: { observedModelIds: [], verification: "unverified" } },
      ],
    });
    expect(payload.content).toContain("Project: demo");
    expect(payload.content).toContain("Session: session-1");
    expect(payload.content).toContain("## Codex");
    expect(payload.content).toContain("Requested class: sol");
    expect(payload.content).toContain("Requested CLI model ID: gpt-sol");
    expect(payload.content).toContain("Verification: verified");
    expect(payload.content).toContain("## Claude");
    expect(payload.content).not.toContain("/private/value");
  });

  test("renders debate verdict sections deterministically without relabeling model prose", () => {
    const report = {
      sessionId: "session-2", status: "partial", classification: "DEBATE",
      projectId: "demo", rounds: [], analyses: [
        { agentId: "codex", runId: "run-c", status: "completed", content: "Model says rejected" },
        { agentId: "claude", runId: "run-a", status: "completed", content: "Model says consensus" },
      ], board: { version: 1, claims: [], evidence: [] },
      consensus: [{ claimId: "claim-b", classification: "CONSENSUS", support: "UNSUPPORTED", finalStances: [], evidence: [], provenance: [], counts: { accept: 0, dispute: 0, uncertain: 0 } }],
      disagreements: [{ claimId: "claim-a", classification: "DISAGREEMENT", support: "VERIFIED", finalStances: [], evidence: [], provenance: [], counts: { accept: 0, dispute: 0, uncertain: 0 } }],
      rejected: [], unresolved: [], verdicts: [],
    };
    const payload = formatDebateReport(report as never);
    expect(payload.content.indexOf("CONSENSUS")).toBeLessThan(payload.content.indexOf("DISAGREEMENT"));
    expect(payload.content).toContain("UNSUPPORTED");
    expect(payload.content).toContain("Model says rejected");
    expect(payload.content).toContain("Model says consensus");
    expect(payload.content).toContain("Mechanically resolved evidence and provenance");
  });

  test("uses an attachment when a report exceeds Discord's message limit", () => {
    const payload = formatAskReport({
      sessionId: "session-3", status: "completed", project: { id: "demo", name: "Demo", root: "unused" },
      results: [{ agentId: "codex", status: "completed", response: "x".repeat(2_000), durationMs: 1, diagnostics: [], modelExecution: { observedModelIds: [], verification: "unverified" } }],
    });
    expect(payload.content.length).toBeLessThanOrEqual(1_900);
    expect(payload.files).toHaveLength(1);
    expect(payload.files?.[0]?.attachment).toBeInstanceOf(Buffer);
  });
});
