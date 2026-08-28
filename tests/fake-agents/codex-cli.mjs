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
if (args[0] === "--version") process.stdout.write("0.76.0");
else if (args.includes("--help"))
  process.stdout.write(
    "--ephemeral --ignore-user-config --ignore-rules --json --output-schema --sandbox --model --config -C model_reasoning_effort=low|high",
  );
else if (stdin === "HANG") setInterval(() => undefined, 1_000);
else if (stdin === "OVERSIZE") process.stdout.write("x".repeat(8_192));
else {
  let prompt = {};
  try {
    prompt = JSON.parse(stdin);
  } catch {
    // Adapter lifecycle tests intentionally send inert non-JSON prompts.
  }
  const schema = await readFile(
    args[args.indexOf("--output-schema") + 1],
    "utf8",
  );
  const phase = schema.includes('"cross-examination"')
    ? "cross-examination"
    : schema.includes('"final"')
      ? "final"
      : "initial";
  const response = JSON.stringify(
    phase === "initial"
      ? {
          phase,
          claims:
            prompt.phase === "initial"
              ? [
                  {
                    localId: "codex-claim",
                    text: "A material claim",
                    material: true,
                    evidenceLocalIds: [],
                  },
                ]
              : [],
          evidence:
            stdin === "NULL_OPTIONALS"
              ? [
                  {
                    localId: "codex-evidence",
                    trackedPath: "src/example.ts",
                    lineStart: null,
                    lineEnd: null,
                  },
                ]
              : [],
        }
      : {
          phase,
          stances: Array.isArray(prompt.reviewClaimIds)
            ? prompt.reviewClaimIds.map((claimId) => ({
                claimId,
                value: "ACCEPT",
                reasoning: "supported",
                existingEvidenceIds: [],
                newEvidenceLocalIds: [],
              }))
            : [],
          newEvidence: [],
        },
  );
  process.stdout.write(
    `${JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: response } })}\n${JSON.stringify({ type: "turn.completed" })}\n`,
  );
}
