import { getAppPaths } from "./config/app-paths.js";
import { runDoctor } from "./cli/doctor.js";
import { runOnboarding } from "./cli/onboarding.js";
import { parseCommand } from "./cli/parse-command.js";
import { runSetup } from "./cli/setup.js";
import { startApplication } from "./cli/start.js";
import { loadConfig } from "./config/load-config.js";
import { config as loadEnvironment } from "dotenv";

async function main(argv: readonly string[]): Promise<void> {
  const command = parseCommand(argv);
  const paths = getAppPaths();
  if (command.name === "setup") return runSetup(paths);
  if (command.name === "onboarding") {
    await runOnboarding(paths);
    return;
  }
  if (command.name === "start") return startApplication();
  loadEnvironment();
  const configuration = await loadConfig(paths.configFile);
  const healthy = await runDoctor({
    config: configuration,
    configFile: paths.configFile,
    databaseFile: paths.databaseFile,
  });
  if (!healthy) process.exitCode = 1;
}

void main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Command failed");
  process.exitCode = 1;
});
