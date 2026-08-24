import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, normalize, relative, resolve, sep } from "node:path";
import type { ProviderEvidenceDraft } from "../agents/structured-response.js";
import type { EvidenceStatus } from "./types.js";

export interface ResolvedEvidence {
  trackedPath: string;
  lineStart?: number;
  lineEnd?: number;
  expectedHash?: string;
  resolvedHash?: string;
  status: EvidenceStatus;
}

function gitTracked(root: string, path: string): Promise<boolean> {
  return new Promise((resolveResult) => {
    execFile(
      "git",
      ["-C", root, "ls-files", "--error-unmatch", "--", path],
      { encoding: "utf8" },
      (error) => {
        resolveResult(error === null);
      },
    );
  });
}

function inside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return (
    path !== "" &&
    !path.startsWith(`..${sep}`) &&
    path !== ".." &&
    !isAbsolute(path)
  );
}

function fields(
  draft: Pick<ProviderEvidenceDraft, "lineStart" | "lineEnd" | "contentHash">,
): Pick<ResolvedEvidence, "lineStart" | "lineEnd" | "expectedHash"> {
  return {
    ...(draft.lineStart === undefined || draft.lineEnd === undefined
      ? {}
      : { lineStart: draft.lineStart, lineEnd: draft.lineEnd }),
    ...(draft.contentHash === undefined
      ? {}
      : { expectedHash: draft.contentHash }),
  };
}

/** Resolves citation bytes only; VERIFIED never asserts a claim's semantic truth. */
export async function resolveEvidence(
  root: string,
  draft: Pick<
    ProviderEvidenceDraft,
    "trackedPath" | "lineStart" | "lineEnd" | "contentHash"
  >,
): Promise<ResolvedEvidence> {
  const trackedPath = normalize(draft.trackedPath)
    .replaceAll("\\", "/")
    .replace(/^\.\//, "");
  if (
    trackedPath.length === 0 ||
    isAbsolute(trackedPath) ||
    draft.lineStart === 0 ||
    (draft.lineStart === undefined) !== (draft.lineEnd === undefined) ||
    (draft.lineStart !== undefined &&
      (draft.lineEnd === undefined || draft.lineEnd < draft.lineStart))
  ) {
    return { trackedPath, ...fields(draft), status: "INVALID" };
  }
  const rootPath = resolve(root);
  const absolutePath = resolve(rootPath, trackedPath);
  if (
    !inside(rootPath, absolutePath) ||
    !(await gitTracked(rootPath, trackedPath))
  ) {
    return { trackedPath, ...fields(draft), status: "INVALID" };
  }
  let source: Buffer;
  try {
    source = await readFile(absolutePath);
  } catch {
    return { trackedPath, ...fields(draft), status: "MISSING" };
  }
  let bytes = source;
  if (draft.lineStart !== undefined && draft.lineEnd !== undefined) {
    const lines = source.toString("utf8").split(/\r?\n/);
    if (draft.lineEnd > lines.length) {
      return {
        trackedPath,
        lineStart: draft.lineStart,
        lineEnd: draft.lineEnd,
        ...(draft.contentHash === undefined
          ? {}
          : { expectedHash: draft.contentHash }),
        status: "INVALID",
      };
    }
    bytes = Buffer.from(
      lines.slice(draft.lineStart - 1, draft.lineEnd).join("\n"),
      "utf8",
    );
  }
  const resolvedHash = createHash("sha256").update(bytes).digest("hex");
  const status =
    draft.contentHash !== undefined &&
    draft.contentHash.toLowerCase() !== resolvedHash
      ? "INVALID"
      : "VERIFIED";
  return { trackedPath, ...fields(draft), resolvedHash, status };
}
