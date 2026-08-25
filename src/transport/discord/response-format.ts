import type { AgentResult } from "../../agents/types.js";
import type { DebateReport } from "../../debate/types.js";
import type { AskReport } from "../../orchestrator/types.js";
import type {
  AgentRunRecord,
  SessionRecord,
} from "../../storage/session-repository.js";
import type { RegisteredProject } from "../../projects/project-service.js";

export interface DiscordAttachment {
  attachment: Buffer;
  name: string;
}

export interface DiscordPayload {
  content: string;
  files?: readonly DiscordAttachment[];
}

type ProviderModels = Readonly<
  Record<
    "codex" | "claude",
    {
      defaultModel?: string | undefined;
      selections: readonly ({ class: string } & Record<string, unknown>)[];
    }
  >
>;

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
  if (
    result.status === "completed" &&
    result.modelExecution.verification === "verified"
  )
    return undefined;
  return "Safe diagnostics: provider execution did not complete verification; inspect persisted session diagnostics.";
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
          : settings.defaultModel === undefined
            ? `${selection.class} (provider default by omission)`
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
    lines.push(
      "",
      `## ${agentName(result.agentId)}`,
      `Status: ${result.status}`,
    );
    lines.push(...modelLines(result));
    if (result.modelExecution.verification !== "verified")
      lines.push("Verification marker: unverified");
    const diagnostic = safeFailure(result);
    if (diagnostic !== undefined) lines.push(diagnostic);
    if (
      result.response !== undefined &&
      result.modelExecution.verification === "verified"
    )
      lines.push("", result.response);
  }
  return payload(lines.join("\n"), `ask-${report.sessionId}.txt`);
}

export function formatStatusReport(
  session: SessionRecord,
  project: RegisteredProject,
  runs: readonly AgentRunRecord[],
): DiscordPayload {
  const lines = [
    `Project: ${project.id}`,
    `Session: ${session.id}`,
    `Status: ${session.status}`,
  ];
  for (const run of runs) {
    const result = {
      agentId: run.agentId,
      status: run.status === "running" ? "failed" : run.status,
      durationMs: run.durationMs,
      diagnostics: [],
      modelExecution: run.modelExecution,
    } as AgentResult;
    lines.push("", `## ${agentName(run.agentId)}`, `Status: ${run.status}`);
    lines.push(...modelLines(result));
    if (run.modelExecution.verification !== "verified")
      lines.push("Verification marker: unverified");
    const diagnostic = safeFailure(result);
    if (diagnostic !== undefined) lines.push(diagnostic);
  }
  return payload(lines.join("\n"), `status-${session.id}.txt`);
}

function verdictLines(
  label: string,
  verdicts: DebateReport["verdicts"],
): string[] {
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
    const execution = runs.find(
      (run) => run.agentId === agentId,
    )?.modelExecution;
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
    ...report.analyses.map((analysis) => {
      const verification = runs.find((run) => run.id === analysis.runId)
        ?.modelExecution.verification;
      return `${agentName(analysis.agentId)} (${analysis.status}): ${
        verification === "verified"
          ? (analysis.content ?? "No content")
          : "Content withheld because model verification is unverified"
      }`;
    }),
    "",
    "## Mechanically resolved evidence and provenance",
    ...[...report.verdicts]
      .sort((left, right) =>
        String(left.claimId).localeCompare(String(right.claimId)),
      )
      .flatMap((verdict) => {
        const claimId = String(verdict.claimId);
        const evidence =
          [...verdict.evidence]
            .sort((left, right) =>
              String(left.id).localeCompare(String(right.id)),
            )
            .map(
              (item) => `${String(item.id)} ${item.status} ${item.trackedPath}`,
            )
            .join("; ") || "none";
        const provenance =
          [...verdict.provenance]
            .sort(
              (left, right) =>
                left.agentId.localeCompare(right.agentId) ||
                left.agentRunId.localeCompare(right.agentRunId) ||
                left.providerLocalId.localeCompare(right.providerLocalId),
            )
            .map(
              (item) =>
                `${item.agentId}/${item.agentRunId}/${item.providerLocalId}`,
            )
            .join("; ") || "none";
        return [
          `${claimId} evidence: ${evidence}`,
          `${claimId} provenance: ${provenance}`,
        ];
      }),
  ];
  return payload(lines.join("\n"), `debate-${report.sessionId}.txt`);
}
