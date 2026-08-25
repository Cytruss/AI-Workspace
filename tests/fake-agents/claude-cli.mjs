/* global process, setInterval */

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
if (args[0] === "--version") process.stdout.write("2.1.233");
else if (args.includes("--help"))
  process.stdout.write(
    "--bare --settings --tools --disallowedTools --permission-mode --no-session-persistence -p --output-format --json-schema --model --effort modelUsage --effort values: low|high",
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
  const schema = args[args.indexOf("--json-schema") + 1];
  const phase = schema.includes('"cross-examination"')
    ? "cross-examination"
    : schema.includes('"final"')
      ? "final"
      : "initial";
  if (phase === "final" && prompt.topic === "mixed-final-cancellation") {
    setInterval(() => undefined, 1_000);
  }
  const result =
    phase === "initial"
      ? {
          phase,
          claims:
            prompt.phase === "initial"
              ? [
                  {
                    localId: "claude-claim",
                    text: "A material claim",
                    material: true,
                    evidenceLocalIds: [],
                  },
                ]
              : [],
          evidence: [],
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
        };
  const modelUsage =
    stdin === "NO_OBSERVATION"
      ? {}
      : {
          [stdin === "CROSS_CLASS"
            ? "claude-sonnet-4"
            : "claude-opus-4-20250514"]: { input_tokens: 1, output_tokens: 1 },
        };
  process.stdout.write(
    JSON.stringify({
      is_error: false,
      result: JSON.stringify(result),
      modelUsage,
    }),
  );
}
