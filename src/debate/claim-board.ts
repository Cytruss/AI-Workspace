import type {
  CanonicalClaim,
  ClaimBoard,
  InitialPhaseResponse,
} from "../agents/structured-response.js";
import {
  canonicalizeEvidence,
  localEvidenceKey,
  type EvidenceDraftWithOrigin,
} from "./evidence-canonicalizer.js";

export class ClaimBoardError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ClaimBoardError";
  }
}

export interface InitialContribution {
  agentId: string;
  runId: string;
  response: InitialPhaseResponse;
}

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function compareOrigin(
  left: { agentId: string; runId: string; localId: string },
  right: { agentId: string; runId: string; localId: string },
): number {
  return (
    left.agentId.localeCompare(right.agentId) ||
    left.runId.localeCompare(right.runId) ||
    left.localId.localeCompare(right.localId)
  );
}

/** Creates the only v0.1 claim board. Provider-local IDs never escape this function. */
export async function createInitialClaimBoard(
  root: string,
  contributions: readonly InitialContribution[],
): Promise<ClaimBoard> {
  const localClaims = new Set<string>();
  const evidenceDrafts: EvidenceDraftWithOrigin[] = [];
  const claims: Array<{
    agentId: string;
    runId: string;
    localId: string;
    text: string;
    material: boolean;
    evidenceLocalIds: readonly string[];
  }> = [];
  for (const contribution of contributions) {
    for (const evidence of contribution.response.evidence) {
      evidenceDrafts.push({
        agentId: contribution.agentId,
        runId: contribution.runId,
        draft: evidence,
      });
    }
    for (const claim of contribution.response.claims) {
      const key = `${contribution.agentId}\u0000${contribution.runId}\u0000${claim.localId}`;
      if (localClaims.has(key))
        throw new ClaimBoardError(
          "DUPLICATE_LOCAL_CLAIM",
          `Duplicate provider-local claim ID: ${claim.localId}`,
        );
      localClaims.add(key);
      claims.push({
        agentId: contribution.agentId,
        runId: contribution.runId,
        localId: claim.localId,
        text: normalize(claim.text),
        material: claim.material,
        evidenceLocalIds: claim.evidenceLocalIds,
      });
    }
  }
  const canonicalEvidence = await canonicalizeEvidence(root, evidenceDrafts);
  claims.sort(
    (left, right) =>
      left.text.localeCompare(right.text) ||
      Number(left.material) - Number(right.material) ||
      compareOrigin(left, right),
  );
  const byClaim = new Map<string, CanonicalClaim>();
  for (const claim of claims) {
    const key = `${claim.text}\u0000${claim.material ? "1" : "0"}`;
    let canonical = byClaim.get(key);
    if (canonical === undefined) {
      const id = `claim-${String(byClaim.size + 1).padStart(4, "0")}`;
      canonical = {
        id: id as CanonicalClaim["id"],
        text: claim.text,
        material: claim.material,
        evidenceIds: [],
        origins: [],
      };
      byClaim.set(key, canonical);
    }
    const links = claim.evidenceLocalIds.map((localId) =>
      canonicalEvidence.localToCanonical.get(
        localEvidenceKey(claim.agentId, claim.runId, localId),
      ),
    );
    if (links.some((id) => id === undefined)) {
      throw new ClaimBoardError(
        "DANGLING_EVIDENCE",
        `Claim ${claim.localId} references undeclared evidence`,
      );
    }
    canonical.evidenceIds = [
      ...new Set([...canonical.evidenceIds, ...(links as string[])]),
    ].sort() as CanonicalClaim["evidenceIds"];
    canonical.origins.push({
      agentId: claim.agentId,
      agentRunId: claim.runId,
      providerLocalId: claim.localId,
    });
  }
  return {
    version: 1,
    claims: [...byClaim.values()].map((claim) => ({
      ...claim,
      origins: claim.origins.sort(
        (left, right) =>
          left.agentId.localeCompare(right.agentId) ||
          left.agentRunId.localeCompare(right.agentRunId) ||
          left.providerLocalId.localeCompare(right.providerLocalId),
      ),
    })),
    evidence: [...canonicalEvidence.evidence],
  };
}
