import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { resolveAgentCommand } from "../../../src/cli/resolve-agent-command.js";
import type {
  ProcessRequest,
  ProcessResult,
} from "../../../src/platform/process-runner.js";

function successfulProbe(requests: ProcessRequest[]) {
  return (request: ProcessRequest): Promise<ProcessResult> => {
    requests.push(request);
    return Promise.resolve({
      exitCode: 0,
      signal: null,
      stdout: "Claude 2.1.233\n",
      stderr: "",
      durationMs: 1,
      termination: "exit",
    });
  };
}

describe("resolveAgentCommand", () => {
  test("uses a configured native executable before PATH candidates", async () => {
    const directory = join(tmpdir(), `ai-workspace-cli-${String(Date.now())}`);
    await mkdir(directory, { recursive: true });
    const configured = join(directory, "configured.exe");
    const pathExecutable = join(directory, "claude.exe");
    await writeFile(configured, "native");
    await writeFile(pathExecutable, "native");
    const requests: ProcessRequest[] = [];

    const resolution = await resolveAgentCommand({
      provider: "claude",
      configuredCommand: configured,
      platform: "win32",
      env: { PATH: directory },
      runProcess: successfulProbe(requests),
    });

    expect(resolution).toMatchObject({
      command: configured,
      source: "configured",
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      command: configured,
      args: ["--version"],
    });
  });

  test("selects a direct native executable from PATH without a shell", async () => {
    const directory = join(tmpdir(), `ai-workspace-path-${String(Date.now())}`);
    await mkdir(directory, { recursive: true });
    const executable = join(directory, "claude.exe");
    await writeFile(executable, "native");
    const requests: ProcessRequest[] = [];

    const resolution = await resolveAgentCommand({
      provider: "claude",
      configuredCommand: "claude",
      platform: "win32",
      env: { PATH: directory },
      runProcess: successfulProbe(requests),
    });

    expect(resolution).toMatchObject({ command: executable, source: "path" });
    expect(requests[0]).toMatchObject({
      command: executable,
      args: ["--version"],
    });
    expect(requests[0]?.command).not.toContain("cmd.exe");
  });

  test("rejects a Windows npm shim and resolves only its documented native target", async () => {
    const appData = join(
      tmpdir(),
      `ai-workspace-appdata-${String(Date.now())}`,
    );
    const npm = join(appData, "npm");
    const shim = join(npm, "claude.cmd");
    const native = join(
      npm,
      "node_modules",
      "@anthropic-ai",
      "claude-code",
      "bin",
      "claude.exe",
    );
    await mkdir(
      join(npm, "node_modules", "@anthropic-ai", "claude-code", "bin"),
      { recursive: true },
    );
    await writeFile(shim, "x".repeat(160));
    await writeFile(native, "native");
    const requests: ProcessRequest[] = [];

    const resolution = await resolveAgentCommand({
      provider: "claude",
      configuredCommand: "claude",
      platform: "win32",
      env: { APPDATA: appData, PATH: npm },
      runProcess: successfulProbe(requests),
    });

    expect(resolution).toMatchObject({ command: native, source: "candidate" });
    expect(resolution.diagnostic).toContain("shim");
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ command: native, args: ["--version"] });
  });

  test("uses the documented Unix native launcher and produces actionable diagnostics when absent", async () => {
    const home = join(tmpdir(), `ai-workspace-home-${String(Date.now())}`);
    const launcher = join(home, ".local", "bin", "claude");
    await mkdir(join(home, ".local", "bin"), { recursive: true });
    await writeFile(launcher, "native", { mode: 0o755 });
    const requests: ProcessRequest[] = [];

    const resolved = await resolveAgentCommand({
      provider: "claude",
      configuredCommand: "claude",
      platform: "linux",
      env: { HOME: home },
      runProcess: successfulProbe(requests),
      inspectNativeFile: () => Promise.resolve(true),
    });
    expect(resolved.source).toBe("candidate");
    expect(resolved.command).toContain(".local/bin/claude");
    await expect(
      resolveAgentCommand({
        provider: "claude",
        configuredCommand: "claude",
        platform: "linux",
        env: {},
        runProcess: successfulProbe([]),
      }),
    ).resolves.toMatchObject({ source: "unresolved" });
  });

  test("does not accept non-native paths or failed direct version probes", async () => {
    const directory = join(
      tmpdir(),
      `ai-workspace-invalid-${String(Date.now())}`,
    );
    await mkdir(directory, { recursive: true });
    const shim = join(directory, "claude.cmd");
    await writeFile(shim, "shim");

    const resolution = await resolveAgentCommand({
      provider: "claude",
      configuredCommand: shim,
      platform: "win32",
      env: { PATH: directory },
      runProcess: (): Promise<ProcessResult> =>
        Promise.resolve({
          exitCode: 1,
          signal: null,
          stdout: "",
          stderr: "failed",
          durationMs: 1,
          termination: "exit",
        }),
    });

    expect(resolution).toMatchObject({ source: "unresolved" });
    expect(resolution).not.toHaveProperty("command");
    expect(resolution.diagnostic).toContain(".cmd");
  });
});
