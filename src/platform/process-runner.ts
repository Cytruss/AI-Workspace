import { spawn } from "node:child_process";
import { terminateProcessTree } from "./terminate-process-tree.js";

export interface ProcessRequest {
  command: string;
  args: string[];
  cwd: string;
  stdin?: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  maxOutputBytes: number;
  signal: AbortSignal;
}

export interface ProcessResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  termination: "exit" | "cancelled" | "timed_out" | "output_limit";
}

export class ProcessStartError extends Error {
  readonly code = "PROCESS_START_FAILED";

  constructor(cause: Error) {
    super(`Unable to start process: ${cause.message}`, { cause });
    this.name = "ProcessStartError";
  }
}

export async function runProcess(
  request: ProcessRequest,
): Promise<ProcessResult> {
  const startedAt = performance.now();
  const child = spawn(request.command, request.args, {
    cwd: request.cwd,
    detached: process.platform !== "win32",
    env: request.env,
    shell: false,
    stdio: "pipe",
    windowsHide: true,
  });

  return new Promise<ProcessResult>((resolve, reject) => {
    let settled = false;
    let termination: ProcessResult["termination"] = "exit";
    let terminationPromise: Promise<void> | undefined;
    let outputBytes = 0;
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    const timeout = setTimeout(() => {
      stop("timed_out");
    }, request.timeoutMs);

    const abort = () => {
      stop("cancelled");
    };

    const cleanup = () => {
      clearTimeout(timeout);
      request.signal.removeEventListener("abort", abort);
    };

    const stop = (reason: ProcessResult["termination"]) => {
      if (termination !== "exit") {
        return;
      }
      termination = reason;
      if (child.pid !== undefined) {
        terminationPromise = terminateProcessTree(child.pid, 100).catch(
          () => undefined,
        );
      }
    };

    const capture = (target: Buffer[]) => (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const remaining = request.maxOutputBytes - outputBytes;
      if (remaining > 0) {
        const captured = buffer.subarray(0, remaining);
        target.push(captured);
        outputBytes += captured.byteLength;
      }
      if (buffer.byteLength > remaining) {
        stop("output_limit");
      }
    };

    child.stdout.on("data", capture(stdout));
    child.stderr.on("data", capture(stderr));
    child.stdin.on("error", () => undefined);
    child.stdin.end(request.stdin);

    child.once("error", (error) => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(new ProcessStartError(error));
      }
    });

    child.once("close", (exitCode, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      void (terminationPromise ?? Promise.resolve()).then(() => {
        resolve({
          durationMs: performance.now() - startedAt,
          exitCode,
          signal,
          stderr: Buffer.concat(stderr).toString("utf8"),
          stdout: Buffer.concat(stdout).toString("utf8"),
          termination,
        });
      });
    });

    if (request.signal.aborted) {
      abort();
    } else {
      request.signal.addEventListener("abort", abort, { once: true });
    }
  });
}
