import { spawn } from "node:child_process";

function wait(graceMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, graceMs);
  });
}

function runTaskkill(args: string[]): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn("taskkill", args, {
      shell: false,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", resolve);
    child.once("close", resolve);
  });
}

function signalProcessGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch (error: unknown) {
    if (!(
      error instanceof Error &&
      "code" in error &&
      error.code === "ESRCH"
    )) {
      throw error;
    }
  }
}

export async function terminateProcessTree(
  pid: number,
  graceMs: number,
): Promise<void> {
  if (process.platform === "win32") {
    await runTaskkill(["/pid", String(pid), "/t"]);
    await wait(graceMs);
    await runTaskkill(["/pid", String(pid), "/t", "/f"]);
    return;
  }

  signalProcessGroup(pid, "SIGTERM");
  await wait(graceMs);
  signalProcessGroup(pid, "SIGKILL");
}
