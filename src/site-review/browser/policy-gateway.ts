import { REVIEW_BROWSER_TOOL_NAMES } from "./types.js";

export class ReviewBrowserToolPolicyError extends Error {
  readonly code = "SITE_BROWSER_TOOL_BLOCKED";

  constructor(tool: string) {
    super(`Review browser tool is not permitted: ${tool}`);
    this.name = "ReviewBrowserToolPolicyError";
  }
}

export class ReviewBrowserToolPolicy {
  assertAllowed(tool: string): void {
    if (!REVIEW_BROWSER_TOOL_NAMES.includes(tool as never)) {
      throw new ReviewBrowserToolPolicyError(tool);
    }
  }
}
