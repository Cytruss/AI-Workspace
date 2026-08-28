import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

const ScopeIdPattern = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ArtifactNamePattern = /^[a-z0-9][a-z0-9._-]{0,127}$/i;

export interface WriteReviewArtifactInput {
  root: string;
  reviewId: string;
  agentId: "codex" | "claude";
  name: string;
  content: Buffer;
}

export interface StoredReviewArtifact {
  relativePath: string;
  sha256: string;
}

export interface ReadReviewArtifactInput extends StoredReviewArtifact {
  root: string;
}

function requireScopeId(value: string, label: string): void {
  if (!ScopeIdPattern.test(value)) throw new Error(`Invalid ${label}`);
}

function requireArtifactName(value: string): void {
  if (!ArtifactNamePattern.test(value) || value.includes("..")) {
    throw new Error("Invalid artifact name");
  }
}

function pathFromRelativeArtifact(root: string, relativePath: string): string {
  const parts = relativePath.split("/");
  const [reviewId, agentId, name] = parts;
  if (
    parts.length !== 3 ||
    reviewId === undefined ||
    agentId === undefined ||
    name === undefined
  ) {
    throw new Error("Invalid artifact relative path");
  }
  requireScopeId(reviewId, "review ID");
  requireScopeId(agentId, "agent ID");
  requireArtifactName(name);
  const resolvedRoot = resolve(root);
  const filePath = resolve(resolvedRoot, reviewId, agentId, name);
  const difference = relative(resolvedRoot, filePath);
  if (
    difference === "" ||
    isAbsolute(difference) ||
    difference.startsWith("..")
  ) {
    throw new Error("Invalid artifact relative path");
  }
  return filePath;
}

export async function writeReviewArtifact(
  input: WriteReviewArtifactInput,
): Promise<StoredReviewArtifact> {
  requireScopeId(input.reviewId, "review ID");
  requireScopeId(input.agentId, "agent ID");
  requireArtifactName(input.name);
  const relativePath = `${input.reviewId}/${input.agentId}/${input.name}`;
  const directory = join(input.root, input.reviewId, input.agentId);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(join(directory, input.name), input.content, {
    flag: "wx",
    mode: 0o600,
  });
  return Object.freeze({
    relativePath,
    sha256: createHash("sha256").update(input.content).digest("hex"),
  });
}

export async function readReviewArtifact(
  input: ReadReviewArtifactInput,
): Promise<Buffer> {
  if (!/^[a-f0-9]{64}$/.test(input.sha256))
    throw new Error("Invalid artifact hash");
  const content = await readFile(
    pathFromRelativeArtifact(input.root, input.relativePath),
  );
  const actual = createHash("sha256").update(content).digest("hex");
  if (actual !== input.sha256) throw new Error("Artifact hash mismatch");
  return content;
}
