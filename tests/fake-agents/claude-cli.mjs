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
else
  process.stdout.write(
    JSON.stringify({
      is_error: false,
      result: JSON.stringify({ phase: "initial", claims: [], evidence: [] }),
      modelUsage: {
        "claude-opus-4-20250514": { input_tokens: 1, output_tokens: 1 },
      },
    }),
  );
