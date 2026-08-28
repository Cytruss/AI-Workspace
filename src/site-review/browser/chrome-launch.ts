export class ChromeLaunchPolicyError extends Error {
  readonly code = "SITE_BROWSER_LAUNCH_BLOCKED";

  constructor(message: string) {
    super(message);
    this.name = "ChromeLaunchPolicyError";
  }
}

export interface ChromeDevtoolsLaunchOptions {
  logFile: string;
  extraArguments?: readonly string[] | undefined;
}

export function buildChromeDevtoolsArguments(
  options: ChromeDevtoolsLaunchOptions,
): readonly string[] {
  if (options.logFile.length === 0) {
    throw new ChromeLaunchPolicyError("Chrome log file is required");
  }
  if ((options.extraArguments?.length ?? 0) > 0) {
    throw new ChromeLaunchPolicyError(
      "Chrome launch does not allow extra arguments",
    );
  }
  return Object.freeze([
    "--headless",
    "--isolated",
    "--logFile",
    options.logFile,
  ]);
}
