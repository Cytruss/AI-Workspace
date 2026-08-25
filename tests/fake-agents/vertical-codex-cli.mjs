/* global process, setInterval */

import { readFile } from "node:fs/promises";

const args = process.argv.slice(2);
const stdin = await new Promise((resolve, reject) => {
  let text = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    text += chunk;
  });
  process.stdin.once("end", () => resolve(text));
  process.stdin.once("error", reject);
});

function initial(provider, topic) {
  if (
    topic === "vertical-invalid-claim-namespace" ||
    topic === "vertical-invalid-evidence-namespace"
  ) {
    const claimLocalId =
      topic === "vertical-invalid-claim-namespace"
        ? "claim-0001"
        : "provider-claim";
    const evidenceLocalId =
      topic === "vertical-invalid-evidence-namespace"
        ? "evidence-0001"
        : "provider-evidence";
    return {
      phase: "initial",
      claims: [
        {
          localId: claimLocalId,
          text: "Canonical namespace intrusion",
          material: true,
          evidenceLocalIds: [evidenceLocalId],
        },
      ],
      evidence: [{ localId: evidenceLocalId, trackedPath: "README.md" }],
    };
  }
  if (topic !== "vertical-exhaustive") {
    return {
      phase: "initial",
      claims: [
        {
          localId: `${provider}-claim`,
          text: "A material claim",
          material: true,
          evidenceLocalIds: [],
        },
      ],
      evidence: [],
    };
  }
  return {
    phase: "initial",
    claims: [
      {
        localId: "shared-claim-a",
        text: "A verified consensus",
        material: true,
        evidenceLocalIds: ["verified-evidence-local"],
      },
      {
        localId: "shared-claim-b",
        text: "B unsupported consensus",
        material: true,
        evidenceLocalIds: [],
      },
      {
        localId: "shared-claim-c",
        text: "C disagreement",
        material: true,
        evidenceLocalIds: ["missing-evidence-local"],
      },
      {
        localId: "shared-claim-d",
        text: "D rejected",
        material: true,
        evidenceLocalIds: ["invalid-evidence-local"],
      },
      {
        localId: "shared-claim-e",
        text: "E unresolved",
        material: true,
        evidenceLocalIds: [],
      },
    ],
    evidence: [
      { localId: "verified-evidence-local", trackedPath: "README.md" },
      { localId: "missing-evidence-local", trackedPath: "missing.txt" },
      {
        localId: "invalid-evidence-local",
        trackedPath: "README.md",
        contentHash: "invalid",
      },
    ],
  };
}

function later(provider, phase, prompt) {
  const reviewClaimIds = Array.isArray(prompt.reviewClaimIds)
    ? prompt.reviewClaimIds
    : [];
  const values =
    phase === "final"
      ? provider === "codex"
        ? ["ACCEPT", "ACCEPT", "ACCEPT", "DISPUTE", "UNCERTAIN"]
        : ["ACCEPT", "ACCEPT", "DISPUTE", "DISPUTE", "ACCEPT"]
      : reviewClaimIds.map(() => "ACCEPT");
  const includeEvidence =
    phase === "cross-examination" && prompt.topic === "vertical-exhaustive";
  return {
    phase,
    stances: reviewClaimIds.map((claimId, index) => ({
      claimId,
      value: values[index] ?? "UNCERTAIN",
      reasoning:
        includeEvidence && index === 0
          ? "cross evidence linked"
          : "deterministic fixture stance",
      existingEvidenceIds: [],
      newEvidenceLocalIds:
        includeEvidence && index === 0 ? ["cross-evidence-local"] : [],
    })),
    newEvidence: includeEvidence
      ? [
          {
            localId: "cross-evidence-local",
            trackedPath: "README.md",
            lineStart: 1,
            lineEnd: 1,
          },
        ]
      : [],
    ...(prompt.topic === "vertical-forbidden-later-claim"
      ? {
          claims: [
            {
              localId: "forbidden-claim",
              text: "Later phases cannot add claims",
              material: true,
              evidenceLocalIds: [],
            },
          ],
        }
      : {}),
  };
}

if (args[0] === "--version") {
  process.stdout.write("0.76.0");
} else if (args.includes("--help")) {
  process.stdout.write(
    "--ephemeral --ignore-user-config --ignore-rules --json --output-schema --sandbox --model --config -C model_reasoning_effort=low|high",
  );
} else if (stdin === "HANG") {
  setInterval(() => undefined, 1_000);
} else {
  let prompt = {};
  try {
    prompt = JSON.parse(stdin);
  } catch {
    // Direct lifecycle inputs may be inert strings.
  }
  const schema = await readFile(
    args[args.indexOf("--output-schema") + 1],
    "utf8",
  );
  const phase = schema.includes('"cross-examination"')
    ? "cross-examination"
    : schema.includes('"final"')
      ? "final"
      : schema.includes('"ask"')
        ? "ask"
        : "initial";
  const response =
    phase === "ask"
      ? { phase: "ask", content: "Codex fixture answer" }
      : phase === "initial"
        ? initial("codex", prompt.topic)
        : later("codex", phase, prompt);
  process.stdout.write(
    `${JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: JSON.stringify(response) } })}\n${JSON.stringify({ type: "turn.completed" })}\n`,
  );
}
