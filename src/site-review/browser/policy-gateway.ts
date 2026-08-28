import { REVIEW_BROWSER_TOOL_NAMES } from "./types.js";
import {
  type UrlPolicy,
  type ValidatedReviewUrl,
  type VisitLedger,
} from "../url-policy.js";

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

export class ReviewNavigationGateway {
  private readonly ledger: VisitLedger;

  constructor(
    private readonly dependencies: {
      policy: UrlPolicy;
      initial: ValidatedReviewUrl;
      navigate(url: string): Promise<unknown>;
    },
  ) {
    this.ledger = dependencies.policy.createVisitLedger(dependencies.initial);
  }

  async navigate(input: string): Promise<unknown> {
    const target = await this.dependencies.policy.validateNavigation(
      this.dependencies.initial,
      input,
    );
    const result = await this.dependencies.navigate(target.canonicalUrl);
    this.ledger.recordSuccess(target);
    return result;
  }
}
