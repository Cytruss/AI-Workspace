import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runDoctor: vi.fn().mockResolvedValue(true),
  runOnboarding: vi.fn().mockResolvedValue(undefined),
  loadConfig: vi.fn().mockResolvedValue({ marker: "configuration" }),
  parseCommand: vi.fn(() => ({ name: "doctor" })),
  getAppPaths: vi.fn(() => ({
    configFile: "C:/Users/private/ai-workspace/config.json",
    databaseFile: "C:/Users/private/ai-workspace/data.sqlite",
  })),
}));

vi.mock("../../../src/cli/doctor.js", () => ({
  runDoctor: mocks.runDoctor,
}));
vi.mock("../../../src/cli/parse-command.js", () => ({
  parseCommand: mocks.parseCommand,
}));
vi.mock("../../../src/cli/onboarding.js", () => ({
  runOnboarding: mocks.runOnboarding,
}));
vi.mock("../../../src/cli/setup.js", () => ({ runSetup: vi.fn() }));
vi.mock("../../../src/cli/start.js", () => ({ startApplication: vi.fn() }));
vi.mock("../../../src/config/app-paths.js", () => ({
  getAppPaths: mocks.getAppPaths,
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
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.parseCommand.mockReturnValue({ name: "doctor" });
  });

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

  test("runs onboarding with the application paths", async () => {
    mocks.parseCommand.mockReturnValue({ name: "onboarding" });

    await import("../../../src/index.js");

    await vi.waitFor(() => {
      expect(mocks.runOnboarding).toHaveBeenCalledWith({
        configFile: "C:/Users/private/ai-workspace/config.json",
        databaseFile: "C:/Users/private/ai-workspace/data.sqlite",
      });
    });
  });
});
