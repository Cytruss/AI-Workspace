import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";
import {
  capabilitySatisfiesConfiguredSelections,
  runDoctor,
} from "../../../src/cli/doctor.js";
import { AppConfigSchema } from "../../../src/config/schema.js";

const execute = promisify(execFile);

const available = {
  available: true,
  nonInteractive: true,
  structuredOutput: true,
  readOnlyEnforcement: true,
  modelOption: { supported: true },
  effortOption: { supported: true, allowedValues: ["low", "high"] },
  observedModelReporting: { supported: true },
  diagnostics: [],
};

describe("doctor capability gate", () => {
  test("rejects configured classes when observation reporting is unavailable", () => {
    expect(
      capabilitySatisfiesConfiguredSelections(
        { ...available, observedModelReporting: { supported: false } },
        [
          {
            class: "sol",
            cliModelId: "model",
            acceptedObservedModels: {
              exactIds: ["model"],
              literalPrefixes: [],
            },
          },
        ],
      ),
    ).toBe(false);
  });

  test("allows provider-default omission without observation reporting", () => {
    expect(
      capabilitySatisfiesConfiguredSelections(
        { ...available, observedModelReporting: { supported: false } },
        [],
      ),
    ).toBe(true);
  });

  test("rejects a configured effort outside the safe allowed-values list", () => {
    expect(
      capabilitySatisfiesConfiguredSelections(available, [
        {
          class: "sol",
          cliModelId: "model",
          requestedEffort: "ultra",
          acceptedObservedModels: { exactIds: ["model"], literalPrefixes: [] },
        },
      ]),
    ).toBe(false);
  });
});

describe("runDoctor", () => {
  test("reports explicitly configured unavailable native providers without probing them", async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "ai-workspace-doctor-"));
    try {
      const projectRoot = join(tempDirectory, "project");
      await execute("git", ["init", "--quiet", projectRoot]);
      const config = AppConfigSchema.parse({
        version: 1,
        mode: "observe",
        discord: {
          applicationId: "test-application",
          guildIds: ["test-guild"],
          allowedUserIds: ["test-user"],
          tokenEnv: "AI_WORKSPACE_DISCORD_TOKEN",
        },
        projects: [
          { id: "test-project", name: "Test project", root: projectRoot },
        ],
        agents: {
          codex: {
            command: join(tempDirectory, "missing-codex.exe"),
            models: { selections: [] },
          },
          claude: {
            command: join(tempDirectory, "missing-claude.exe"),
            models: { selections: [] },
          },
        },
      });
      const lines: string[] = [];

      const healthy = await runDoctor({
        config,
        configFile: join(tempDirectory, "config.json"),
        databaseFile: join(tempDirectory, "workspace.sqlite"),
        write: (line) => lines.push(line),
      });

      expect(healthy).toBe(false);
      expect(lines).toContainEqual(
        expect.stringContaining("codex: executable=unresolved"),
      );
      expect(lines).toContainEqual(
        expect.stringContaining("claude: executable=unresolved"),
      );
    } finally {
      await rm(tempDirectory, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      });
    }
  });
});
