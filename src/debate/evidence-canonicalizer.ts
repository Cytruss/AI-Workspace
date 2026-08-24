import type {
  CanonicalEvidence,
  EvidenceOrigin,
  ProviderEvidenceDraft,
} from "../agents/structured-response.js";
import { resolveEvidence } from "./evidence-resolver.js";

export interface EvidenceDraftWithOrigin {
  agentId: string;
  runId: string;
  draft: ProviderEvidenceDraft;
}

export interface CanonicalEvidenceResult {
  evidence: readonly CanonicalEvidence[];
  localToCanonical: ReadonlyMap<string, string>;
}

function scoped(origin: EvidenceDraftWithOrigin): string {
  return `${origin.agentId}\u0000${origin.runId}\u0000${origin.draft.localId}`;
}

function origin(item: EvidenceDraftWithOrigin): EvidenceOrigin {
  return {
    agentId: item.agentId,
    agentRunId: item.runId,
    providerLocalId: item.draft.localId,
  };
}

function tuple(item: Awaited<ReturnType<typeof resolveEvidence>>): string {
  return [
    item.trackedPath,
    item.lineStart ?? "",
    item.lineEnd ?? "",
    item.expectedHash ?? "",
  ].join("\u0000");
}

/** Canonical evidence IDs are deterministic and provider IDs remain run-scoped. */
export async function canonicalizeEvidence(
  root: string,
  drafts: readonly EvidenceDraftWithOrigin[],
): Promise<CanonicalEvidenceResult> {
  const seen = new Set<string>();
  for (const item of drafts) {
    const key = scoped(item);
    if (seen.has(key))
      throw new Error(
        `Duplicate provider-local evidence ID: ${item.draft.localId}`,
      );
    seen.add(key);
  }
  const resolved = await Promise.all(
    drafts.map(async (item) => ({
      item,
      evidence: await resolveEvidence(root, item.draft),
    })),
  );
  resolved.sort((left, right) => {
    const a = tuple(left.evidence);
    const b = tuple(right.evidence);
    return (
      a.localeCompare(b) ||
      left.item.agentId.localeCompare(right.item.agentId) ||
      left.item.runId.localeCompare(right.item.runId) ||
      left.item.draft.localId.localeCompare(right.item.draft.localId)
    );
  });
  const byTuple = new Map<string, CanonicalEvidence>();
  const localToCanonical = new Map<string, string>();
  for (const { item, evidence } of resolved) {
    const key = tuple(evidence);
    let canonical = byTuple.get(key);
    if (canonical === undefined) {
      const id = `evidence-${String(byTuple.size + 1).padStart(4, "0")}`;
      canonical = {
        id: id as CanonicalEvidence["id"],
        status: evidence.status,
        trackedPath: evidence.trackedPath,
        ...(evidence.lineStart === undefined
          ? {}
          : { lineStart: evidence.lineStart, lineEnd: evidence.lineEnd }),
        ...(evidence.expectedHash === undefined
          ? {}
          : { expectedHash: evidence.expectedHash }),
        ...(evidence.resolvedHash === undefined
          ? {}
          : { resolvedHash: evidence.resolvedHash }),
        origins: [],
      };
      byTuple.set(key, canonical);
    }
    canonical.origins.push(origin(item));
    localToCanonical.set(scoped(item), canonical.id);
  }
  return {
    evidence: Object.freeze(
      [...byTuple.values()].map((item) => ({
        ...item,
        origins: [...item.origins].sort(
          (a, b) =>
            a.agentId.localeCompare(b.agentId) ||
            a.agentRunId.localeCompare(b.agentRunId) ||
            a.providerLocalId.localeCompare(b.providerLocalId),
        ),
      })),
    ),
    localToCanonical,
  };
}

export function localEvidenceKey(
  agentId: string,
  runId: string,
  localId: string,
): string {
  return `${agentId}\u0000${runId}\u0000${localId}`;
}
