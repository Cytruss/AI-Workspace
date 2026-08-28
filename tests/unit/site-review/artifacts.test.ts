import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  readReviewArtifact,
  writeReviewArtifact,
} from "../../../src/site-review/artifacts.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("writeReviewArtifact", () => {
  test("writes a hashed artifact below the review root and returns a relative path", async () => {
    const root = await mkdtemp(join(tmpdir(), "site-review-artifacts-"));
    directories.push(root);

    const artifact = await writeReviewArtifact({
      root,
      reviewId: "review-1",
      agentId: "codex",
      name: "desktop.png",
      content: Buffer.from("screenshot"),
    });

    expect(artifact.relativePath).toBe("review-1/codex/desktop.png");
    expect(artifact.sha256).toBe(
      "4441146b0fe1d5c6845af126ba5ce6003ea77d6b4cb04d14114f86a925c5dbca",
    );
    await expect(
      readFile(join(root, artifact.relativePath), "utf8"),
    ).resolves.toBe("screenshot");
  });

  test("rejects an artifact name that would escape its scoped directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "site-review-artifacts-"));
    directories.push(root);

    await expect(
      writeReviewArtifact({
        root,
        reviewId: "review-1",
        agentId: "codex",
        name: "../outside.txt",
        content: Buffer.from("x"),
      }),
    ).rejects.toThrow("artifact name");
  });

  test("reads only a stored artifact whose hash still matches", async () => {
    const root = await mkdtemp(join(tmpdir(), "site-review-artifacts-"));
    directories.push(root);
    const artifact = await writeReviewArtifact({
      root,
      reviewId: "review-1",
      agentId: "claude",
      name: "desktop.png",
      content: Buffer.from("screenshot"),
    });

    await expect(readReviewArtifact({ root, ...artifact })).resolves.toEqual(
      Buffer.from("screenshot"),
    );
    await expect(
      readReviewArtifact({
        root,
        relativePath: "review-1/claude/desktop.png",
        sha256: "0".repeat(64),
      }),
    ).rejects.toThrow("hash mismatch");
  });

  test("rejects an artifact path that is not a scoped relative path", async () => {
    await expect(
      readReviewArtifact({
        root: "C:/artifacts",
        relativePath: "../outside.png",
        sha256: "0".repeat(64),
      }),
    ).rejects.toThrow("relative path");
  });
});
