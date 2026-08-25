import { afterAll, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runDoctor: vi.fn().mockResolvedValue(true),
  loadConfig: vi.fn().mockResolvedValue({ marker: "configuration" }),
}));

vi.mock("../../../src/cli/doctor.js", () => ({
  runDoctor: mocks.runDoctor,
}));
vi.mock("../../../src/cli/parse-command.js", () => ({
  parseCommand: () => ({ name: "doctor" }),
}));
vi.mock("../../../src/cli/setup.js", () => ({ runSetup: vi.fn() }));
vi.mock("../../../src/cli/start.js", () => ({ startApplication: vi.fn() }));
vi.mock("../../../src/config/app-paths.js", () => ({
  getAppPaths: () => ({
    configFile: "C:/Users/private/ai-workspace/config.json",
    databaseFile: "C:/Users/private/ai-workspace/data.sqlite",
  }),
}));
vi.mock("../../../src/config/load-config.js", () => ({
  loadConfig: mocks.loadConfig,
}));
vi.mock("dotenv", () => ({ config: vi.fn() }));

const originalArgv = process.argv;
process.argv = ["node", "src/index.ts", "doctor"];

afterAll(() => {
  process.argv = originalArgv;
});

describe("CLI entrypoint", () => {
  test("threads the known configuration file into doctor output", async () => {
    await import("../../../src/index.js");
    await vi.waitFor(() => {
      expect(mocks.runDoctor).toHaveBeenCalledWith({
        config: { marker: "configuration" },
        configFile: "C:/Users/private/ai-workspace/config.json",
        databaseFile: "C:/Users/private/ai-workspace/data.sqlite",
      });
    });
  });
});
