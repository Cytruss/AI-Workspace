import { canonicalJson } from "../storage/session-repository.js";
import type {
  ClaimBoard,
  StanceRecord,
} from "../agents/structured-response.js";
import type { DebateConfig } from "../config/schema.js";
import type { DeliberationContext } from "./types.js";

export class DebateContextLimitError extends Error {
  readonly code = "DEBATE_CONTEXT_LIMIT";
  constructor(message: string) {
    super(message);
    this.name = "DebateContextLimitError";
  }
}

export function carryStanceEvidence(
  board: ClaimBoard,
  stances: readonly StanceRecord[],
): ClaimBoard {
  const available = new Set(board.evidence.map((item) => item.id));
  const evidenceByClaim = new Map<string, Set<string>>();
  for (const stance of stances) {
    const evidence = evidenceByClaim.get(stance.claimId) ?? new Set<string>();
    for (const evidenceId of stance.evidenceIds) {
      if (!available.has(evidenceId))
        throw new Error(
          `Stance references unavailable evidence: ${evidenceId}`,
        );
      evidence.add(evidenceId);
    }
    evidenceByClaim.set(stance.claimId, evidence);
  }
  return {
    ...board,
    claims: board.claims.map((claim) => ({
      ...claim,
      evidenceIds: [
        ...new Set([
          ...claim.evidenceIds,
          ...(evidenceByClaim.get(claim.id) ?? []),
        ]),
      ].sort() as typeof claim.evidenceIds,
    })),
  };
}

export function buildDeliberationContext(
  config: DebateConfig,
  input: Omit<DeliberationContext, "board"> & { board: ClaimBoard },
): DeliberationContext {
  const wanted = new Set(input.reviewClaimIds);
  const claims = input.board.claims.filter((claim) => wanted.has(claim.id));
  if (claims.length !== wanted.size || claims.length > config.maxBoardClaims) {
    throw new DebateContextLimitError(
      "Claim board cannot be represented within its configured limit",
    );
  }
  const evidenceIds = new Set(claims.flatMap((claim) => claim.evidenceIds));
  const board: ClaimBoard = {
    version: input.board.version + 1,
    claims,
    evidence: input.board.evidence.filter((evidence) =>
      evidenceIds.has(evidence.id),
    ),
  };
  const context: DeliberationContext = {
    ...input,
    board,
    reviewClaimIds: [...input.reviewClaimIds].sort(),
  };
  if (
    Buffer.byteLength(canonicalJson(context), "utf8") > config.maxBoardBytes
  ) {
    throw new DebateContextLimitError(
      "Claim board exceeds its configured byte limit",
    );
  }
  return Object.freeze(context);
}
