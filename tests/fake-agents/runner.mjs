/* global URL, process, setInterval */

import { appendFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const [mode, terminationPath] = process.argv.slice(2);

async function recordTermination() {
  if (terminationPath) {
    await appendFile(terminationPath, "terminated\n", "utf8");
  }
}

process.once("SIGTERM", () => {
  void recordTermination().finally(() => process.exit(0));
});

process.once("SIGINT", () => {
  void recordTermination().finally(() => process.exit(0));
});

const stdin = await new Promise((resolve, reject) => {
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    input += chunk;
  });
  process.stdin.once("end", () => resolve(input));
  process.stdin.once("error", reject);
});

switch (mode) {
  case "success":
    process.stdout.write(`${JSON.stringify({ stdin })}\n`);
    break;
  case "stderr":
    process.stderr.write("deterministic stderr\n");
    break;
  case "fail":
    process.stderr.write("deterministic failure\n");
    process.exitCode = 17;
    break;
  case "oversize":
    process.stdout.write("x".repeat(8_192));
    break;
  case "hang":
    setInterval(() => undefined, 1_000);
    break;
  case "spawn-child": {
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(new URL("./grandchild.mjs", import.meta.url)),
        terminationPath,
      ],
      { stdio: "ignore" },
    );
    child.unref();
    process.stdout.write(`${JSON.stringify({ childPid: child.pid })}\n`);
    setInterval(() => undefined, 1_000);
    break;
  }
  default:
    throw new Error(`Unknown mode: ${mode}`);
}
