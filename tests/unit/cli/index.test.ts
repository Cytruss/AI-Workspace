import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import type { OnboardingResult } from "../../../src/cli/onboarding-types.js";

const mocks = vi.hoisted(() => ({
  runDoctor: vi.fn().mockResolvedValue(true),
  runOnboarding: vi.fn<() => Promise<OnboardingResult>>().mockResolvedValue({
    stage: "complete",
    nextAction: "Run pnpm start.",
  }),
  loadConfig: vi.fn().mockResolvedValue({ marker: "configuration" }),
  loadEnvironment: vi.fn(),
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
vi.mock("dotenv", () => ({ config: mocks.loadEnvironment }));

const originalArgv = process.argv;
const originalExitCode = process.exitCode;
process.argv = ["node", "src/index.ts", "doctor"];

afterAll(() => {
  process.argv = originalArgv;
  process.exitCode = originalExitCode;
});

describe("CLI entrypoint", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.parseCommand.mockReturnValue({ name: "doctor" });
    mocks.runOnboarding.mockResolvedValue({
      stage: "complete",
      nextAction: "Run pnpm start.",
    });
    process.exitCode = undefined;
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

  test("shows the successful onboarding next action before returning", async () => {
    mocks.parseCommand.mockReturnValue({ name: "onboarding" });
    const write = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await import("../../../src/index.js");

    await vi.waitFor(() => {
      expect(mocks.runOnboarding).toHaveBeenCalledWith({
        configFile: "C:/Users/private/ai-workspace/config.json",
        databaseFile: "C:/Users/private/ai-workspace/data.sqlite",
      });
    });
    expect(mocks.loadEnvironment).not.toHaveBeenCalled();
    expect(mocks.loadConfig).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledWith("Run pnpm start.");
    expect(process.exitCode).toBeUndefined();
  });

  test("shows a failed onboarding next action and sets a nonzero status", async () => {
    mocks.parseCommand.mockReturnValue({ name: "onboarding" });
    mocks.runOnboarding.mockResolvedValue({
      stage: "failed",
      nextAction: "Correct the problem, then run pnpm onboarding again.",
    });
    const write = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await import("../../../src/index.js");

    await vi.waitFor(() => {
      expect(write).toHaveBeenCalledWith(
        "Correct the problem, then run pnpm onboarding again.",
      );
    });
    expect(process.exitCode).toBe(1);
  });
});
