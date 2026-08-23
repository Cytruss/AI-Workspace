import { execFile } from "node:child_process";
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
      if (
        error instanceof Error &&
        "code" in error &&
        (error.code === "EPERM" || error.code === "EACCES")
      ) {
        return;
      }
      throw error;
    }

    await expect(validateProjectRoot(root)).resolves.toMatchObject({
      root: await realpath(root),
    });
  });
});
