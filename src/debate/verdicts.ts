import {
  VerdictSchema,
  type CanonicalEvidence,
  type StanceRecord,
  type Verdict,
} from "../agents/structured-response.js";
import type { VerdictClassification, VerdictInput } from "./types.js";

export type FinalStance = "ACCEPT" | "DISPUTE" | "UNCERTAIN";

/** Pure, fail-closed final-position classification. Earlier round stances are never inputs. */
export function deriveVerdict(
  values: readonly FinalStance[],
): VerdictClassification {
  if (values.length !== 2 || values.some((value) => value === "UNCERTAIN")) {
    return "UNRESOLVED";
  }
  const [first, second] = values;
  if (first === "ACCEPT" && second === "ACCEPT") return "CONSENSUS";
  if (first === "DISPUTE" && second === "DISPUTE") return "REJECTED";
  if (
    (first === "ACCEPT" && second === "DISPUTE") ||
    (first === "DISPUTE" && second === "ACCEPT")
  ) {
    return "DISAGREEMENT";
  }
  return "UNRESOLVED";
}

function counts(stances: readonly StanceRecord[]) {
  return stances.reduce(
    (result, stance) => {
      if (stance.value === "ACCEPT") result.accept += 1;
      if (stance.value === "DISPUTE") result.dispute += 1;
      if (stance.value === "UNCERTAIN") result.uncertain += 1;
      return result;
    },
    { accept: 0, dispute: 0, uncertain: 0 },
  );
}

export function deriveStructuredVerdict(input: VerdictInput): Verdict {
  const finalStances = [...input.finalStances].sort(
    (left, right) =>
      left.agentId.localeCompare(right.agentId) ||
      left.agentRunId.localeCompare(right.agentRunId),
  );
  const evidence = input.evidence
    .filter(
      (item) =>
        input.claim.evidenceIds.includes(item.id) ||
        finalStances.some((stance) => stance.evidenceIds.includes(item.id)),
    )
    .sort((left, right) => left.id.localeCompare(right.id));
  const classification = deriveVerdict(
    finalStances.map((stance) => stance.value),
  );
  return VerdictSchema.parse({
    claimId: input.claim.id,
    classification,
    support:
      classification === "CONSENSUS" &&
      !evidence.some((item) => item.status === "VERIFIED")
        ? "UNSUPPORTED"
        : "VERIFIED",
    finalStances,
    evidence,
    provenance: [...input.claim.origins].sort(
      (left, right) =>
        left.agentId.localeCompare(right.agentId) ||
        left.agentRunId.localeCompare(right.agentRunId) ||
        left.providerLocalId.localeCompare(right.providerLocalId),
    ),
    counts: counts(finalStances),
  });
}

export function deriveVerdicts(
  board: {
    claims: readonly import("../agents/structured-response.js").CanonicalClaim[];
    evidence: readonly CanonicalEvidence[];
  },
  finalStances: readonly StanceRecord[],
): readonly Verdict[] {
  return Object.freeze(
    [...board.claims]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((claim) =>
        deriveStructuredVerdict({
          claim,
          evidence: board.evidence,
          finalStances: finalStances.filter(
            (stance) => stance.claimId === claim.id,
          ),
        }),
      ),
  );
}
