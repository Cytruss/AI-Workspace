import { execFile } from "node:child_process";
import { lstat, readlink, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  parse,
  relative,
  resolve,
  sep,
} from "node:path";

export interface ValidatedProjectRoot {
  root: string;
  gitTopLevel: string;
}

export type ProjectRootErrorCode =
  "PROJECT_ROOT_INVALID" | "PROJECT_EXTERNAL_SYMLINK";

export class ProjectRootError extends Error {
  constructor(
    public readonly code: ProjectRootErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ProjectRootError";
  }
}

function runGit(root: string, arguments_: readonly string[]): Promise<string> {
  return new Promise((resolveOutput, reject) => {
    execFile(
      "git",
      ["-C", root, ...arguments_],
      { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
      (error, stdout) => {
        if (error !== null) {
          reject(
            error instanceof Error ? error : new Error("Git command failed"),
          );
          return;
        }
        resolveOutput(stdout);
      },
    );
  });
}

function runGitBuffer(
  root: string,
  arguments_: readonly string[],
): Promise<Buffer> {
  return new Promise((resolveOutput, reject) => {
    execFile(
      "git",
      ["-C", root, ...arguments_],
      { encoding: "buffer", maxBuffer: 10 * 1024 * 1024 },
      (error, stdout) => {
        if (error !== null) {
          reject(
            error instanceof Error ? error : new Error("Git command failed"),
          );
          return;
        }
        resolveOutput(stdout);
      },
    );
  });
}

function pathsEqual(first: string, second: string): boolean {
  return relative(first, second) === "";
}

function isInside(root: string, target: string): boolean {
  const difference = relative(root, target);
  return (
    difference === "" ||
    (difference !== ".." &&
      !difference.startsWith(`..${sep}`) &&
      !isAbsolute(difference))
  );
}

async function canonicalizeTarget(target: string): Promise<string> {
  const suffix: string[] = [];
  let candidate = target;
  for (;;) {
    try {
      const canonicalAncestor = await realpath(candidate);
      return resolve(canonicalAncestor, ...suffix);
    } catch (error: unknown) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        (error.code === "ENOENT" || error.code === "ENOTDIR")
      )) {
        throw error;
      }
      const parent = dirname(candidate);
      if (parent === candidate) {
        throw error;
      }
      suffix.unshift(basename(candidate));
      candidate = parent;
    }
  }
}

function decodeLinkTarget(target: Buffer): string {
  if (target.length === 0 || target.includes(0)) {
    throw new Error("Git-tracked symbolic link has a malformed target");
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(target);
}

interface IndexEntry {
  mode: string;
  objectId: string;
  stage: string;
  path: string;
}

async function readIndexEntries(root: string): Promise<IndexEntry[]> {
  const index = new TextDecoder("utf-8", { fatal: true }).decode(
    await runGitBuffer(root, ["ls-files", "--stage", "-z"]),
  );
  const entries: IndexEntry[] = [];
  for (const record of index.split("\0")) {
    if (record === "") {
      continue;
    }
    const tab = record.indexOf("\t");
    const match = /^(\d{6}) ([0-9a-f]+) ([0-3])$/.exec(
      tab === -1 ? "" : record.slice(0, tab),
    );
    if (tab === -1 || match === null) {
      throw new Error("Git returned a malformed index entry");
    }
    entries.push({
      mode: match[1] ?? "",
      objectId: match[2] ?? "",
      stage: match[3] ?? "",
      path: record.slice(tab + 1),
    });
  }
  return entries;
}

async function assertTargetInside(
  root: string,
  linkPath: string,
  storedTarget: Buffer,
): Promise<void> {
  const linkTarget = decodeLinkTarget(storedTarget);
  const target = resolve(root, dirname(linkPath), linkTarget);
  const canonicalTarget = await canonicalizeTarget(target);
  if (!isInside(root, canonicalTarget)) {
    throw new ProjectRootError(
      "PROJECT_EXTERNAL_SYMLINK",
      "Project root contains a Git-tracked symbolic link outside the project root",
    );
  }
}

async function assertEffectiveWorktreeLinkInside(
  root: string,
  linkPath: string,
): Promise<void> {
  const path = resolve(root, linkPath);
  let status: Awaited<ReturnType<typeof lstat>>;
  try {
    status = await lstat(path);
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
  if (!status.isSymbolicLink()) {
    return;
  }
  const target = await readlink(path, { encoding: "buffer" });
  await assertTargetInside(root, linkPath, target);
}

async function assertTrackedSymlinksStayInside(root: string): Promise<void> {
  const entries = await readIndexEntries(root);
  const trackedPaths = new Set<string>();
  for (const entry of entries) {
    trackedPaths.add(entry.path);
    if (entry.mode === "120000") {
      const storedTarget = await runGitBuffer(root, [
        "cat-file",
        "blob",
        entry.objectId,
      ]);
      await assertTargetInside(root, entry.path, storedTarget);
    }
  }
  for (const trackedPath of trackedPaths) {
    await assertEffectiveWorktreeLinkInside(root, trackedPath);
  }
}

export async function validateProjectRoot(
  root: string,
): Promise<ValidatedProjectRoot> {
  let canonicalRoot: string;
  try {
    canonicalRoot = await realpath(root);
  } catch (error: unknown) {
    throw new ProjectRootError(
      "PROJECT_ROOT_INVALID",
      "Project root must be an existing directory",
      { cause: error },
    );
  }

  const canonicalHome = await realpath(homedir());
  if (pathsEqual(canonicalRoot, canonicalHome)) {
    throw new ProjectRootError(
      "PROJECT_ROOT_INVALID",
      "Project root cannot be the user home directory",
    );
  }
  if (pathsEqual(canonicalRoot, parse(canonicalRoot).root)) {
    throw new ProjectRootError(
      "PROJECT_ROOT_INVALID",
      "Project root cannot be a filesystem root",
    );
  }

  let gitTopLevel: string;
  try {
    const reportedTopLevel = (
      await runGit(canonicalRoot, ["rev-parse", "--show-toplevel"])
    ).trimEnd();
    gitTopLevel = await realpath(reportedTopLevel);
  } catch (error: unknown) {
    throw new ProjectRootError(
      "PROJECT_ROOT_INVALID",
      "Project root must be a Git worktree",
      { cause: error },
    );
  }
  if (!pathsEqual(canonicalRoot, gitTopLevel)) {
    throw new ProjectRootError(
      "PROJECT_ROOT_INVALID",
      "Project root must be a Git worktree",
    );
  }

  try {
    await assertTrackedSymlinksStayInside(canonicalRoot);
  } catch (error: unknown) {
    if (error instanceof ProjectRootError) {
      throw error;
    }
    throw new ProjectRootError(
      "PROJECT_ROOT_INVALID",
      "Project root Git index could not be inspected",
      { cause: error },
    );
  }

  return { root: canonicalRoot, gitTopLevel };
}
