import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

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

function requireScopeId(value: string, label: string): void {
  if (!ScopeIdPattern.test(value)) throw new Error(`Invalid ${label}`);
}

function requireArtifactName(value: string): void {
  if (!ArtifactNamePattern.test(value) || value.includes("..")) {
    throw new Error("Invalid artifact name");
  }
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
