import { describe, expect, test } from "vitest";
import {
  buildChromeDevtoolsArguments,
  ChromeLaunchPolicyError,
} from "../../../../src/site-review/browser/chrome-launch.js";

describe("buildChromeDevtoolsArguments", () => {
  test("uses an isolated headless browser session with a scoped log path", () => {
    expect(
      buildChromeDevtoolsArguments({
        logFile: "C:/private/review-1/codex/devtools.log",
      }),
    ).toEqual([
      "--headless",
      "--isolated",
      "--logFile",
      "C:/private/review-1/codex/devtools.log",
    ]);
  });

  test("rejects an attempt to attach a user browser or profile", () => {
    expect(() =>
      buildChromeDevtoolsArguments({
        logFile: "C:/private/review-1/codex/devtools.log",
        extraArguments: ["--autoConnect", "--userDataDir=C:/Users/operator"],
      }),
    ).toThrow(ChromeLaunchPolicyError);
  });
});
