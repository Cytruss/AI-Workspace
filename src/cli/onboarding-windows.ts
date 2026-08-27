import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { win32 } from "node:path";
import type {
  AgentCommandResolution,
  ResolveAgentCommandOptions,
} from "./resolve-agent-command.js";

export type WindowsPrerequisite =
  "node" | "git" | "pnpm" | "codex" | "claude" | "winget";

export interface WindowsPrerequisiteStatus {
  name: WindowsPrerequisite;
  available: boolean;
  detail: string;
}

export type WindowsCommandRunner = (
  file: string,
  args: readonly string[],
) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

type WindowsCommandResult = Awaited<ReturnType<WindowsCommandRunner>>;

type WindowsProcessExecutor = (
  file: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
) => Promise<WindowsCommandResult>;

export interface WindowsCommandRunnerOptions {
  platform?: NodeJS.Platform;
  nodeExecutable?: string;
  env?: NodeJS.ProcessEnv;
  inspectFile?: (file: string) => Promise<boolean>;
  executeFile?: WindowsProcessExecutor;
}

type WindowsAgentResolver = (
  options: Pick<ResolveAgentCommandOptions, "provider" | "configuredCommand">,
) => Promise<AgentCommandResolution>;

type InstallableWindowsPrerequisite = "node" | "git" | "pnpm";

interface InstallAction {
  readonly file: string;
  readonly args: readonly string[];
}

// WinGet flags and the Git example:
// https://learn.microsoft.com/en-us/windows/package-manager/winget/install
// Node 22.23.2 archive entry:
// https://nodejs.org/en/download/archive/v22
// Official immutable Node manifest (PackageIdentifier OpenJS.NodeJS.22,
// PackageVersion 22.23.2):
// https://github.com/microsoft/winget-pkgs/tree/master/manifests/o/OpenJS/NodeJS/22/22.23.2
// Official Git.Git manifest root:
// https://github.com/microsoft/winget-pkgs/tree/master/manifests/g/Git/Git
const installActions = {
  node: {
    file: "winget",
    args: [
      "install",
      "--id",
      "OpenJS.NodeJS.22",
      "--exact",
      "--version",
      "22.23.2",
      "--source",
      "winget",
    ],
  },
  git: {
    file: "winget",
    args: ["install", "--id", "Git.Git", "--exact", "--source", "winget"],
  },
  pnpm: {
    file: "corepack",
    args: ["prepare", "pnpm@11.19.0", "--activate"],
  },
} as const satisfies Record<InstallableWindowsPrerequisite, InstallAction>;

function processFailure(error: unknown): WindowsCommandResult {
  return {
    exitCode:
      error instanceof Error &&
      "code" in error &&
      typeof error.code === "number"
        ? error.code
        : 1,
    stdout: "",
    stderr:
      error instanceof Error ? error.message : "Direct process launch failed.",
  };
}

function executeFile(
  file: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<WindowsCommandResult> {
  return new Promise((resolve) => {
    try {
      execFile(
        file,
        [...args],
        { env, windowsHide: true },
        (error, stdout, stderr) => {
          resolve(
            error === null
              ? { exitCode: 0, stdout, stderr }
              : {
                  ...processFailure(error),
                  stdout,
                  stderr: stderr || error.message,
                },
          );
        },
      );
    } catch (error) {
      resolve(processFailure(error));
    }
  });
}

async function regularFile(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

function unavailableDirectTarget(detail: string): WindowsCommandResult {
  return { exitCode: 1, stdout: "", stderr: detail };
}

function invokingPnpmVersion(env: NodeJS.ProcessEnv): string | undefined {
  return /^pnpm\/([^\s]+)/.exec(env.npm_config_user_agent ?? "")?.[1];
}

export function createWindowsCommandRunner(
  options: WindowsCommandRunnerOptions = {},
): WindowsCommandRunner {
  const platform = options.platform ?? process.platform;
  const nodeExecutable = options.nodeExecutable ?? process.execPath;
  const env = options.env ?? process.env;
  const inspectFile = options.inspectFile ?? regularFile;
  const runFile = options.executeFile ?? executeFile;

  return async (file, args) => {
    if (platform !== "win32") return runFile(file, args, env);
    if (/\.(cmd|bat)$/i.test(file)) {
      return unavailableDirectTarget(
        "Windows .cmd and .bat shims cannot cross the direct-process boundary; use a native executable or the manual setup route.",
      );
    }
    if (file === "pnpm") {
      const version = invokingPnpmVersion(env);
      return version === undefined
        ? unavailableDirectTarget(
            "pnpm could not be verified without executing a Windows command shim. Follow the manual Windows setup guide.",
          )
        : { exitCode: 0, stdout: `${version}\n`, stderr: "" };
    }
    if (file !== "corepack") return runFile(file, args, env);

    const entryPoint = win32.join(
      win32.dirname(nodeExecutable),
      "node_modules",
      "corepack",
      "dist",
      "corepack.js",
    );
    if (
      !/\.exe$/i.test(nodeExecutable) ||
      !(await inspectFile(nodeExecutable)) ||
      !(await inspectFile(entryPoint))
    ) {
      return unavailableDirectTarget(
        "A verified native node.exe and Corepack JavaScript entry point were not found. Follow the manual Windows setup guide.",
      );
    }
    return runFile(nodeExecutable, [entryPoint, ...args], env);
  };
}

function outputDetail(stdout: string, stderr: string): string {
  return stdout.trim() || stderr.trim();
}

async function inspectCommand(
  name: "git" | "pnpm" | "winget",
  runner: WindowsCommandRunner,
): Promise<WindowsPrerequisiteStatus> {
  try {
    const result = await runner(name, ["--version"]);
    const detail = outputDetail(result.stdout, result.stderr);
    return result.exitCode === 0
      ? {
          name,
          available: true,
          detail: detail || `${name} is available.`,
        }
      : {
          name,
          available: false,
          detail: detail || `${name} is unavailable.`,
        };
  } catch (error) {
    return {
      name,
      available: false,
      detail: `${name} is unavailable: ${error instanceof Error ? error.message : "process launch failed"}`,
    };
  }
}

async function inspectNode(
  runner: WindowsCommandRunner,
): Promise<WindowsPrerequisiteStatus> {
  try {
    const result = await runner("node", ["--version"]);
    const detail = outputDetail(result.stdout, result.stderr);
    if (result.exitCode === 0 && /^v?22\./.test(detail)) {
      return { name: "node", available: true, detail };
    }
    return {
      name: "node",
      available: false,
      detail:
        result.exitCode === 0
          ? `Node.js 22 is required; found ${detail || "an unknown version"}.`
          : detail || "Node.js 22 is unavailable.",
    };
  } catch (error) {
    return {
      name: "node",
      available: false,
      detail: `Node.js 22 is unavailable: ${error instanceof Error ? error.message : "process launch failed"}`,
    };
  }
}

async function inspectProvider(
  name: "codex" | "claude",
  resolveAgent: WindowsAgentResolver,
): Promise<WindowsPrerequisiteStatus> {
  try {
    const resolution = await resolveAgent({
      provider: name,
      configuredCommand: name,
    });
    return {
      name,
      available: resolution.command !== undefined,
      detail: resolution.diagnostic,
    };
  } catch (error) {
    return {
      name,
      available: false,
      detail: `${name} resolution failed: ${error instanceof Error ? error.message : "unknown error"}`,
    };
  }
}

export async function inspectWindowsPrerequisites(
  runner: WindowsCommandRunner,
  resolveAgent: WindowsAgentResolver,
): Promise<WindowsPrerequisiteStatus[]> {
  const statuses: WindowsPrerequisiteStatus[] = [];
  statuses.push(await inspectNode(runner));
  statuses.push(await inspectCommand("git", runner));
  statuses.push(await inspectCommand("pnpm", runner));
  statuses.push(await inspectProvider("codex", resolveAgent));
  statuses.push(await inspectProvider("claude", resolveAgent));
  statuses.push(await inspectCommand("winget", runner));
  return statuses;
}

async function runActionThenInspect(
  name: "node" | "git",
  runner: WindowsCommandRunner,
): Promise<WindowsPrerequisiteStatus> {
  const action = installActions[name];
  try {
    await runner(action.file, action.args);
  } catch {
    // Detection below is authoritative and supplies the actionable status.
  }
  return name === "node" ? inspectNode(runner) : inspectCommand("git", runner);
}

export async function installWindowsPrerequisite(
  name: WindowsPrerequisite,
  runner: WindowsCommandRunner,
): Promise<WindowsPrerequisiteStatus> {
  if (name === "node" || name === "git") {
    return runActionThenInspect(name, runner);
  }
  if (name === "pnpm") {
    const node = await inspectNode(runner);
    if (!node.available) {
      return {
        name: "pnpm",
        available: false,
        detail: `Node.js 22 must be available before activating pnpm. ${node.detail}`,
      };
    }
    try {
      const action = await runner(
        installActions.pnpm.file,
        installActions.pnpm.args,
      );
      if (action.exitCode !== 0) {
        return {
          name: "pnpm",
          available: false,
          detail:
            outputDetail(action.stdout, action.stderr) ||
            "Corepack could not activate pnpm. Follow the manual Windows setup guide.",
        };
      }
      const verification = await runner("corepack", ["pnpm", "--version"]);
      return {
        name: "pnpm",
        available: verification.exitCode === 0,
        detail:
          outputDetail(verification.stdout, verification.stderr) ||
          (verification.exitCode === 0
            ? "pnpm is available."
            : "pnpm could not be verified. Follow the manual Windows setup guide."),
      };
    } catch (error) {
      return {
        name: "pnpm",
        available: false,
        detail: `Corepack could not activate pnpm: ${error instanceof Error ? error.message : "direct process launch failed"}. Follow the manual Windows setup guide.`,
      };
    }
  }
  throw new Error(`Windows prerequisite "${name}" is not installable.`);
}
