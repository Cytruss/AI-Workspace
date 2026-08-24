/* global process, setInterval */

import { appendFile, writeFile } from "node:fs/promises";

const terminationPath = process.argv[2];

if (terminationPath) {
  await writeFile(
    terminationPath,
    `grandchild-started:${process.pid}\n`,
    "utf8",
  );
}

async function recordTermination() {
  if (terminationPath) {
    await appendFile(terminationPath, "grandchild-terminated\n", "utf8");
  }
}

process.once("SIGTERM", () => {
  void recordTermination().finally(() => process.exit(0));
});

process.once("SIGINT", () => {
  void recordTermination().finally(() => process.exit(0));
});

setInterval(() => undefined, 1_000);
