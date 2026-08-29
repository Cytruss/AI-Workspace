import { REVIEW_BROWSER_TOOL_NAMES } from "./types.js";

export class ReviewBrowserCapabilityError extends Error {
  readonly code = "SITE_BROWSER_CAPABILITY_UNAVAILABLE";

  constructor(message: string) {
    super(message);
    this.name = "ReviewBrowserCapabilityError";
  }
}

export function verifyReviewBrowserTools(
  availableTools: readonly string[],
): void {
  const available = new Set(availableTools);
  const unexpected = availableTools.find(
    (tool) => !REVIEW_BROWSER_TOOL_NAMES.includes(tool as never),
  );
  if (unexpected !== undefined) {
    throw new ReviewBrowserCapabilityError(
      `Review browser exposed unexpected tool: ${unexpected}`,
    );
  }
  const missing = REVIEW_BROWSER_TOOL_NAMES.find(
    (tool) => !available.has(tool),
  );
  if (missing !== undefined) {
    throw new ReviewBrowserCapabilityError(
      `Review browser is missing required tool: ${missing}`,
    );
  }
}
