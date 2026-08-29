import { buildSiteReviewPrompt } from "./prompt.js";
import type { SiteReviewServiceDependencies } from "./site-review-service.js";
import { SiteReviewAgentResponseSchema } from "./structured-response.js";
import type { ReviewBrowserBinding } from "./browser/types.js";
import type { SiteReviewAgentResponse } from "./structured-response.js";

interface ReviewAdapter {
  runReview(
    request: {
      workingDirectory: string;
      prompt: string;
      responseSchema: typeof SiteReviewAgentResponseSchema;
      browser: Pick<ReviewBrowserBinding, "gateway" | "toolNames">;
    },
    signal: AbortSignal,
  ): Promise<{
    status: "completed" | "failed" | "cancelled" | "timed_out";
    response?: SiteReviewAgentResponse;
    diagnostics: readonly string[];
  }>;
}

export interface SiteReviewRunnerDependencies {
  codex: ReviewAdapter;
  claude: ReviewAdapter;
  workingDirectory: string;
  createBrowserBinding(input: {
    reviewId: string;
    agentId: "codex" | "claude";
    url: string;
  }): ReviewBrowserBinding;
}

export function createSiteReviewRunner(
  dependencies: SiteReviewRunnerDependencies,
): SiteReviewServiceDependencies["runAgent"] {
  return async ({ reviewId, agentId, url, focus, signal }) => {
    const result = await dependencies[agentId].runReview(
      {
        workingDirectory: dependencies.workingDirectory,
        prompt: buildSiteReviewPrompt({
          initialUrl: url,
          ...(focus === undefined ? {} : { focus }),
        }),
        responseSchema: SiteReviewAgentResponseSchema,
        browser: dependencies.createBrowserBinding({ reviewId, agentId, url }),
      },
      signal,
    );
    if (result.status === "completed" && result.response !== undefined)
      return result.response;
    throw new Error(
      `${agentId} ${result.status}: ${result.diagnostics.join("; ") || "no diagnostics"}`,
    );
  };
}
