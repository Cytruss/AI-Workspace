import { z } from "zod";

const MAX_ID_LENGTH = 200;
const MAX_TEXT_LENGTH = 32_768;

function issue(
  context: z.core.$RefinementCtx,
  message: string,
  path: PropertyKey[] = [],
): void {
  context.addIssue({ code: "custom", message, path });
}

function hasDuplicates(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

export const ResolvedModelSelectionSchema = z
  .object({
    class: z.string().min(1).max(32),
    cliModelId: z.string().min(1).max(200),
    requestedEffort: z.string().min(1).max(32).optional(),
  })
  .readonly();

export const ModelExecutionSchema = z
  .object({
    requestedClass: z.string().min(1).max(32).optional(),
    requestedCliModelId: z.string().min(1).max(200).optional(),
    requestedEffort: z.string().min(1).max(32).optional(),
    observedModelIds: z.array(z.string().min(1).max(200)).max(25).readonly(),
    verification: z.enum(["verified", "unverified"]),
  })
  .superRefine((execution, context) => {
    const requested = execution.requestedClass !== undefined;
    if (requested !== (execution.requestedCliModelId !== undefined)) {
      issue(context, "Requested model class and CLI ID must be paired");
    }
    if (!requested && execution.requestedEffort !== undefined) {
      issue(context, "Requested effort requires an explicit model selection");
    }
    if (!requested && execution.verification === "verified") {
      issue(context, "Provider-default model execution cannot be verified");
    }
    const observations = execution.observedModelIds;
    if (
      hasDuplicates(observations) ||
      observations.some(
        (value, index) => index > 0 && value < (observations[index - 1] ?? ""),
      )
    ) {
      issue(context, "Observed model IDs must be sorted and unique");
    }
  })
  .readonly();

export type ResolvedModelSelection = z.infer<
  typeof ResolvedModelSelectionSchema
>;
export type ModelExecution = z.infer<typeof ModelExecutionSchema>;

const LocalIdSchema = z.string().min(1).max(MAX_ID_LENGTH);
export const ProviderClaimLocalIdSchema = LocalIdSchema.refine(
  (value) => !/^claim-\d{4}$/.test(value),
  "Provider claim IDs cannot use the canonical claim namespace",
).brand<"ProviderClaimLocalId">();
export const ProviderEvidenceLocalIdSchema = LocalIdSchema.refine(
  (value) => !/^evidence-\d{4}$/.test(value),
  "Provider evidence IDs cannot use the canonical evidence namespace",
).brand<"ProviderEvidenceLocalId">();
export const CanonicalClaimIdSchema = z
  .string()
  .regex(/^claim-\d{4}$/)
  .brand<"CanonicalClaimId">();
export const CanonicalEvidenceIdSchema = z
  .string()
  .regex(/^evidence-\d{4}$/)
  .brand<"CanonicalEvidenceId">();

export type ProviderClaimLocalId = z.infer<typeof ProviderClaimLocalIdSchema>;
export type ProviderEvidenceLocalId = z.infer<
  typeof ProviderEvidenceLocalIdSchema
>;
export type CanonicalClaimId = z.infer<typeof CanonicalClaimIdSchema>;
export type CanonicalEvidenceId = z.infer<typeof CanonicalEvidenceIdSchema>;

export const ProviderEvidenceDraftSchema = z
  .object({
    localId: ProviderEvidenceLocalIdSchema,
    trackedPath: z.string().min(1).max(4_096),
    lineStart: z.number().int().positive().optional(),
    lineEnd: z.number().int().positive().optional(),
    contentHash: z.string().min(1).max(200).optional(),
  })
  .loose()
  .superRefine((evidence, context) => {
    if (
      (evidence.lineStart === undefined) !==
      (evidence.lineEnd === undefined)
    ) {
      issue(context, "Evidence line start and end must be supplied together");
    } else if (
      evidence.lineStart !== undefined &&
      evidence.lineEnd !== undefined &&
      evidence.lineEnd < evidence.lineStart
    ) {
      issue(context, "Evidence line end cannot precede line start");
    }
  });

export const InitialClaimDraftSchema = z
  .object({
    localId: ProviderClaimLocalIdSchema,
    text: z.string().min(1).max(MAX_TEXT_LENGTH),
    material: z.boolean(),
    evidenceLocalIds: z.array(ProviderEvidenceLocalIdSchema).max(200),
  })
  .loose();

export const InitialPhaseResponseSchema = z
  .object({
    phase: z.literal("initial"),
    claims: z.array(InitialClaimDraftSchema).max(200),
    evidence: z.array(ProviderEvidenceDraftSchema).max(200),
    stances: z.never().optional(),
    newEvidence: z.never().optional(),
  })
  .loose()
  .superRefine((response, context) => {
    const claimIds = response.claims.map((claim) => claim.localId);
    const evidenceIds = response.evidence.map((entry) => entry.localId);
    if (hasDuplicates(claimIds)) {
      issue(context, "Provider claim local IDs must be unique", ["claims"]);
    }
    if (hasDuplicates(evidenceIds)) {
      issue(context, "Provider evidence local IDs must be unique", [
        "evidence",
      ]);
    }
    const declared = new Set(evidenceIds);
    response.claims.forEach((claim, index) => {
      if (hasDuplicates(claim.evidenceLocalIds)) {
        issue(context, "Claim evidence links must be unique", [
          "claims",
          index,
          "evidenceLocalIds",
        ]);
      }
      for (const localId of claim.evidenceLocalIds) {
        if (!declared.has(localId)) {
          issue(context, `Unknown provider evidence local ID: ${localId}`, [
            "claims",
            index,
            "evidenceLocalIds",
          ]);
        }
      }
    });
  });

export const ProviderStanceDraftSchema = z
  .object({
    claimId: CanonicalClaimIdSchema,
    value: z.enum(["ACCEPT", "DISPUTE", "UNCERTAIN"]),
    reasoning: z.string().min(1).max(MAX_TEXT_LENGTH),
    existingEvidenceIds: z.array(CanonicalEvidenceIdSchema).max(200),
    newEvidenceLocalIds: z.array(ProviderEvidenceLocalIdSchema).max(200),
  })
  .loose();

function laterPhaseSchema<TPhase extends "cross-examination" | "final">(
  phase: TPhase,
  expectedClaimIds?: readonly string[],
  existingEvidenceIds?: readonly string[],
) {
  const expectedClaims =
    expectedClaimIds === undefined
      ? undefined
      : new Set(z.array(CanonicalClaimIdSchema).parse(expectedClaimIds));
  const existingEvidence =
    existingEvidenceIds === undefined
      ? undefined
      : new Set(z.array(CanonicalEvidenceIdSchema).parse(existingEvidenceIds));
  if (
    expectedClaims !== undefined &&
    expectedClaims.size !== expectedClaimIds?.length
  ) {
    throw new Error("Expected canonical claim IDs must be unique");
  }
  if (
    existingEvidence !== undefined &&
    existingEvidence.size !== existingEvidenceIds?.length
  ) {
    throw new Error("Expected canonical evidence IDs must be unique");
  }

  return z
    .object({
      phase: z.literal(phase),
      stances: z.array(ProviderStanceDraftSchema).max(200),
      newEvidence: z.array(ProviderEvidenceDraftSchema).max(200),
      claims: z.never().optional(),
      evidence: z.never().optional(),
    })
    .loose()
    .superRefine((response, context) => {
      const claimIds = response.stances.map((item) => item.claimId);
      if (hasDuplicates(claimIds)) {
        issue(context, "Canonical claim stances must be unique", ["stances"]);
      }
      if (
        expectedClaims !== undefined &&
        (claimIds.length !== expectedClaims.size ||
          claimIds.some((id) => !expectedClaims.has(id)))
      ) {
        issue(context, "Response must cover exactly the supplied claim set", [
          "stances",
        ]);
      }

      const localIds = response.newEvidence.map((entry) => entry.localId);
      if (hasDuplicates(localIds)) {
        issue(context, "New evidence local IDs must be unique", [
          "newEvidence",
        ]);
      }
      const declaredLocalIds = new Set(localIds);
      response.stances.forEach((item, index) => {
        if (hasDuplicates(item.existingEvidenceIds)) {
          issue(context, "Existing canonical evidence links must be unique", [
            "stances",
            index,
            "existingEvidenceIds",
          ]);
        }
        if (hasDuplicates(item.newEvidenceLocalIds)) {
          issue(context, "New evidence links must be unique", [
            "stances",
            index,
            "newEvidenceLocalIds",
          ]);
        }
        for (const evidenceId of item.existingEvidenceIds) {
          if (
            existingEvidence !== undefined &&
            !existingEvidence.has(evidenceId)
          ) {
            issue(context, `Unknown canonical evidence ID: ${evidenceId}`, [
              "stances",
              index,
              "existingEvidenceIds",
            ]);
          }
        }
        for (const localId of item.newEvidenceLocalIds) {
          if (!declaredLocalIds.has(localId)) {
            issue(context, `Unknown new evidence local ID: ${localId}`, [
              "stances",
              index,
              "newEvidenceLocalIds",
            ]);
          }
        }
      });
    });
}

export const CrossExaminationPhaseResponseSchema =
  laterPhaseSchema("cross-examination");
export const FinalPhaseResponseSchema = laterPhaseSchema("final");

export function createCrossExaminationPhaseResponseSchema(
  reviewClaimIds: readonly string[],
  existingEvidenceIds: readonly string[],
) {
  return laterPhaseSchema(
    "cross-examination",
    reviewClaimIds,
    existingEvidenceIds,
  );
}

export function createFinalPhaseResponseSchema(
  boardClaimIds: readonly string[],
  existingEvidenceIds: readonly string[],
) {
  return laterPhaseSchema("final", boardClaimIds, existingEvidenceIds);
}

export const ProviderPhaseResponseSchema = z.union([
  InitialPhaseResponseSchema,
  CrossExaminationPhaseResponseSchema,
  FinalPhaseResponseSchema,
]);

export type ProviderEvidenceDraft = z.infer<typeof ProviderEvidenceDraftSchema>;
export type InitialClaimDraft = z.infer<typeof InitialClaimDraftSchema>;
export type InitialPhaseResponse = z.infer<typeof InitialPhaseResponseSchema>;
export type ProviderStanceDraft = z.infer<typeof ProviderStanceDraftSchema>;
export type CrossExaminationPhaseResponse = z.infer<
  typeof CrossExaminationPhaseResponseSchema
>;
export type FinalPhaseResponse = z.infer<typeof FinalPhaseResponseSchema>;
export type ProviderPhaseResponse = z.infer<typeof ProviderPhaseResponseSchema>;

export const ClaimOriginSchema = z.object({
  agentId: z.string().min(1).max(MAX_ID_LENGTH),
  agentRunId: z.string().min(1).max(MAX_ID_LENGTH),
  providerLocalId: z.string().min(1).max(MAX_ID_LENGTH),
});
export const EvidenceOriginSchema = ClaimOriginSchema;

export const CanonicalEvidenceSchema = z
  .object({
    id: CanonicalEvidenceIdSchema,
    status: z.enum(["VERIFIED", "INVALID", "MISSING"]),
    trackedPath: z.string().min(1).max(4_096),
    lineStart: z.number().int().positive().optional(),
    lineEnd: z.number().int().positive().optional(),
    expectedHash: z.string().min(1).max(200).optional(),
    resolvedHash: z.string().min(1).max(200).optional(),
    origins: z.array(EvidenceOriginSchema).min(1).max(200),
  })
  .superRefine((entry, context) => {
    if ((entry.lineStart === undefined) !== (entry.lineEnd === undefined)) {
      issue(context, "Canonical evidence line range must be complete");
    } else if (
      entry.lineStart !== undefined &&
      entry.lineEnd !== undefined &&
      entry.lineEnd < entry.lineStart
    ) {
      issue(context, "Canonical evidence line range is invalid");
    }
  });

export const CanonicalClaimSchema = z.object({
  id: CanonicalClaimIdSchema,
  text: z.string().min(1).max(MAX_TEXT_LENGTH),
  material: z.boolean(),
  evidenceIds: z.array(CanonicalEvidenceIdSchema).max(200),
  origins: z.array(ClaimOriginSchema).min(1).max(200),
});

export const CanonicalStanceSchema = z.object({
  claimId: CanonicalClaimIdSchema,
  value: z.enum(["ACCEPT", "DISPUTE", "UNCERTAIN"]),
  reasoning: z.string().min(1).max(MAX_TEXT_LENGTH),
  evidenceIds: z.array(CanonicalEvidenceIdSchema).max(200),
});

export const ClaimBoardSchema = z
  .object({
    version: z.number().int().nonnegative(),
    claims: z.array(CanonicalClaimSchema).max(200),
    evidence: z.array(CanonicalEvidenceSchema).max(200),
  })
  .superRefine((board, context) => {
    const claimIds = board.claims.map((claim) => claim.id);
    const evidenceIds = board.evidence.map((entry) => entry.id);
    if (hasDuplicates(claimIds))
      issue(context, "Canonical claim IDs must be unique");
    if (hasDuplicates(evidenceIds))
      issue(context, "Canonical evidence IDs must be unique");
    const availableEvidence = new Set(evidenceIds);
    for (const claim of board.claims) {
      if (
        hasDuplicates(claim.evidenceIds) ||
        claim.evidenceIds.some((id) => !availableEvidence.has(id))
      ) {
        issue(context, `Claim ${claim.id} has invalid evidence links`);
      }
    }
  });

export const FinalPositionSchema = z.object({
  agentId: z.string().min(1).max(MAX_ID_LENGTH),
  agentRunId: z.string().min(1).max(MAX_ID_LENGTH),
  roundId: z.string().min(1).max(MAX_ID_LENGTH),
  stances: z.array(CanonicalStanceSchema).max(200),
});

export const StanceRecordSchema = CanonicalStanceSchema.extend({
  agentId: z.string().min(1).max(MAX_ID_LENGTH),
  agentRunId: z.string().min(1).max(MAX_ID_LENGTH),
  roundId: z.string().min(1).max(MAX_ID_LENGTH),
});

export const VerdictCountsSchema = z.object({
  accept: z.number().int().nonnegative(),
  dispute: z.number().int().nonnegative(),
  uncertain: z.number().int().nonnegative(),
});

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

export const VerdictSchema = z
  .object({
    claimId: CanonicalClaimIdSchema,
    classification: z.enum([
      "CONSENSUS",
      "DISAGREEMENT",
      "REJECTED",
      "UNRESOLVED",
    ]),
    support: z.enum(["VERIFIED", "UNSUPPORTED"]),
    finalStances: z.array(StanceRecordSchema).max(2),
    evidence: z.array(CanonicalEvidenceSchema).max(200),
    provenance: z.array(ClaimOriginSchema).max(200),
    counts: VerdictCountsSchema,
  })
  .transform(deepFreeze);

export type ClaimOrigin = z.infer<typeof ClaimOriginSchema>;
export type EvidenceOrigin = z.infer<typeof EvidenceOriginSchema>;
export type CanonicalClaim = z.infer<typeof CanonicalClaimSchema>;
export type CanonicalEvidence = z.infer<typeof CanonicalEvidenceSchema>;
export type CanonicalStance = z.infer<typeof CanonicalStanceSchema>;
export type ClaimBoard = z.infer<typeof ClaimBoardSchema>;
export type FinalPosition = z.infer<typeof FinalPositionSchema>;
export type StanceRecord = z.infer<typeof StanceRecordSchema>;
export type VerdictCounts = z.infer<typeof VerdictCountsSchema>;
export type Verdict = Readonly<z.infer<typeof VerdictSchema>>;
