import { execFile, spawn } from "node:child_process";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  assertGitIntegrityUnchanged,
  captureGitIntegrity,
} from "../../../src/permissions/git-integrity.js";

const execute = promisify(execFile);

async function createCommittedRepository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "ai-workspace-integrity-"));
  await execute("git", ["init", "--quiet", root]);
  await execute("git", ["-C", root, "config", "user.name", "Test User"]);
  await execute("git", [
    "-C",
    root,
    "config",
    "user.email",
    "test@example.invalid",
  ]);
  await writeFile(join(root, "tracked.txt"), "before\n", "utf8");
  await execute("git", ["-C", root, "add", "tracked.txt"]);
  await execute("git", ["-C", root, "commit", "--quiet", "-m", "initial"]);
  return root;
}

async function writeRegularConflict(root: string, path: string): Promise<void> {
  const objectIds: string[] = [];
  for (const [index, content] of ["base", "ours", "theirs"].entries()) {
    const source = join(root, `stage-${String(index)}.txt`);
    await writeFile(source, content, "utf8");
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
      (objectId, index) => `100644 ${objectId} ${String(index + 1)}\t${path}\0`,
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

describe("Git integrity", () => {
  it("preserves and compares the exact pre-existing dirty state", async () => {
    const root = await createCommittedRepository();
    await writeFile(join(root, "already-untracked.txt"), "present", "utf8");
    const before = await captureGitIntegrity(root);
    const after = await captureGitIntegrity(root);

    expect(before.porcelainV2).toContain("already-untracked.txt");
    expect(() => {
      assertGitIntegrityUnchanged(before, after);
    }).not.toThrow();
  });

  it("detects a tracked edit whether unstaged or staged", async () => {
    const root = await createCommittedRepository();
    const before = await captureGitIntegrity(root);
    await writeFile(join(root, "tracked.txt"), "after\n", "utf8");
    const unstaged = await captureGitIntegrity(root);

    expect(() => {
      assertGitIntegrityUnchanged(before, unstaged);
    }).toThrow("Git integrity changed during the agent run");

    await execute("git", ["-C", root, "add", "tracked.txt"]);
    const staged = await captureGitIntegrity(root);
    expect(() => {
      assertGitIntegrityUnchanged(before, staged);
    }).toThrow("Git integrity changed during the agent run");
  });

  it("detects a new untracked file", async () => {
    const root = await createCommittedRepository();
    const before = await captureGitIntegrity(root);
    await writeFile(join(root, "new-file.txt"), "new", "utf8");
    const after = await captureGitIntegrity(root);

    expect(after.porcelainV2).toContain("new-file.txt");
    expect(() => {
      assertGitIntegrityUnchanged(before, after);
    }).toThrow("Git integrity changed during the agent run");
  });

  it("detects same-size changes to a file already dirty at baseline", async () => {
    const root = await createCommittedRepository();
    await writeFile(join(root, "tracked.txt"), "first\n", "utf8");
    const before = await captureGitIntegrity(root);
    await writeFile(join(root, "tracked.txt"), "other\n", "utf8");
    const after = await captureGitIntegrity(root);

    expect(after.porcelainV2).toBe(before.porcelainV2);
    expect(() => {
      assertGitIntegrityUnchanged(before, after);
    }).toThrow("Git integrity changed during the agent run");
  });

  it("detects changes to a pre-existing untracked file", async () => {
    const root = await createCommittedRepository();
    await writeFile(join(root, "untracked.txt"), "first", "utf8");
    const before = await captureGitIntegrity(root);
    await writeFile(join(root, "untracked.txt"), "other", "utf8");
    const after = await captureGitIntegrity(root);

    expect(after.porcelainV2).toBe(before.porcelainV2);
    expect(() => {
      assertGitIntegrityUnchanged(before, after);
    }).toThrow("Git integrity changed during the agent run");
  });

  it("detects changes to an already staged file", async () => {
    const root = await createCommittedRepository();
    await writeFile(join(root, "tracked.txt"), "first\n", "utf8");
    await execute("git", ["-C", root, "add", "tracked.txt"]);
    const before = await captureGitIntegrity(root);
    await writeFile(join(root, "tracked.txt"), "other\n", "utf8");
    await execute("git", ["-C", root, "add", "tracked.txt"]);
    const after = await captureGitIntegrity(root);

    expect(() => {
      assertGitIntegrityUnchanged(before, after);
    }).toThrow("Git integrity changed during the agent run");
  });

  it("detects same-status changes at a staged rename destination", async () => {
    const root = await createCommittedRepository();
    await execute("git", ["-C", root, "mv", "tracked.txt", "renamed file.txt"]);
    await writeFile(join(root, "renamed file.txt"), "first\n", "utf8");
    const before = await captureGitIntegrity(root);
    await writeFile(join(root, "renamed file.txt"), "other\n", "utf8");
    const after = await captureGitIntegrity(root);

    expect(after.porcelainV2).toBe(before.porcelainV2);
    expect(() => {
      assertGitIntegrityUnchanged(before, after);
    }).toThrow("Git integrity changed during the agent run");
  });

  it("detects same-status changes to an unmerged worktree file", async () => {
    const root = await createCommittedRepository();
    await writeRegularConflict(root, "tracked.txt");
    await writeFile(join(root, "tracked.txt"), "first", "utf8");
    const before = await captureGitIntegrity(root);
    await writeFile(join(root, "tracked.txt"), "other", "utf8");
    const after = await captureGitIntegrity(root);

    expect(after.porcelainV2).toBe(before.porcelainV2);
    expect(() => {
      assertGitIntegrityUnchanged(before, after);
    }).toThrow("Git integrity changed during the agent run");
  });

  it("restoring identical dirty content reproduces the baseline snapshot", async () => {
    const root = await createCommittedRepository();
    await writeFile(join(root, "tracked.txt"), "dirty\n", "utf8");
    await writeFile(join(root, "untracked.txt"), "local", "utf8");
    const before = await captureGitIntegrity(root);
    await writeFile(join(root, "tracked.txt"), "other\n", "utf8");
    await writeFile(join(root, "untracked.txt"), "other", "utf8");
    await writeFile(join(root, "tracked.txt"), "dirty\n", "utf8");
    await writeFile(join(root, "untracked.txt"), "local", "utf8");
    const restored = await captureGitIntegrity(root);

    expect(restored).toEqual(before);
  });

  it("fingerprints NUL-delimited odd filenames deterministically", async () => {
    const root = await createCommittedRepository();
    const oddName =
      process.platform === "win32"
        ? "odd name - [brackets] ü.txt"
        : "odd name\twith-newline\n.txt";
    const oddPath = join(root, oddName);
    await writeFile(oddPath, "first", "utf8");
    const before = await captureGitIntegrity(root);
    await writeFile(oddPath, "other", "utf8");
    const after = await captureGitIntegrity(root);

    expect(after.porcelainV2).toBe(before.porcelainV2);
    expect(() => {
      assertGitIntegrityUnchanged(before, after);
    }).toThrow("Git integrity changed during the agent run");
  });

  it("detects a changed pre-existing symbolic-link target", async () => {
    const root = await createCommittedRepository();
    const firstTarget = join(root, "first-target");
    const secondTarget = join(root, "other-target");
    const link = join(root, "untracked-link");
    await writeFile(firstTarget, "first", "utf8");
    await writeFile(secondTarget, "other", "utf8");
    try {
      await symlink(firstTarget, link, "file");
    } catch (error: unknown) {
      if (linkPermissionDenied(error)) {
        return;
      }
      throw error;
    }
    const before = await captureGitIntegrity(root);
    await rm(link);
    await symlink(secondTarget, link, "file");
    const after = await captureGitIntegrity(root);

    expect(after.porcelainV2).toBe(before.porcelainV2);
    expect(() => {
      assertGitIntegrityUnchanged(before, after);
    }).toThrow("Git integrity changed during the agent run");
  });

  it("fingerprints link text without following external target content", async () => {
    const root = await createCommittedRepository();
    const external = await mkdtemp(join(tmpdir(), "ai-workspace-link-target-"));
    const target = join(external, "target.txt");
    const link = join(root, "untracked-link");
    await writeFile(target, "first", "utf8");
    try {
      await symlink(target, link, "file");
    } catch (error: unknown) {
      if (linkPermissionDenied(error)) {
        return;
      }
      throw error;
    }
    const before = await captureGitIntegrity(root);
    await writeFile(target, "other", "utf8");
    const after = await captureGitIntegrity(root);

    expect(after).toEqual(before);
  });
});
