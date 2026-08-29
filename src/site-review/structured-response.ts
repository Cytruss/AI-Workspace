import { z } from "zod";

const IdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const ObservationIdSchema = z.string().regex(/^obs-[a-z0-9-]{1,60}$/);
const FindingIdSchema = z.string().regex(/^finding-[a-z0-9-]{1,56}$/);
const RecommendationIdSchema = z
  .string()
  .regex(/^recommendation-[a-z0-9-]{1,50}$/);

const ObservationSchema = z.object({
  id: ObservationIdSchema,
  url: z.url().max(2_048),
  title: z.string().max(500),
  viewport: z.enum(["desktop", "mobile"]),
  behavior: z.string().min(1).max(4_000),
});

const FindingSchema = z.object({
  id: FindingIdSchema,
  category: z.enum(["purpose", "functional", "visual", "accessibility"]),
  statement: z.string().min(1).max(2_000),
  observationIds: z.array(ObservationIdSchema).min(1).max(10),
});

const UncertaintySchema = z.object({
  id: IdSchema,
  statement: z.string().min(1).max(2_000),
  observationIds: z.array(ObservationIdSchema).max(10),
});

const RecommendationSchema = z.object({
  id: RecommendationIdSchema,
  statement: z.string().min(1).max(2_000),
  observationIds: z.array(ObservationIdSchema).max(10),
});

function hasDuplicates(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

export const SiteReviewAgentResponseSchema = z
  .object({
    phase: z.literal("site-review"),
    summary: z.string().min(1).max(4_000),
    observations: z.array(ObservationSchema).max(20),
    findings: z.array(FindingSchema).max(50),
    uncertainties: z.array(UncertaintySchema).max(30),
    recommendations: z.array(RecommendationSchema).max(30),
  })
  .superRefine((response, context) => {
    const observationIds = response.observations.map(
      (observation) => observation.id,
    );
    if (hasDuplicates(observationIds)) {
      context.addIssue({
        code: "custom",
        message: "Observation IDs must be unique",
        path: ["observations"],
      });
      return;
    }
    const knownObservations = new Set(observationIds);
    const checkReferences = (
      items: readonly { observationIds: readonly string[] }[],
      field: "findings" | "uncertainties" | "recommendations",
    ) => {
      items.forEach((item, index) => {
        if (hasDuplicates(item.observationIds)) {
          context.addIssue({
            code: "custom",
            message: "Observation references must be unique",
            path: [field, index, "observationIds"],
          });
        }
        item.observationIds.forEach((id, referenceIndex) => {
          if (!knownObservations.has(id)) {
            context.addIssue({
              code: "custom",
              message: `Finding references unknown observation: ${id}`,
              path: [field, index, "observationIds", referenceIndex],
            });
          }
        });
      });
    };
    checkReferences(response.findings, "findings");
    checkReferences(response.uncertainties, "uncertainties");
    checkReferences(response.recommendations, "recommendations");
  });

export type SiteReviewAgentResponse = z.infer<
  typeof SiteReviewAgentResponseSchema
>;
