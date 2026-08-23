import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
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
});
