import { execFile } from "node:child_process";

export interface GitIntegritySnapshot {
  porcelainV2: string;
}

function normalizeGitOutput(output: string): string {
  const normalized = output.replaceAll("\r\n", "\n");
  return normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized;
}

export async function captureGitIntegrity(
  root: string,
): Promise<GitIntegritySnapshot> {
  const porcelainV2 = await new Promise<string>((resolve, reject) => {
    execFile(
      "git",
      ["-C", root, "status", "--porcelain=v2", "--untracked-files=all"],
      { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
      (error, stdout) => {
        if (error !== null) {
          reject(
            error instanceof Error ? error : new Error("Git command failed"),
          );
          return;
        }
        resolve(normalizeGitOutput(stdout));
      },
    );
  });
  return { porcelainV2 };
}

export function assertGitIntegrityUnchanged(
  before: GitIntegritySnapshot,
  after: GitIntegritySnapshot,
): void {
  if (before.porcelainV2 !== after.porcelainV2) {
    throw new Error("Git integrity changed during the agent run");
  }
}
