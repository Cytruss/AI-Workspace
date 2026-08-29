import { REVIEW_BROWSER_TOOL_NAMES } from "./types.js";
import {
  type UrlPolicy,
  type ValidatedReviewUrl,
  type VisitLedger,
} from "../url-policy.js";

interface ReviewBrowserPort {
  call(tool: string, arguments_: Record<string, unknown>): Promise<unknown>;
}

function selectedPageUrl(value: unknown): string {
  if (typeof value !== "object" || value === null)
    throw new Error("Review browser did not report the selected page");
  const structured = (value as { structuredContent?: unknown }).structuredContent;
  if (typeof structured !== "object" || structured === null)
    throw new Error("Review browser did not report the selected page");
  const pages = (structured as { pages?: unknown }).pages;
  if (!Array.isArray(pages))
    throw new Error("Review browser did not report the selected page");
  const selected = pages.find(
    (page): page is { selected: true; url: string } =>
      typeof page === "object" &&
      page !== null &&
      (page as { selected?: unknown }).selected === true &&
      typeof (page as { url?: unknown }).url === "string",
  );
  if (selected === undefined)
    throw new Error("Review browser did not report the selected page");
  return selected.url;
}

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
      currentUrl?(): Promise<string>;
    },
  ) {
    this.ledger = dependencies.policy.createVisitLedger(dependencies.initial);
  }

  async navigate(input: string): Promise<unknown> {
    return this.navigateWith(input, (url) => this.dependencies.navigate(url));
  }

  async navigateWith(
    input: string,
    navigate: (url: string) => Promise<unknown>,
  ): Promise<unknown> {
    const target = await this.dependencies.policy.validateNavigation(
      this.dependencies.initial,
      input,
    );
    const result = await navigate(target.canonicalUrl);
    const finalUrl =
      this.dependencies.currentUrl === undefined
        ? target.canonicalUrl
        : await this.dependencies.currentUrl();
    const finalTarget = await this.dependencies.policy.validateNavigation(
      this.dependencies.initial,
      finalUrl,
    );
    this.ledger.recordSuccess(finalTarget);
    return result;
  }
}

/** Maps provider-visible review tools to a single policy-enforced browser port. */
export class ReviewBrowserGateway {
  private readonly navigation: ReviewNavigationGateway;
  private readonly policy = new ReviewBrowserToolPolicy();

  constructor(
    private readonly dependencies: {
      client: ReviewBrowserPort;
      urlPolicy: UrlPolicy;
      initial: ValidatedReviewUrl;
    },
  ) {
    this.navigation = new ReviewNavigationGateway({
      policy: dependencies.urlPolicy,
      initial: dependencies.initial,
      navigate: (url) => dependencies.client.call("navigate_same_origin", { url }),
      currentUrl: async () =>
        selectedPageUrl(await dependencies.client.call("list_pages", {})),
    });
  }

  async call(tool: string, arguments_: Record<string, unknown>): Promise<unknown> {
    this.policy.assertAllowed(tool);
    if (
      tool === "open_page" ||
      tool === "navigate_same_origin" ||
      tool === "follow_visible_link"
    ) {
      if (typeof arguments_["url"] !== "string")
        throw new Error("Review navigation requires a URL");
      return this.navigation.navigateWith(arguments_["url"], (url) =>
        this.dependencies.client.call(tool, { url }),
      );
    }
    return this.dependencies.client.call(tool, {});
  }
}
