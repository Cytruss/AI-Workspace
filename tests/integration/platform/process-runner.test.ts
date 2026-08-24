import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runProcess } from "../../../src/platform/process-runner.js";
import { terminateProcessTree } from "../../../src/platform/terminate-process-tree.js";

const fakeAgent = fileURLToPath(
  new URL("../../fake-agents/runner.mjs", import.meta.url),
);

function request(
  mode: string,
  overrides: Partial<Parameters<typeof runProcess>[0]> = {},
) {
  return {
    command: process.execPath,
    args: [fakeAgent, mode],
    cwd: process.cwd(),
    env: process.env,
    timeoutMs: 1_000,
    maxOutputBytes: 4_096,
    signal: new AbortController().signal,
    ...overrides,
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe("process runner", () => {
  it("treats an already-exited process tree as terminated", async () => {
    const child = spawn(process.execPath, ["-e", "process.exit(0)"], {
      shell: false,
      stdio: "ignore",
    });
    await new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", () => {
        resolve();
      });
    });
    if (child.pid === undefined) {
      throw new Error("Short-lived child did not expose a PID");
    }

    await expect(terminateProcessTree(child.pid, 1)).resolves.toBeUndefined();
  });

  it("reports a typed error when the executable cannot start", async () => {
    await expect(
      runProcess(
        request("success", {
          command: `missing-process-runner-${crypto.randomUUID()}`,
        }),
      ),
    ).rejects.toMatchObject({ code: "PROCESS_START_FAILED" });
  });

  it("writes stdin and returns stdout from a direct executable", async () => {
    const result = await runProcess(request("success", { stdin: "hello" }));

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("hello");
    expect(result.termination).toBe("exit");
  });

  it("returns the non-zero exit code and stderr", async () => {
    const result = await runProcess(request("fail"));

    expect(result).toMatchObject({
      exitCode: 17,
      stderr: "deterministic failure\n",
      termination: "exit",
    });
  });

  it("captures stderr from a successful process", async () => {
    const result = await runProcess(request("stderr"));

    expect(result).toMatchObject({
      exitCode: 0,
      stderr: "deterministic stderr\n",
      termination: "exit",
    });
  });

  it("terminates a process after its timeout", async () => {
    const result = await runProcess(request("hang", { timeoutMs: 50 }));

    expect(result.termination).toBe("timed_out");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("terminates a process after explicit cancellation", async () => {
    const controller = new AbortController();
    const running = runProcess(request("hang", { signal: controller.signal }));
    setTimeout(() => {
      controller.abort();
    }, 50);

    await expect(running).resolves.toMatchObject({ termination: "cancelled" });
  });

  it("terminates a process that exceeds its combined output limit", async () => {
    const result = await runProcess(
      request("oversize", { maxOutputBytes: 128 }),
    );

    expect(result.termination).toBe("output_limit");
    expect(
      Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr),
    ).toBeLessThanOrEqual(128);
    expect(Buffer.byteLength(result.stdout)).toBeGreaterThan(0);
    expect(Buffer.byteLength(result.stderr)).toBeGreaterThan(0);
  });

  it("terminates descendant processes with the process tree", async () => {
    const terminationPath = join(
      tmpdir(),
      `process-runner-${crypto.randomUUID()}.txt`,
    );
    const result = await runProcess(
      request("spawn-child", {
        args: [fakeAgent, "spawn-child", terminationPath],
        timeoutMs: 500,
      }),
    );

    expect(result.termination).toBe("timed_out");
    await delay(100);
    expect(await exists(terminationPath)).toBe(true);
    expect(await readFile(terminationPath, "utf8")).toContain(
      "grandchild-started",
    );
    const { childPid } = JSON.parse(result.stdout) as { childPid: number };
    expect(() => process.kill(childPid, 0)).toThrow(/ESRCH/);
  });
});
