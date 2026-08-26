import { execFile } from "node:child_process";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import type { AppPaths } from "../config/app-paths.js";
import { loadConfig } from "../config/load-config.js";
import { resolveAgentCommand } from "./resolve-agent-command.js";
import { runDoctor } from "./doctor.js";
import {
  collectSetupDraft,
  readSecret,
  writeSetupDraft,
  type SetupIo,
} from "./setup.js";
import {
  inspectWindowsPrerequisites,
  installWindowsPrerequisite,
  type WindowsCommandRunner,
  type WindowsPrerequisite,
  type WindowsPrerequisiteStatus,
} from "./onboarding-windows.js";
import type { OnboardingMode, OnboardingResult } from "./onboarding-types.js";

type AgentResolver = Parameters<typeof inspectWindowsPrerequisites>[1];

export interface OnboardingDependencies {
  io: SetupIo;
  cwd: string;
  windowsRunner: WindowsCommandRunner;
  resolveAgentCommand: AgentResolver;
  inspectWindowsPrerequisites: typeof inspectWindowsPrerequisites;
  installWindowsPrerequisite: typeof installWindowsPrerequisite;
  openOfficialUrl(url: string): Promise<void>;
  collectSetupDraft: typeof collectSetupDraft;
  writeSetupDraft: typeof writeSetupDraft;
  loadConfiguration: typeof loadConfig;
  runDoctor: typeof runDoctor;
  close?: () => void;
}

const officialPages = {
  node: "https://nodejs.org/en/download",
  git: "https://git-scm.com/downloads/win",
  pnpm: "https://pnpm.io/installation",
  codex: "https://developers.openai.com/codex/cli/",
  claude: "https://docs.anthropic.com/en/docs/claude-code/setup",
  discord: "https://discord.com/developers/applications",
} as const;

const bootstrapActions = {
  node: "Proposed action: winget install --id OpenJS.NodeJS.22 --exact --version 22.23.2 --source winget",
  git: "Proposed action: winget install --id Git.Git --exact --source winget",
  pnpm: "Proposed action: corepack prepare pnpm@11.19.0 --activate",
} as const;

const displayNames = {
  node: "Node.js 22",
  git: "Git",
  pnpm: "pnpm",
  codex: "Codex",
  claude: "Claude",
  winget: "WinGet",
} as const satisfies Record<WindowsPrerequisite, string>;

function runWindowsCommand(
  file: string,
  args: readonly string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      file,
      [...args],
      { windowsHide: true },
      (error, output, errorOutput) => {
        resolve({
          exitCode:
            error === null
              ? 0
              : typeof error.code === "number"
                ? error.code
                : 1,
          stdout: output,
          stderr: errorOutput || error?.message || "",
        });
      },
    );
  });
}

function openOfficialUrl(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      "rundll32.exe",
      ["url.dll,FileProtocolHandler", url],
      { windowsHide: true },
      (error) => {
        if (error === null) resolve();
        else
          reject(
            error instanceof Error
              ? error
              : new Error("Unable to open the official page."),
          );
      },
    );
  });
}

function createProductionDependencies(): OnboardingDependencies {
  const terminal = createInterface({ input: stdin, output: stdout });
  const io: SetupIo = {
    ask: (question) => terminal.question(question),
    readSecret: async (prompt) => {
      terminal.pause();
      try {
        return await readSecret(stdin, stdout, prompt);
      } finally {
        terminal.resume();
      }
    },
    write: (line) => {
      stdout.write(line);
    },
  };
  return {
    io,
    cwd: process.cwd(),
    windowsRunner: runWindowsCommand,
    resolveAgentCommand,
    inspectWindowsPrerequisites,
    installWindowsPrerequisite,
    openOfficialUrl,
    collectSetupDraft,
    writeSetupDraft,
    loadConfiguration: loadConfig,
    runDoctor,
    close: () => {
      terminal.close();
    },
  };
}

function normalizedAnswer(answer: string): string {
  return answer.trim().toLowerCase();
}

function cancelledResult(): OnboardingResult {
  return {
    stage: "cancelled",
    nextAction: "Run pnpm onboarding when you are ready to continue.",
  };
}

async function confirm(
  io: SetupIo,
  question: string,
): Promise<"yes" | "no" | "cancel"> {
  const answer = normalizedAnswer(await io.ask(question));
  if (answer === "yes") return "yes";
  if (answer === "cancel") return "cancel";
  return "no";
}

async function offerOfficialPage(
  dependencies: OnboardingDependencies,
  label: string,
  url: string,
): Promise<"continue" | "cancel"> {
  const choice = await confirm(
    dependencies.io,
    `Open the official ${label} page? (yes/no/cancel): `,
  );
  if (choice === "cancel") return "cancel";
  if (choice === "yes") await dependencies.openOfficialUrl(url);
  return "continue";
}

function replaceStatus(
  statuses: WindowsPrerequisiteStatus[],
  replacement: WindowsPrerequisiteStatus,
): void {
  const index = statuses.findIndex(({ name }) => name === replacement.name);
  if (index >= 0) statuses[index] = replacement;
}

function missingNextAction(
  statuses: readonly WindowsPrerequisiteStatus[],
): string {
  const names = statuses
    .filter(({ available }) => !available)
    .map(({ name }) => displayNames[name]);
  return `Resolve ${names.join(", ")}, then run pnpm onboarding again.`;
}

async function optionalBootstrap(
  dependencies: OnboardingDependencies,
  statuses: WindowsPrerequisiteStatus[],
): Promise<OnboardingMode | "cancelled"> {
  for (const name of ["node", "git", "pnpm"] as const) {
    const status = statuses.find((candidate) => candidate.name === name);
    if (status?.available !== false) continue;
    dependencies.io.write(`${bootstrapActions[name]}\n`);
    const choice = await confirm(
      dependencies.io,
      `Run this action now for ${displayNames[name]}? (yes/no/cancel): `,
    );
    if (choice === "cancel") return "cancelled";
    if (choice === "no") {
      dependencies.io.write(
        "Continuing in Guided mode; no further bootstrap actions will run.\n",
      );
      return "guided";
    }
    const installed = await dependencies.installWindowsPrerequisite(
      name,
      dependencies.windowsRunner,
    );
    replaceStatus(statuses, installed);
    dependencies.io.write(
      `${displayNames[name]}: ${installed.available ? "available" : "still unavailable"}; ${installed.detail}\n`,
    );
  }
  return "semi-automatic";
}

async function presentManualPrerequisites(
  dependencies: OnboardingDependencies,
  statuses: readonly WindowsPrerequisiteStatus[],
): Promise<"continue" | "cancel"> {
  for (const name of ["node", "git", "pnpm"] as const) {
    if (statuses.find((status) => status.name === name)?.available !== false)
      continue;
    if (
      (await offerOfficialPage(
        dependencies,
        displayNames[name],
        officialPages[name],
      )) === "cancel"
    )
      return "cancel";
  }
  return "continue";
}

async function presentProviderReadiness(
  dependencies: OnboardingDependencies,
  statuses: readonly WindowsPrerequisiteStatus[],
): Promise<"continue" | "cancel"> {
  for (const provider of ["codex", "claude"] as const) {
    const label = displayNames[provider];
    dependencies.io.write(
      `${label} sign-in must be completed manually outside AI Workspace. Use a verified native .exe on Windows; .cmd and .bat shims are not accepted.\n`,
    );
    if (
      statuses.find(({ name }) => name === provider)?.available === false &&
      (await offerOfficialPage(
        dependencies,
        `${label} setup`,
        officialPages[provider],
      )) === "cancel"
    )
      return "cancel";
  }
  return "continue";
}

async function runStateMachine(
  paths: AppPaths,
  dependencies: OnboardingDependencies,
): Promise<OnboardingResult> {
  const { io } = dependencies;
  io.write(
    "Windows onboarding reports local prerequisites before making any optional change.\n",
  );
  const statuses = [
    ...(await dependencies.inspectWindowsPrerequisites(
      dependencies.windowsRunner,
      dependencies.resolveAgentCommand,
    )),
  ];
  for (const status of statuses) {
    io.write(
      `${displayNames[status.name]}: ${status.available ? "available" : "missing"}; ${status.detail}\n`,
    );
  }

  const selectedMode = normalizedAnswer(
    await io.ask("Choose onboarding mode (guided/semi-automatic/cancel): "),
  );
  if (selectedMode === "cancel") return cancelledResult();
  if (selectedMode !== "guided" && selectedMode !== "semi-automatic") {
    return {
      stage: "declined",
      nextAction:
        "Run pnpm onboarding again and choose guided or semi-automatic.",
    };
  }
  let mode: OnboardingMode = selectedMode;

  if (mode === "semi-automatic") {
    const bootstrapMode = await optionalBootstrap(dependencies, statuses);
    if (bootstrapMode === "cancelled") return cancelledResult();
    mode = bootstrapMode;
  }
  if (
    mode === "guided" &&
    (await presentManualPrerequisites(dependencies, statuses)) === "cancel"
  )
    return cancelledResult();

  if ((await presentProviderReadiness(dependencies, statuses)) === "cancel")
    return cancelledResult();

  const missing = statuses.filter(({ available }) => !available);
  if (missing.length > 0) {
    const continueChoice = await confirm(
      io,
      "Continue after completing the reported manual prerequisite steps? (yes/no/cancel): ",
    );
    if (continueChoice === "cancel") return cancelledResult();
    if (continueChoice === "no") {
      return {
        stage: "needs_operator_action",
        nextAction: missingNextAction(missing),
      };
    }
  }

  io.write(
    "Discord manual tasks: create a private application and restricted bot, install it only in the intended guild, then collect the application, guild, and authorized user IDs. AI Workspace never creates or authenticates Discord accounts.\n",
  );
  if (
    (await offerOfficialPage(
      dependencies,
      "Discord Developer Portal",
      officialPages.discord,
    )) === "cancel"
  )
    return cancelledResult();
  const discordReady = await confirm(
    io,
    "Have you completed the Discord manual tasks? (yes/no/cancel): ",
  );
  if (discordReady === "cancel") return cancelledResult();
  if (discordReady === "no") {
    return {
      stage: "needs_operator_action",
      nextAction:
        "Complete the Discord manual tasks, then run pnpm onboarding again.",
    };
  }

  let draft;
  try {
    draft = await dependencies.collectSetupDraft(io);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "Setup cancelled before writing local files"
    )
      return cancelledResult();
    throw error;
  }
  await dependencies.writeSetupDraft(draft, paths, dependencies.cwd);
  const config = await dependencies.loadConfiguration(paths.configFile, {
    [draft.config.discord.tokenEnv]: draft.token,
  });
  io.write(
    "Running doctor as an executable and capability preflight only. It does not verify authentication, entitlement, or real-request readiness.\n",
  );
  const healthy = await dependencies.runDoctor({
    config,
    configFile: paths.configFile,
    databaseFile: paths.databaseFile,
    write: (line) => {
      io.write(`${line}\n`);
    },
  });
  if (!healthy) {
    return {
      stage: "needs_operator_action",
      nextAction:
        "Review the executable or capability diagnostics, fix them, then run pnpm run doctor again.",
    };
  }
  return {
    stage: "complete",
    nextAction:
      "Review provider sign-in and account access manually, then run pnpm start when ready.",
  };
}

export async function runOnboarding(
  paths: AppPaths,
  dependencies: OnboardingDependencies = createProductionDependencies(),
): Promise<OnboardingResult> {
  try {
    return await runStateMachine(paths, dependencies);
  } catch {
    return {
      stage: "failed",
      nextAction:
        "Review the safe diagnostics above, correct the problem, then run pnpm onboarding again.",
    };
  } finally {
    dependencies.close?.();
  }
}
