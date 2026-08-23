import { isAbsolute } from "node:path";
import { z } from "zod";

export const ProjectConfigSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
  name: z.string().min(1).max(100),
  root: z.string().min(1),
});

const ModelClassSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/);
const ObservedModelTokenSchema = z.string().min(1).max(200);

export const AcceptedObservedModelsSchema = z
  .object({
    exactIds: z.array(ObservedModelTokenSchema).max(25).default([]),
    literalPrefixes: z.array(ObservedModelTokenSchema).max(8).default([]),
  })
  .superRefine((policy, context) => {
    if (policy.exactIds.length + policy.literalPrefixes.length === 0) {
      context.addIssue({
        code: "custom",
        message: "At least one accepted observed model is required",
      });
    }
    if (new Set(policy.exactIds).size !== policy.exactIds.length) {
      context.addIssue({
        code: "custom",
        message: "Exact observed model IDs must be unique",
      });
    }
    if (
      new Set(policy.literalPrefixes).size !== policy.literalPrefixes.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Observed model prefixes must be unique",
      });
    }
  });

export const ModelSelectionSchema = z.object({
  class: ModelClassSchema,
  cliModelId: z.string().min(1).max(200),
  requestedEffort: z.string().min(1).max(32).optional(),
  acceptedObservedModels: AcceptedObservedModelsSchema,
});

export const ModelSelectionsSchema = z
  .object({
    defaultModel: ModelClassSchema.optional(),
    selections: z.array(ModelSelectionSchema).max(25).default([]),
  })
  .superRefine((models, context) => {
    const classes = models.selections.map((selection) => selection.class);
    if (new Set(classes).size !== classes.length) {
      context.addIssue({
        code: "custom",
        message: "Model classes must be unique",
      });
    }
    if (
      models.defaultModel !== undefined &&
      !classes.includes(models.defaultModel)
    ) {
      context.addIssue({
        code: "custom",
        message: "Default model must resolve to a configured selection",
      });
    }
  });

export const AgentConfigSchema = z.object({
  command: z.string().min(1),
  timeoutMs: z.number().int().min(1_000).max(3_600_000).default(300_000),
  maxOutputBytes: z
    .number()
    .int()
    .min(1_024)
    .max(10_485_760)
    .default(1_048_576),
  models: ModelSelectionsSchema.default({ selections: [] }),
});

export const DebateConfigSchema = z.object({
  maxRounds: z.number().int().min(1).max(5).default(3),
  maxBoardClaims: z.number().int().min(2).max(200).default(40),
  maxBoardBytes: z.number().int().min(4_096).max(262_144).default(65_536),
});

export const AppConfigSchema = z
  .object({
    version: z.literal(1),
    mode: z.literal("observe"),
    discord: z.object({
      applicationId: z.string().min(1),
      guildIds: z.array(z.string().min(1)).min(1),
      allowedUserIds: z.array(z.string().min(1)).min(1),
      tokenEnv: z.literal("AI_WORKSPACE_DISCORD_TOKEN"),
    }),
    projects: z.array(ProjectConfigSchema).min(1),
    agents: z.object({
      codex: AgentConfigSchema.default({
        command: "codex",
        timeoutMs: 300_000,
        maxOutputBytes: 1_048_576,
        models: { selections: [] },
      }),
      claude: AgentConfigSchema.default({
        command: "claude",
        timeoutMs: 300_000,
        maxOutputBytes: 1_048_576,
        models: { selections: [] },
      }),
    }),
    debate: DebateConfigSchema.default({
      maxRounds: 3,
      maxBoardClaims: 40,
      maxBoardBytes: 65_536,
    }),
    concurrency: z.number().int().min(1).max(8).default(2),
    logging: z
      .object({
        level: z.enum(["error", "warn", "info", "debug"]).default("info"),
      })
      .default({ level: "info" }),
    retention: z
      .object({ mode: z.literal("manual").default("manual") })
      .default({ mode: "manual" }),
  })
  .superRefine((config, context) => {
    const projectIds = config.projects.map((project) => project.id);
    if (new Set(projectIds).size !== projectIds.length) {
      context.addIssue({
        code: "custom",
        message: "Project IDs must be unique",
      });
    }
    config.projects.forEach((project, index) => {
      if (!isAbsolute(project.root)) {
        context.addIssue({
          code: "custom",
          message: "Project root must be absolute",
          path: ["projects", index, "root"],
        });
      }
    });
  });

export type AppConfig = z.infer<typeof AppConfigSchema>;
export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
export type ModelSelection = z.infer<typeof ModelSelectionSchema>;
export type DebateConfig = z.infer<typeof DebateConfigSchema>;
