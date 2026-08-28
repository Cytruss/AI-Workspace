import { describe, expect, test } from "vitest";
import {
  formatAskReport,
  formatDebateReport,
  formatDebateReportParts,
  formatModels,
} from "../../../../src/transport/discord/response-format.js";

describe("Discord response formatting", () => {
  test("formats configured model classes without exposing configurable raw input values", () => {
    const payload = formatModels({
      codex: {
        defaultModel: "sol",
        selections: [
          {
            class: "sol",
            cliModelId: "raw-codex-value",
            acceptedObservedModels: {
              exactIds: ["observed"],
              literalPrefixes: [],
            },
          },
        ],
      },
      claude: { selections: [] },
    });
    expect(payload.content).toContain("Codex: sol (default)");
    expect(payload.content).toContain(
      "Claude: provider default (no configured class)",
    );
    expect(payload.content).toContain(
      "Observation policy: exact IDs and literal prefixes",
    );
    expect(payload.content).toContain("not entitlement verification");
    expect(payload.content).not.toContain("raw-codex-value");
  });

  test("formats each ask agent separately with persisted model evidence and safe diagnostics", () => {
    const payload = formatAskReport({
      sessionId: "session-1",
      status: "partial",
      project: { id: "demo", name: "Demo", root: "C:\\secret-root" },
      results: [
        {
          agentId: "codex",
          status: "completed",
          response: "answer",
          durationMs: 1,
          diagnostics: [],
          modelExecution: {
            requestedClass: "sol",
            requestedCliModelId: "gpt-sol",
            requestedEffort: "high",
            observedModelIds: ["gpt-sol"],
            verification: "verified",
          },
        },
        {
          agentId: "claude",
          status: "failed",
          durationMs: 1,
          diagnostics: ["provider failed /private/value"],
          modelExecution: { observedModelIds: [], verification: "unverified" },
        },
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

  test("shows successful provider-default content with an unverified warning", () => {
    const payload = formatAskReport({
      sessionId: "session-unverified",
      status: "completed",
      project: { id: "demo", name: "Demo", root: "unused" },
      results: [
        {
          agentId: "codex",
          status: "completed",
          response: "unverified model answer",
          durationMs: 1,
          diagnostics: [],
          modelExecution: { observedModelIds: [], verification: "unverified" },
        },
      ],
    });
    expect(payload.content).toContain("unverified model answer");
    expect(payload.content).toContain("Verification marker: unverified");
    expect(payload.content).toContain(
      "Provider-default execution was successful but cannot be model-verified",
    );
  });

  test("renders fenced top-level listings as readable bullets", () => {
    const payload = formatAskReport({
      sessionId: "session-listing",
      status: "completed",
      project: { id: "demo", name: "Demo", root: "unused" },
      results: [
        {
          agentId: "codex",
          status: "completed",
          durationMs: 1,
          diagnostics: [],
          response:
            "Top-level contents:\n\n```text\n.editorconfig\n.git/\nsrc/\npackage.json\n```",
          modelExecution: { observedModelIds: [], verification: "unverified" },
        },
      ],
    });
    expect(payload.content).toContain("- .editorconfig");
    expect(payload.content).toContain("- .git/");
    expect(payload.content).toContain("- src/");
    expect(payload.content).toContain("- package.json");
    expect(payload.content).not.toContain("```text");
  });

  test("unwraps serialized ask content into Discord line breaks", () => {
    const payload = formatAskReport({
      sessionId: "session-serialized",
      status: "completed",
      project: { id: "demo", name: "Demo", root: "unused" },
      results: [
        {
          agentId: "codex",
          status: "completed",
          durationMs: 1,
          diagnostics: [],
          response:
            '{"phase":"ask","content":"Top-level folders:\\n\\n- `.git`\\n- `src`"}',
          modelExecution: { observedModelIds: [], verification: "unverified" },
        },
      ],
    });
    expect(payload.content).toContain(
      "Top-level folders:\n\n- `.git`\n- `src`",
    );
    expect(payload.content).not.toContain('{"phase":"ask"');
  });

  test("withholds content for an explicit selection that failed verification", () => {
    const payload = formatAskReport({
      sessionId: "session-explicit-unverified",
      status: "partial",
      project: { id: "demo", name: "Demo", root: "unused" },
      results: [
        {
          agentId: "claude",
          status: "failed",
          response: "wrong model answer",
          durationMs: 1,
          diagnostics: ["MODEL_CLASS_CHANGED"],
          modelExecution: {
            requestedClass: "sonnet",
            requestedCliModelId: "claude-sonnet",
            observedModelIds: ["claude-opus"],
            verification: "unverified",
          },
        },
      ],
    });
    expect(payload.content).not.toContain("wrong model answer");
    expect(payload.content).toContain("Safe diagnostics");
  });

  test("labels configured classes without a default as provider default by omission", () => {
    const payload = formatModels({
      codex: { selections: [{ class: "sol" }] },
      claude: { selections: [] },
    });
    expect(payload.content).toContain(
      "Codex: sol (provider default by omission)",
    );
  });

  test("renders debate verdict sections deterministically without relabeling model prose", () => {
    const report = {
      sessionId: "session-2",
      status: "partial",
      classification: "DEBATE",
      projectId: "demo",
      rounds: [],
      analyses: [
        {
          agentId: "codex",
          runId: "run-c",
          status: "completed",
          content: "Model says rejected",
        },
        {
          agentId: "claude",
          runId: "run-a",
          status: "completed",
          content: "Model says consensus",
        },
      ],
      board: {
        version: 1,
        claims: [
          {
            id: "claim-b",
            text: "Use deterministic verdicts",
            material: true,
            evidenceIds: [],
            origins: [],
          },
          {
            id: "claim-a",
            text: "Preserve disagreements",
            material: true,
            evidenceIds: [],
            origins: [],
          },
        ],
        evidence: [],
      },
      consensus: [
        {
          claimId: "claim-b",
          classification: "CONSENSUS",
          support: "UNSUPPORTED",
          finalStances: [
            {
              claimId: "claim-b",
              value: "ACCEPT",
              reasoning: "Determinism is auditable",
              evidenceIds: [],
              agentId: "codex",
              agentRunId: "final-c",
              roundId: "final-round",
            },
          ],
          evidence: [],
          provenance: [],
          counts: { accept: 0, dispute: 0, uncertain: 0 },
        },
      ],
      disagreements: [
        {
          claimId: "claim-a",
          classification: "DISAGREEMENT",
          support: "VERIFIED",
          finalStances: [],
          evidence: [],
          provenance: [],
          counts: { accept: 0, dispute: 0, uncertain: 0 },
        },
      ],
      rejected: [],
      unresolved: [],
      verdicts: [],
    };
    const payload = formatDebateReport(
      report as never,
      [
        {
          id: "run-c",
          agentId: "codex",
          modelExecution: { observedModelIds: [], verification: "verified" },
        },
        {
          id: "run-a",
          agentId: "claude",
          modelExecution: { observedModelIds: [], verification: "verified" },
        },
      ] as never,
    );
    const details = payload.files?.[0]?.attachment.toString("utf8") ?? "";
    expect(payload.content).toContain("## What happened");
    expect(payload.content).toContain("Agreed: 1");
    expect(payload.content).toContain("Different interpretations: 1");
    expect(payload.content).toContain(
      "Detailed evidence and reasoning are attached.",
    );
    expect(payload.files).toHaveLength(1);
    expect(details.indexOf("CONSENSUS")).toBeLessThan(
      details.indexOf("DISAGREEMENT"),
    );
    expect(details).toContain("UNSUPPORTED");
    expect(details).toContain("Use deterministic verdicts");
    expect(details).toContain("Codex: ACCEPT — Determinism is auditable");
    expect(details).toContain("Model says rejected");
    expect(details).toContain("Model says consensus");
    expect(details).toContain("Mechanically resolved evidence and provenance");
  });

  test("withholds debate analysis content when persisted run metadata is absent", () => {
    const payload = formatDebateReport({
      sessionId: "missing-run",
      status: "completed",
      classification: "DEBATE",
      projectId: "demo",
      rounds: [],
      verdicts: [],
      consensus: [],
      disagreements: [],
      rejected: [],
      unresolved: [],
      analyses: [
        {
          agentId: "codex",
          runId: "missing-run-id",
          status: "completed",
          content: "unverified debate analysis",
        },
      ],
    } as never);
    const details = payload.files?.[0]?.attachment.toString("utf8") ?? "";
    expect(details).not.toContain("unverified debate analysis");
    expect(details).toContain(
      "Content withheld because model verification is unverified",
    );
  });

  test("renders serialized initial debate analysis as readable claims", () => {
    const payload = formatDebateReport(
      {
        sessionId: "initial-analysis",
        status: "partial",
        classification: "DEBATE_NOT_ESTABLISHED",
        projectId: "demo",
        rounds: [],
        verdicts: [],
        consensus: [],
        disagreements: [],
        rejected: [],
        unresolved: [],
        analyses: [
          {
            agentId: "claude",
            runId: "run-claude",
            status: "completed",
            content:
              '{"phase":"initial","claims":[{"localId":"c1","text":"Codex uses a process sandbox.","material":true,"evidenceLocalIds":["e1"]}],"evidence":[{"localId":"e1","trackedPath":"src/agents/codex-adapter.ts"}]}',
          },
        ],
      } as never,
      [
        {
          id: "run-claude",
          agentId: "claude",
          modelExecution: { observedModelIds: [], verification: "unverified" },
        },
      ] as never,
    );
    const details = payload.files?.[0]?.attachment.toString("utf8") ?? "";
    expect(details).toContain("Initial analysis:");
    expect(details).toContain(
      "- [material] Codex uses a process sandbox. (evidence: e1)",
    );
    expect(details).toContain("Evidence cited: 1");
    expect(details).not.toContain('{"phase":"initial"');
  });

  test("renders each verdict's evidence and provenance deterministically", () => {
    const verdict = {
      claimId: "claim-a",
      classification: "CONSENSUS",
      support: "VERIFIED",
      finalStances: [],
      counts: { accept: 2, dispute: 0, uncertain: 0 },
      evidence: [
        {
          id: "evidence-b",
          status: "VERIFIED",
          trackedPath: "src/b.ts",
          origins: [],
        },
        {
          id: "evidence-a",
          status: "MISSING",
          trackedPath: "src/a.ts",
          origins: [],
        },
      ],
      provenance: [
        { agentId: "codex", agentRunId: "run-2", providerLocalId: "local-b" },
        { agentId: "claude", agentRunId: "run-1", providerLocalId: "local-a" },
      ],
    };
    const payload = formatDebateReport({
      sessionId: "session-provenance",
      status: "completed",
      classification: "DEBATE",
      projectId: "demo",
      rounds: [],
      analyses: [],
      board: { version: 1, claims: [], evidence: [] },
      verdicts: [verdict],
      consensus: [verdict],
      disagreements: [],
      rejected: [],
      unresolved: [],
    } as never);
    const details = payload.files?.[0]?.attachment.toString("utf8") ?? "";
    expect(details).toContain(
      "claim-a evidence: evidence-a MISSING src/a.ts; evidence-b VERIFIED src/b.ts",
    );
    expect(details).toContain(
      "claim-a provenance: claude/run-1/local-a; codex/run-2/local-b",
    );
  });

  test("splits every full claim into Discord-sized debate messages", () => {
    const verdicts = Array.from({ length: 20 }, (_, index) => ({
      claimId: `claim-${String(index)}`,
      classification: "CONSENSUS",
      support: "VERIFIED",
      finalStances: [],
      evidence: [],
      provenance: [],
      counts: { accept: 2, dispute: 0, uncertain: 0 },
    }));
    const payloads = formatDebateReportParts({
      sessionId: "long-summary",
      status: "completed",
      classification: "DEBATE",
      projectId: "demo",
      rounds: [],
      analyses: [],
      board: {
        version: 1,
        claims: verdicts.map((verdict) => ({
          id: verdict.claimId,
          text: "A long claim ".repeat(30),
          material: true,
          evidenceIds: [],
          origins: [],
        })),
        evidence: [],
      },
      verdicts,
      consensus: verdicts,
      disagreements: [],
      rejected: [],
      unresolved: [],
    } as never);

    expect(payloads.length).toBeGreaterThan(1);
    expect(payloads.every((payload) => payload.content.length <= 1_900)).toBe(
      true,
    );
    expect(payloads[0]?.files).toHaveLength(1);
    expect(
      payloads.slice(1).every((payload) => payload.files === undefined),
    ).toBe(true);
    expect(
      payloads
        .map((payload) => payload.content)
        .join("\n")
        .match(/A long claim/g) ?? [],
    ).toHaveLength(600);
  });

  test("uses an attachment when a report exceeds Discord's message limit", () => {
    const payload = formatAskReport({
      sessionId: "session-3",
      status: "completed",
      project: { id: "demo", name: "Demo", root: "unused" },
      results: [
        {
          agentId: "codex",
          status: "completed",
          response: "x".repeat(2_000),
          durationMs: 1,
          diagnostics: [],
          modelExecution: {
            requestedClass: "sol",
            requestedCliModelId: "gpt-sol",
            observedModelIds: ["gpt-sol"],
            verification: "verified",
          },
        },
      ],
    });
    expect(payload.content.length).toBeLessThanOrEqual(1_900);
    expect(payload.files).toHaveLength(1);
    expect(payload.files?.[0]?.attachment).toBeInstanceOf(Buffer);
  });
});
