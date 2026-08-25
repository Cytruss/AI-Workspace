import { stat } from "node:fs/promises";
import { isAbsolute, posix, win32 } from "node:path";
import { runProcess } from "../platform/process-runner.js";

export type AgentCommandProvider = "codex" | "claude";
export type AgentCommandSource =
  "configured" | "path" | "candidate" | "unresolved";

export interface AgentCommandResolution {
  command?: string;
  source: AgentCommandSource;
  diagnostic: string;
}

export interface ResolveAgentCommandOptions {
  provider: AgentCommandProvider;
  configuredCommand: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  runProcess?: typeof runProcess;
  inspectNativeFile?: (candidate: string) => Promise<boolean>;
}

const probeTimeoutMs = 10_000;
const probeMaxOutputBytes = 256 * 1024;

function windowsShim(path: string): boolean {
  return /\.(cmd|bat)$/i.test(path);
}

function nativeNames(
  provider: AgentCommandProvider,
  platform: NodeJS.Platform,
) {
  return platform === "win32" ? [`${provider}.exe`] : [provider];
}

async function regularNativeFile(
  candidate: string,
  platform: NodeJS.Platform,
  inspectNativeFile: ResolveAgentCommandOptions["inspectNativeFile"],
): Promise<boolean> {
  if (platform === "win32" && !/\.exe$/i.test(candidate)) return false;
  if (windowsShim(candidate)) return false;
  if (inspectNativeFile !== undefined) return inspectNativeFile(candidate);
  try {
    const metadata = await stat(candidate);
    return (
      metadata.isFile() &&
      (platform === "win32" || (metadata.mode & 0o111) !== 0)
    );
  } catch {
    return false;
  }
}

async function versionProbe(
  candidate: string,
  options: Required<
    Pick<ResolveAgentCommandOptions, "cwd" | "env" | "runProcess">
  >,
): Promise<boolean> {
  try {
    const result = await options.runProcess({
      command: candidate,
      args: ["--version"],
      cwd: options.cwd,
      env: options.env,
      timeoutMs: probeTimeoutMs,
      maxOutputBytes: probeMaxOutputBytes,
      signal: new AbortController().signal,
    });
    return result.exitCode === 0 && result.termination === "exit";
  } catch {
    return false;
  }
}

function documentedCandidates(
  provider: AgentCommandProvider,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): string[] {
  if (provider !== "claude") return [];
  if (platform === "win32") {
    const candidates: string[] = [];
    if (env.APPDATA) {
      candidates.push(
        win32.join(
          env.APPDATA,
          "npm",
          "node_modules",
          "@anthropic-ai",
          "claude-code",
          "bin",
          "claude.exe",
        ),
      );
    }
    if (env.USERPROFILE)
      candidates.push(
        win32.join(env.USERPROFILE, ".local", "bin", "claude.exe"),
      );
    return candidates;
  }
  if (!env.HOME) return [];
  return [posix.join(env.HOME, ".local", "bin", "claude")];
}

function pathCandidates(
  provider: AgentCommandProvider,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): string[] {
  const value = env.PATH;
  if (!value) return [];
  const separator = platform === "win32" ? ";" : ":";
  const pathApi = platform === "win32" ? win32 : posix;
  return value
    .split(separator)
    .filter((segment) => segment.length > 0)
    .flatMap((segment) =>
      nativeNames(provider, platform).map((name) =>
        pathApi.join(segment, name),
      ),
    );
}

function includesWindowsShim(
  provider: AgentCommandProvider,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): boolean {
  if (platform !== "win32" || provider !== "claude" || !env.APPDATA)
    return false;
  return true;
}

export async function resolveAgentCommand(
  input: ResolveAgentCommandOptions,
): Promise<AgentCommandResolution> {
  const platform = input.platform ?? process.platform;
  const env = input.env ?? process.env;
  const options = {
    cwd: input.cwd ?? process.cwd(),
    env,
    runProcess: input.runProcess ?? runProcess,
  };
  const diagnostics: string[] = [];
  const configured = input.configuredCommand.trim();

  if (configured.length === 0) {
    return {
      source: "unresolved",
      diagnostic:
        "Configure a native executable path or install the provider CLI.",
    };
  }
  if (windowsShim(configured)) {
    return {
      source: "unresolved",
      diagnostic:
        "Windows .cmd and .bat shims are not permitted; configure a native .exe path.",
    };
  }
  if (isAbsolute(configured)) {
    if (
      !(await regularNativeFile(configured, platform, input.inspectNativeFile))
    ) {
      return {
        source: "unresolved",
        diagnostic:
          "The configured executable must be a regular native executable file.",
      };
    }
    if (await versionProbe(configured, options)) {
      return {
        command: configured,
        source: "configured",
        diagnostic: "Configured native executable was verified with --version.",
      };
    }
    return {
      source: "unresolved",
      diagnostic:
        "The configured native executable failed its direct --version probe.",
    };
  }

  for (const candidate of pathCandidates(input.provider, platform, env)) {
    if (
      !(await regularNativeFile(candidate, platform, input.inspectNativeFile))
    )
      continue;
    if (await versionProbe(candidate, options)) {
      return {
        command: candidate,
        source: "path",
        diagnostic:
          "Native executable found in PATH and verified with --version.",
      };
    }
    diagnostics.push(
      "A native PATH candidate failed its direct --version probe.",
    );
  }

  const candidates = documentedCandidates(input.provider, platform, env);
  for (const candidate of candidates) {
    if (
      !(await regularNativeFile(candidate, platform, input.inspectNativeFile))
    )
      continue;
    if (await versionProbe(candidate, options)) {
      return {
        command: candidate,
        source: "candidate",
        diagnostic: includesWindowsShim(input.provider, platform, env)
          ? "A Windows npm shim is diagnostic-only; its documented native target was verified directly."
          : "Documented native executable was verified with --version.",
      };
    }
    diagnostics.push(
      "A documented native candidate failed its direct --version probe.",
    );
  }

  const shimDiagnostic = includesWindowsShim(input.provider, platform, env)
    ? " A Windows npm shim is diagnostic-only; install or configure its native .exe target."
    : "";
  return {
    source: "unresolved",
    diagnostic:
      (diagnostics[0] ?? "No verified native executable was found.") +
      `${shimDiagnostic} Configure an explicit native executable path in setup.`,
  };
}
