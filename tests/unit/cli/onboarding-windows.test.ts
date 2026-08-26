import { describe, expect, test } from "vitest";
import {
  inspectWindowsPrerequisites,
  installWindowsPrerequisite,
  type WindowsCommandRunner,
  type WindowsPrerequisite,
} from "../../../src/cli/onboarding-windows.js";
import type {
  AgentCommandResolution,
  ResolveAgentCommandOptions,
} from "../../../src/cli/resolve-agent-command.js";

type CommandCall = [file: string, args: readonly string[]];

function result(
  exitCode: number,
  stdout = "",
  stderr = "",
): Awaited<ReturnType<WindowsCommandRunner>> {
  return { exitCode, stdout, stderr };
}

describe("inspectWindowsPrerequisites", () => {
  test("reports missing tools, rejects a non-22 Node major, and retains shim diagnostics", async () => {
    const resolverCalls: Array<
      Pick<ResolveAgentCommandOptions, "provider" | "configuredCommand">
    > = [];
    const runner: WindowsCommandRunner = (file) => {
      if (file === "node") return Promise.resolve(result(0, "v24.19.0\n"));
      if (file === "winget") return Promise.reject(new Error("not found"));
      return Promise.resolve(result(1, "", `${file} is unavailable`));
    };
    const resolveAgent = (
      options: Pick<
        ResolveAgentCommandOptions,
        "provider" | "configuredCommand"
      >,
    ): Promise<AgentCommandResolution> => {
      resolverCalls.push(options);
      return Promise.resolve({
        source: "unresolved",
        diagnostic:
          options.provider === "claude"
            ? "Windows .cmd and .bat shims are diagnostic-only."
            : "No verified native executable was found.",
      });
    };

    const statuses = await inspectWindowsPrerequisites(runner, resolveAgent);

    expect(
      statuses.map(({ name, available }) => ({ name, available })),
    ).toEqual([
      { name: "node", available: false },
      { name: "git", available: false },
      { name: "pnpm", available: false },
      { name: "codex", available: false },
      { name: "claude", available: false },
      { name: "winget", available: false },
    ]);
    expect(statuses.find(({ name }) => name === "node")?.detail).toContain(
      "22",
    );
    expect(statuses.find(({ name }) => name === "claude")?.detail).toContain(
      ".cmd",
    );
    expect(resolverCalls).toEqual([
      { provider: "codex", configuredCommand: "codex" },
      { provider: "claude", configuredCommand: "claude" },
    ]);
  });
});

describe("installWindowsPrerequisite", () => {
  test.each(["unknown", "codex", "claude", "winget"])(
    "rejects non-allowlisted prerequisite %s without starting a process",
    async (name) => {
      const calls: CommandCall[] = [];
      const runner: WindowsCommandRunner = (file, args) => {
        calls.push([file, args]);
        return Promise.resolve(result(0));
      };

      await expect(
        installWindowsPrerequisite(name as WindowsPrerequisite, runner),
      ).rejects.toThrow("not installable");
      expect(calls).toHaveLength(0);
    },
  );

  test("uses the exact Git package action and verifies Git afterward", async () => {
    const calls: CommandCall[] = [];
    const runner: WindowsCommandRunner = (file, args) => {
      calls.push([file, args]);
      return Promise.resolve(
        file === "git"
          ? result(0, "git version 2.55.0.windows.1\n")
          : result(0),
      );
    };

    const status = await installWindowsPrerequisite("git", runner);

    expect(calls).toContainEqual([
      "winget",
      ["install", "--id", "Git.Git", "--exact", "--source", "winget"],
    ]);
    expect(calls).toEqual([
      [
        "winget",
        ["install", "--id", "Git.Git", "--exact", "--source", "winget"],
      ],
      ["git", ["--version"]],
    ]);
    expect(status).toMatchObject({ name: "git", available: true });
  });

  test("pins Node to the selected 22.x WinGet manifest and verifies its major afterward", async () => {
    const calls: CommandCall[] = [];
    const runner: WindowsCommandRunner = (file, args) => {
      calls.push([file, args]);
      return Promise.resolve(
        file === "node" ? result(0, "v22.23.2\n") : result(0),
      );
    };

    const status = await installWindowsPrerequisite("node", runner);

    expect(calls).toEqual([
      [
        "winget",
        [
          "install",
          "--id",
          "OpenJS.NodeJS.22",
          "--exact",
          "--version",
          "22.23.2",
          "--source",
          "winget",
        ],
      ],
      ["node", ["--version"]],
    ]);
    expect(status).toMatchObject({ name: "node", available: true });
  });

  test("activates only the repository-pinned pnpm after verifying Node 22", async () => {
    const calls: CommandCall[] = [];
    const runner: WindowsCommandRunner = (file, args) => {
      calls.push([file, args]);
      if (file === "node") return Promise.resolve(result(0, "v22.23.2\n"));
      if (file === "pnpm") return Promise.resolve(result(0, "11.19.0\n"));
      return Promise.resolve(result(0));
    };

    const status = await installWindowsPrerequisite("pnpm", runner);

    expect(calls).toEqual([
      ["node", ["--version"]],
      ["corepack", ["prepare", "pnpm@11.19.0", "--activate"]],
      ["pnpm", ["--version"]],
    ]);
    expect(status).toMatchObject({ name: "pnpm", available: true });
  });

  test("does not invoke Corepack unless Node 22 is verified", async () => {
    const calls: CommandCall[] = [];
    const runner: WindowsCommandRunner = (file, args) => {
      calls.push([file, args]);
      return Promise.resolve(result(0, "v24.19.0\n"));
    };

    const status = await installWindowsPrerequisite("pnpm", runner);

    expect(calls).toEqual([["node", ["--version"]]]);
    expect(status).toMatchObject({ name: "pnpm", available: false });
    expect(status.detail).toContain("Node.js 22");
  });

  test("returns the post-action detection result instead of assuming launch success", async () => {
    const calls: CommandCall[] = [];
    const runner: WindowsCommandRunner = (file, args) => {
      calls.push([file, args]);
      return Promise.resolve(
        file === "winget" ? result(0) : result(1, "", "git unavailable"),
      );
    };

    const status = await installWindowsPrerequisite("git", runner);

    expect(calls.at(-1)).toEqual(["git", ["--version"]]);
    expect(status).toMatchObject({ name: "git", available: false });
    expect(status.detail).toContain("unavailable");
  });
});
