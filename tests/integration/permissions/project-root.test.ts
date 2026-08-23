import { execFile, spawn } from "node:child_process";
import { mkdtemp, mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, parse, relative } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { validateProjectRoot } from "../../../src/permissions/project-root.js";

const execute = promisify(execFile);

async function createRepository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "ai-workspace-project-"));
  await execute("git", ["init", "--quiet", root]);
  return root;
}

async function addIndexSymlink(
  root: string,
  trackedPath: string,
  target: string,
): Promise<void> {
  const source = join(root, "link-target.txt");
  await writeFile(source, target, "utf8");
  const { stdout: objectId } = await execute("git", [
    "-C",
    root,
    "hash-object",
    "-w",
    source,
  ]);
  await execute("git", [
    "-C",
    root,
    "update-index",
    "--add",
    "--cacheinfo",
    `120000,${objectId.trim()},${trackedPath}`,
  ]);
}

async function writeConflictStages(
  root: string,
  trackedPath: string,
  targets: readonly [string, string, string],
): Promise<void> {
  const objectIds: string[] = [];
  for (const [index, target] of targets.entries()) {
    const source = join(root, `conflict-target-${String(index)}.txt`);
    await writeFile(source, target, "utf8");
    const { stdout } = await execute("git", [
      "-C",
      root,
      "hash-object",
      "-w",
      source,
    ]);
    objectIds.push(stdout.trim());
  }
  const input = objectIds
    .map(
      (objectId, index) =>
        `120000 ${objectId} ${String(index + 1)}\t${trackedPath}\0`,
    )
    .join("");
  await new Promise<void>((resolveInput, reject) => {
    const child = spawn(
      "git",
      ["-C", root, "update-index", "-z", "--index-info"],
      { stdio: ["pipe", "ignore", "pipe"] },
    );
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolveInput();
      } else {
        reject(new Error(`git update-index failed: ${stderr}`));
      }
    });
    child.stdin.end(input);
  });
}

function linkPermissionDenied(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "EPERM" || error.code === "EACCES")
  );
}

describe("validateProjectRoot", () => {
  it("returns the canonical root for a Git worktree", async () => {
    const root = await createRepository();
    const canonicalRoot = await realpath(root);

    await expect(validateProjectRoot(root)).resolves.toEqual({
      root: canonicalRoot,
      gitTopLevel: canonicalRoot,
    });
  });

  it("rejects the user home directory and filesystem roots", async () => {
    await expect(validateProjectRoot(homedir())).rejects.toThrow(
      "Project root cannot be the user home directory",
    );
    await expect(validateProjectRoot(parse(homedir()).root)).rejects.toThrow(
      "Project root cannot be a filesystem root",
    );
  });

  it("rejects a non-Git directory and a directory below a worktree root", async () => {
    const nonGit = await mkdtemp(join(tmpdir(), "ai-workspace-non-git-"));
    await expect(validateProjectRoot(nonGit)).rejects.toThrow(
      "Project root must be a Git worktree",
    );

    const root = await createRepository();
    const nested = join(root, "nested");
    await mkdir(nested);
    await expect(validateProjectRoot(nested)).rejects.toThrow(
      "Project root must be a Git worktree",
    );
  });

  it("rejects a Git-tracked symbolic link whose canonical target escapes", async () => {
    const root = await createRepository();
    const external = await mkdtemp(join(tmpdir(), "ai-workspace-external-"));
    const target = join(external, "secret.txt");
    await writeFile(target, "secret", "utf8");
    await addIndexSymlink(root, "tracked-link", relative(root, target));

    await expect(validateProjectRoot(root)).rejects.toMatchObject({
      code: "PROJECT_EXTERNAL_SYMLINK",
    });
  });

  it("accepts a tracked symbolic link to an in-root dot-prefixed directory", async () => {
    const root = await createRepository();
    const internalDirectory = join(root, "..safe");
    const target = join(internalDirectory, "target.txt");
    await mkdir(internalDirectory);
    await writeFile(target, "safe", "utf8");
    await addIndexSymlink(root, "tracked-link", "..safe/target.txt");

    await expect(validateProjectRoot(root)).resolves.toMatchObject({
      root: await realpath(root),
    });
  });

  it("validates every symbolic-link blob in conflict stages", async () => {
    for (const externalStage of [0, 1, 2]) {
      const root = await createRepository();
      const external = await mkdtemp(join(tmpdir(), "ai-workspace-external-"));
      const targets: [string, string, string] = [
        "safe-one",
        "safe-two",
        "safe-three",
      ];
      targets[externalStage] = relative(root, join(external, "escaped"));
      await writeConflictStages(root, "conflicted-link", targets);

      await expect(validateProjectRoot(root)).rejects.toMatchObject({
        code: "PROJECT_EXTERNAL_SYMLINK",
      });
    }

    const safeRoot = await createRepository();
    await writeConflictStages(safeRoot, "conflicted-link", [
      "safe-one",
      "safe-two",
      "safe-three",
    ]);
    await expect(validateProjectRoot(safeRoot)).resolves.toMatchObject({
      root: await realpath(safeRoot),
    });
  });

  it("rejects an effective external worktree link for a safe stage-zero blob", async () => {
    const root = await createRepository();
    const external = await mkdtemp(join(tmpdir(), "ai-workspace-external-"));
    await addIndexSymlink(root, "tracked-link", "safe-target");
    try {
      await symlink(external, join(root, "tracked-link"), "junction");
    } catch (error: unknown) {
      if (linkPermissionDenied(error)) {
        return;
      }
      throw error;
    }

    await expect(validateProjectRoot(root)).rejects.toMatchObject({
      code: "PROJECT_EXTERNAL_SYMLINK",
    });
  });

  it("accepts a safe effective worktree link for a stage-zero blob", async () => {
    const root = await createRepository();
    const internal = join(root, "internal-target");
    await mkdir(internal);
    await addIndexSymlink(root, "tracked-link", "internal-target");
    try {
      await symlink(internal, join(root, "tracked-link"), "junction");
    } catch (error: unknown) {
      if (linkPermissionDenied(error)) {
        return;
      }
      throw error;
    }

    await expect(validateProjectRoot(root)).resolves.toMatchObject({
      root: await realpath(root),
    });
  });

  it("rejects an effective external worktree link at an unmerged path", async () => {
    const root = await createRepository();
    const external = await mkdtemp(join(tmpdir(), "ai-workspace-external-"));
    await writeConflictStages(root, "conflicted-link", [
      "safe-one",
      "safe-two",
      "safe-three",
    ]);
    try {
      await symlink(external, join(root, "conflicted-link"), "junction");
    } catch (error: unknown) {
      if (linkPermissionDenied(error)) {
        return;
      }
      throw error;
    }

    await expect(validateProjectRoot(root)).rejects.toMatchObject({
      code: "PROJECT_EXTERNAL_SYMLINK",
    });
  });

  it("canonicalizes a dangling target through an external junction ancestor", async () => {
    const root = await createRepository();
    const external = await mkdtemp(join(tmpdir(), "ai-workspace-external-"));
    try {
      await symlink(external, join(root, "redirect"), "junction");
    } catch (error: unknown) {
      if (linkPermissionDenied(error)) {
        return;
      }
      throw error;
    }
    await addIndexSymlink(root, "tracked-link", "redirect/missing/target");

    await expect(validateProjectRoot(root)).rejects.toMatchObject({
      code: "PROJECT_EXTERNAL_SYMLINK",
    });
  });

  it("fails closed for a malformed tracked symbolic-link target", async () => {
    const root = await createRepository();
    await addIndexSymlink(root, "tracked-link", "");

    await expect(validateProjectRoot(root)).rejects.toMatchObject({
      code: "PROJECT_ROOT_INVALID",
    });
  });

  it("does not recursively reject untracked or dependency-manager links", async () => {
    const root = await createRepository();
    const external = await mkdtemp(join(tmpdir(), "ai-workspace-external-"));
    const packageStore = join(root, "node_modules", ".pnpm", "pkg");
    await mkdir(packageStore, { recursive: true });

    try {
      await symlink(external, join(root, "untracked-link"), "junction");
      await symlink(
        packageStore,
        join(root, "node_modules", "pkg"),
        "junction",
      );
    } catch (error: unknown) {
      if (linkPermissionDenied(error)) {
        return;
      }
      throw error;
    }

    await expect(validateProjectRoot(root)).resolves.toMatchObject({
      root: await realpath(root),
    });
  });
});
