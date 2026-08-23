import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig, saveConfig } from "../../../src/config/load-config.js";

const tokenEnvironment = { AI_WORKSPACE_DISCORD_TOKEN: "secret" };

function validConfig(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    mode: "observe",
    discord: {
      applicationId: "application",
      guildIds: ["guild"],
      allowedUserIds: ["user"],
      tokenEnv: "AI_WORKSPACE_DISCORD_TOKEN",
    },
    projects: [{ id: "demo", name: "Demo", root: resolve("project") }],
    agents: {},
    ...overrides,
  };
}

async function writeConfig(value: unknown): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "ai-workspace-config-"));
  const filename = join(directory, "config.json");
  await writeFile(filename, JSON.stringify(value), "utf8");
  return filename;
}

async function parse(
  value: unknown,
  env: NodeJS.ProcessEnv = tokenEnvironment,
) {
  return loadConfig(await writeConfig(value), env);
}

function modelSelection(index: number) {
  return {
    class: `class-${String(index)}`,
    cliModelId: `provider-model-${String(index)}`,
    acceptedObservedModels: { exactIds: [`provider-model-${String(index)}`] },
  };
}

describe("loadConfig", () => {
  it("loads valid JSON and applies portable defaults", async () => {
    const config = await parse(validConfig());

    expect(config).toMatchObject({
      agents: {
        codex: {
          command: "codex",
          timeoutMs: 300_000,
          maxOutputBytes: 1_048_576,
          models: { selections: [] },
        },
        claude: {
          command: "claude",
          timeoutMs: 300_000,
          maxOutputBytes: 1_048_576,
          models: { selections: [] },
        },
      },
      debate: { maxRounds: 3, maxBoardClaims: 40, maxBoardBytes: 65_536 },
      concurrency: 2,
      logging: { level: "info" },
      retention: { mode: "manual" },
    });
    expect(config.agents.codex.models.defaultModel).toBeUndefined();
    expect(config).not.toHaveProperty("discord.token");
  });

  it("rejects duplicate project IDs and non-absolute roots", async () => {
    await expect(
      parse(
        validConfig({
          projects: [
            { id: "same", name: "One", root: resolve("one") },
            { id: "same", name: "Two", root: resolve("two") },
          ],
        }),
      ),
    ).rejects.toThrow("Project IDs must be unique");
    await expect(
      parse(
        validConfig({
          projects: [{ id: "demo", name: "Demo", root: "relative" }],
        }),
      ),
    ).rejects.toThrow("Project root must be absolute");
  });

  it.each([
    ["guildIds", { guildIds: [], allowedUserIds: ["user"] }],
    ["allowedUserIds", { guildIds: ["guild"], allowedUserIds: [] }],
  ])("rejects an empty Discord %s allowlist", async (_name, lists) => {
    await expect(
      parse(
        validConfig({
          discord: {
            applicationId: "application",
            tokenEnv: "AI_WORKSPACE_DISCORD_TOKEN",
            ...lists,
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it("rejects write-capable execution modes", async () => {
    await expect(parse(validConfig({ mode: "implement" }))).rejects.toThrow();
  });

  it("requires a non-empty configured token environment variable", async () => {
    const filename = await writeConfig(validConfig());
    await expect(loadConfig(filename, {})).rejects.toThrow(
      "AI_WORKSPACE_DISCORD_TOKEN is required",
    );
    await expect(
      loadConfig(filename, { AI_WORKSPACE_DISCORD_TOKEN: "" }),
    ).rejects.toThrow("AI_WORKSPACE_DISCORD_TOKEN is required");
  });

  it.each([
    ["maxRounds", 1, 5, 0, 6],
    ["maxBoardClaims", 2, 200, 1, 201],
    ["maxBoardBytes", 4_096, 262_144, 4_095, 262_145],
  ] as const)(
    "accepts %s boundaries and rejects adjacent values",
    async (field, lower, upper, below, above) => {
      await expect(
        parse(validConfig({ debate: { [field]: lower } })),
      ).resolves.toBeDefined();
      await expect(
        parse(validConfig({ debate: { [field]: upper } })),
      ).resolves.toBeDefined();
      await expect(
        parse(validConfig({ debate: { [field]: below } })),
      ).rejects.toThrow();
      await expect(
        parse(validConfig({ debate: { [field]: above } })),
      ).rejects.toThrow();
    },
  );

  it("accepts zero and 25 model selections and rejects 26", async () => {
    await expect(parse(validConfig())).resolves.toBeDefined();
    await expect(
      parse(
        validConfig({
          agents: {
            codex: {
              command: "codex",
              models: {
                selections: Array.from({ length: 25 }, (_, index) =>
                  modelSelection(index),
                ),
              },
            },
          },
        }),
      ),
    ).resolves.toBeDefined();
    await expect(
      parse(
        validConfig({
          agents: {
            codex: {
              command: "codex",
              models: {
                selections: Array.from({ length: 26 }, (_, index) =>
                  modelSelection(index),
                ),
              },
            },
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it("rejects duplicate classes and unknown defaults", async () => {
    const selection = modelSelection(1);
    await expect(
      parse(
        validConfig({
          agents: {
            codex: {
              command: "codex",
              models: { selections: [selection, selection] },
            },
          },
        }),
      ),
    ).rejects.toThrow("Model classes must be unique");
    await expect(
      parse(
        validConfig({
          agents: {
            codex: {
              command: "codex",
              models: { defaultModel: "missing", selections: [selection] },
            },
          },
        }),
      ),
    ).rejects.toThrow("Default model must resolve to a configured selection");
  });

  it.each([
    ["empty CLI model ID", { ...modelSelection(1), cliModelId: "" }],
    [
      "oversized CLI model ID",
      { ...modelSelection(1), cliModelId: "x".repeat(201) },
    ],
    ["empty effort", { ...modelSelection(1), requestedEffort: "" }],
    [
      "oversized effort",
      { ...modelSelection(1), requestedEffort: "x".repeat(33) },
    ],
  ])("rejects %s", async (_name, selection) => {
    await expect(
      parse(
        validConfig({
          agents: {
            codex: { command: "codex", models: { selections: [selection] } },
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it("accepts opaque values and documented example mappings", async () => {
    const codex = [
      ["sol", "gpt-5.6-sol"],
      ["terra", "gpt-5.6-terra"],
      ["luna", "gpt-5.6-luna"],
    ].map(([modelClass, cliModelId]) => ({
      class: modelClass,
      cliModelId,
      requestedEffort: "provider-specific:ultra",
      acceptedObservedModels: { exactIds: [cliModelId] },
    }));
    const claude = ["opus", "fable", "sonnet", "haiku"].map((modelClass) => ({
      class: modelClass,
      cliModelId: modelClass,
      acceptedObservedModels: { literalPrefixes: [`claude-${modelClass}-`] },
    }));
    const result = await parse(
      validConfig({
        agents: {
          codex: {
            command: "codex",
            models: { defaultModel: "sol", selections: codex },
          },
          claude: {
            command: "claude",
            models: { defaultModel: "opus", selections: claude },
          },
        },
      }),
    );
    expect(result.agents.codex.models.selections).toHaveLength(3);
    expect(result.agents.claude.models.selections).toHaveLength(4);
    expect(result.agents.codex.models.selections[0]?.requestedEffort).toBe(
      "provider-specific:ultra",
    );
  });

  it("enforces bounded, unique literal observation policies", async () => {
    const selection = modelSelection(1);
    const withPolicy = (acceptedObservedModels: unknown) => ({
      ...selection,
      acceptedObservedModels,
    });
    for (const policy of [
      {},
      { exactIds: ["same", "same"] },
      { literalPrefixes: ["same", "same"] },
      {
        exactIds: Array.from(
          { length: 26 },
          (_, index) => `id-${String(index)}`,
        ),
      },
      {
        literalPrefixes: Array.from(
          { length: 9 },
          (_, index) => `prefix-${String(index)}`,
        ),
      },
      { exactIds: ["x".repeat(201)] },
    ]) {
      await expect(
        parse(
          validConfig({
            agents: {
              codex: {
                command: "codex",
                models: { selections: [withPolicy(policy)] },
              },
            },
          }),
        ),
      ).rejects.toThrow();
    }
    await expect(
      parse(
        validConfig({
          agents: {
            codex: {
              command: "codex",
              models: {
                selections: [
                  withPolicy({
                    exactIds: [".*"],
                    literalPrefixes: ["model[0-9]"],
                  }),
                ],
              },
            },
          },
        }),
      ),
    ).resolves.toMatchObject({
      agents: {
        codex: {
          models: {
            selections: [
              {
                acceptedObservedModels: {
                  exactIds: [".*"],
                  literalPrefixes: ["model[0-9]"],
                },
              },
            ],
          },
        },
      },
    });
  });
});

describe("saveConfig", () => {
  it("creates private paths and atomically writes parseable configuration", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ai-workspace-save-"));
    const configFile = join(directory, "nested", "config.json");
    const config = await parse(validConfig());
    await saveConfig(configFile, config);
    expect(JSON.parse(await readFile(configFile, "utf8"))).toEqual(config);
    if (process.platform !== "win32") {
      expect((await stat(join(directory, "nested"))).mode & 0o777).toBe(0o700);
      expect((await stat(configFile)).mode & 0o777).toBe(0o600);
    }
  });
});
