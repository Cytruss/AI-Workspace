import type { AgentResult } from "../../agents/types.js";
import type { DebateReport } from "../../debate/types.js";
import type { AskReport } from "../../orchestrator/types.js";
import type { AgentRunRecord } from "../../storage/session-repository.js";

export interface DiscordAttachment {
  attachment: Buffer;
  name: string;
}

export interface DiscordPayload {
  content: string;
  files?: readonly DiscordAttachment[];
}

type ProviderModels = Readonly<Record<"codex" | "claude", { defaultModel?: string | undefined; selections: readonly ({ class: string } & Record<string, unknown>)[] }>>;

const LIMIT = 1_900;

function payload(report: string, name: string): DiscordPayload {
  if (report.length <= LIMIT) return { content: report };
  return {
    content: "The complete report is attached.",
    files: [{ attachment: Buffer.from(report, "utf8"), name }],
  };
}

function agentName(id: string): string {
  return id === "codex" ? "Codex" : id === "claude" ? "Claude" : id;
}

function modelLines(result: AgentResult): string[] {
  const execution = result.modelExecution;
  return [
    `Requested class: ${execution.requestedClass ?? "provider default"}`,
    ...(execution.requestedCliModelId === undefined
      ? []
      : [`Requested CLI model ID: ${execution.requestedCliModelId}`]),
    ...(execution.requestedEffort === undefined
      ? []
      : [`Requested effort: ${execution.requestedEffort}`]),
    `Observed model IDs: ${execution.observedModelIds.join(", ") || "none"}`,
    `Verification: ${execution.verification}`,
  ];
}

function safeFailure(result: AgentResult): string | undefined {
  if (result.status === "completed") return undefined;
  return "Safe diagnostics: provider execution did not complete; inspect persisted session diagnostics.";
}

export function formatModels(models: ProviderModels): DiscordPayload {
  const provider = (id: "codex" | "claude") => {
    const settings = models[id];
    if (settings.selections.length === 0)
      return `${agentName(id)}: provider default (no configured class)`;
    return `${agentName(id)}: ${settings.selections
      .map((selection) =>
        selection.class === settings.defaultModel
          ? `${selection.class} (default)`
          : selection.class,
      )
      .join(", ")}`;
  };
  return payload(
    [
      "Configured model classes",
      provider("codex"),
      provider("claude"),
      "Observation policy: exact IDs and literal prefixes are accepted.",
      "Observed-model verification is not entitlement verification.",
    ].join("\n"),
    "models.txt",
  );
}

export function formatAskReport(report: AskReport): DiscordPayload {
  const lines = [
    `Project: ${report.project.id}`,
    `Session: ${report.sessionId}`,
    `Status: ${report.status}`,
  ];
  for (const result of report.results) {
    lines.push("", `## ${agentName(result.agentId)}`, `Status: ${result.status}`);
    lines.push(...modelLines(result));
    if (result.modelExecution.verification !== "verified")
      lines.push("Verification marker: unverified");
    const diagnostic = safeFailure(result);
    if (diagnostic !== undefined) lines.push(diagnostic);
    if (result.response !== undefined) lines.push("", result.response);
  }
  return payload(lines.join("\n"), `ask-${report.sessionId}.txt`);
}

function verdictLines(label: string, verdicts: DebateReport["verdicts"]): string[] {
  const lines = [`## ${label}`];
  if (verdicts.length === 0) return [...lines, "None"];
  for (const verdict of verdicts) {
    const claimId = verdict.claimId as unknown as string;
    lines.push(
      `${claimId}: ${verdict.support}${
        verdict.support === "UNSUPPORTED" ? " (UNSUPPORTED)" : ""
      }`,
    );
  }
  return lines;
}

export function formatDebateReport(
  report: DebateReport,
  runs: readonly AgentRunRecord[] = [],
): DiscordPayload {
  const frozen = (["codex", "claude"] as const).map((agentId) => {
    const execution = runs.find((run) => run.agentId === agentId)?.modelExecution;
    return `${agentName(agentId)}: ${execution?.requestedClass ?? "provider default"}`;
  });
  const lines = [
    `Project: ${report.projectId}`,
    `Session: ${report.sessionId}`,
    `Status: ${report.status}`,
    `Classification: ${report.classification}`,
    "Frozen provider selections:",
    ...frozen,
    "",
    ...verdictLines("CONSENSUS", report.consensus),
    "",
    ...verdictLines("DISAGREEMENT", report.disagreements),
    "",
    ...verdictLines("REJECTED", report.rejected),
    "",
    ...verdictLines("UNRESOLVED", report.unresolved),
    "",
    "## Independent agent analyses",
    ...report.analyses.map((analysis) =>
      `${agentName(analysis.agentId)} (${analysis.status}): ${analysis.content ?? "No content"}`,
    ),
    "",
    "## Mechanically resolved evidence and provenance",
    ...(report.board?.evidence.map(
      (evidence) => `${evidence.id}: ${evidence.status}`,
    ) ?? ["No evidence board available"]),
  ];
  return payload(lines.join("\n"), `debate-${report.sessionId}.txt`);
}
