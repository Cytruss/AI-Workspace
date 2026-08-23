import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, parse, relative, resolve, sep } from "node:path";

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
  try {
    return await realpath(target);
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTDIR")
    ) {
      return target;
    }
    throw error;
  }
}

async function assertTrackedSymlinksStayInside(root: string): Promise<void> {
  const index = await runGit(root, ["ls-files", "--stage", "-z"]);
  const links: string[] = [];
  for (const record of index.split("\0")) {
    const tab = record.indexOf("\t");
    if (tab === -1) {
      continue;
    }
    const metadata = record.slice(0, tab).split(" ");
    if (metadata[0] === "120000" && metadata[2] === "0") {
      links.push(record.slice(tab + 1));
    }
  }

  for (const link of links) {
    const storedTarget = await runGit(root, ["cat-file", "blob", `:${link}`]);
    const target = resolve(root, dirname(link), storedTarget);
    let canonicalTarget: string;
    try {
      canonicalTarget = await canonicalizeTarget(target);
    } catch (error: unknown) {
      throw new ProjectRootError(
        "PROJECT_ROOT_INVALID",
        "Project root contains an unreadable Git-tracked symbolic link",
        { cause: error },
      );
    }
    if (!isInside(root, canonicalTarget)) {
      throw new ProjectRootError(
        "PROJECT_EXTERNAL_SYMLINK",
        "Project root contains a Git-tracked symbolic link outside the project root",
      );
    }
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
