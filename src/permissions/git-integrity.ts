import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readlink } from "node:fs/promises";
import { resolve } from "node:path";

export interface GitIntegritySnapshot {
  porcelainV2: string;
  dirtyPathFingerprints: string;
}

export type GitIntegrityErrorCode = "GIT_INTEGRITY_UNSUPPORTED_DIRECTORY";

export class GitIntegrityError extends Error {
  constructor(
    public readonly code: GitIntegrityErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GitIntegrityError";
  }
}

function runStatus(root: string): Promise<string> {
  return new Promise((resolveOutput, reject) => {
    execFile(
      "git",
      ["-C", root, "status", "--porcelain=v2", "--untracked-files=all", "-z"],
      { encoding: "buffer", maxBuffer: 10 * 1024 * 1024 },
      (error, stdout) => {
        if (error !== null) {
          reject(
            error instanceof Error ? error : new Error("Git command failed"),
          );
          return;
        }
        resolveOutput(new TextDecoder("utf-8", { fatal: true }).decode(stdout));
      },
    );
  });
}

function fieldAfterSpaces(record: string, count: number): string {
  let offset = -1;
  for (let index = 0; index < count; index += 1) {
    offset = record.indexOf(" ", offset + 1);
    if (offset === -1) {
      throw new Error("Git returned malformed porcelain-v2 status");
    }
  }
  return record.slice(offset + 1);
}

function dirtyPaths(porcelainV2: string): string[] {
  const records = porcelainV2.split("\0");
  const paths = new Set<string>();
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record === undefined || record === "") {
      continue;
    }
    if (record.startsWith("1 ")) {
      paths.add(fieldAfterSpaces(record, 8));
    } else if (record.startsWith("2 ")) {
      paths.add(fieldAfterSpaces(record, 9));
      const originalPath = records[index + 1];
      if (originalPath === undefined || originalPath === "") {
        throw new Error("Git returned malformed rename status");
      }
      paths.add(originalPath);
      index += 1;
    } else if (record.startsWith("u ")) {
      paths.add(fieldAfterSpaces(record, 10));
    } else if (record.startsWith("? ")) {
      paths.add(record.slice(2));
    } else if (!record.startsWith("# ")) {
      throw new Error("Git returned an unsupported porcelain-v2 status entry");
    }
  }
  return [...paths].sort((first, second) =>
    Buffer.compare(Buffer.from(first), Buffer.from(second)),
  );
}

function sameStat(
  first: Awaited<ReturnType<typeof lstat>>,
  second: Awaited<ReturnType<typeof lstat>>,
): boolean {
  return (
    first.dev === second.dev &&
    first.ino === second.ino &&
    first.mode === second.mode &&
    first.size === second.size &&
    first.mtimeMs === second.mtimeMs &&
    first.ctimeMs === second.ctimeMs
  );
}

async function fingerprintPath(
  path: string,
  projectPath: string,
): Promise<string> {
  let before: Awaited<ReturnType<typeof lstat>>;
  try {
    before = await lstat(path);
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return "missing";
    }
    throw new Error(`Cannot inspect dirty project path: ${projectPath}`, {
      cause: error,
    });
  }

  if (before.isDirectory()) {
    throw new GitIntegrityError(
      "GIT_INTEGRITY_UNSUPPORTED_DIRECTORY",
      `Git integrity cannot safely snapshot dirty directory: ${projectPath}. Remove or explicitly register the nested repository before running an agent.`,
    );
  }

  const hash = createHash("sha256");
  if (before.isSymbolicLink()) {
    const target = await readlink(path, { encoding: "buffer" });
    hash.update("symbolic-link\0");
    hash.update(target);
  } else if (before.isFile()) {
    hash.update("regular-file\0");
    for await (const chunk of createReadStream(path)) {
      hash.update(chunk as Buffer);
    }
  } else {
    throw new Error(`Unsupported dirty project path type: ${projectPath}`);
  }

  let after: Awaited<ReturnType<typeof lstat>>;
  try {
    after = await lstat(path);
  } catch (error: unknown) {
    throw new Error(
      `Dirty project path changed while being inspected: ${projectPath}`,
      {
        cause: error,
      },
    );
  }
  if (!sameStat(before, after)) {
    throw new Error(
      `Dirty project path changed while being inspected: ${projectPath}`,
    );
  }
  return hash.digest("hex");
}

async function captureFingerprints(
  root: string,
  porcelainV2: string,
): Promise<string> {
  const fingerprints: Array<readonly [string, string]> = [];
  for (const path of dirtyPaths(porcelainV2)) {
    fingerprints.push([path, await fingerprintPath(resolve(root, path), path)]);
  }
  return JSON.stringify(fingerprints);
}

export async function captureGitIntegrity(
  root: string,
): Promise<GitIntegritySnapshot> {
  const porcelainV2 = await runStatus(root);
  return {
    porcelainV2,
    dirtyPathFingerprints: await captureFingerprints(root, porcelainV2),
  };
}

export function assertGitIntegrityUnchanged(
  before: GitIntegritySnapshot,
  after: GitIntegritySnapshot,
): void {
  if (
    before.porcelainV2 !== after.porcelainV2 ||
    before.dirtyPathFingerprints !== after.dirtyPathFingerprints
  ) {
    throw new Error("Git integrity changed during the agent run");
  }
}
