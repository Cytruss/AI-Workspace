import { compareSiteReviews, type SiteReviewComparison } from "./comparison.js";
import type { SiteReviewAgentResponse } from "./structured-response.js";
import { UrlPolicy } from "./url-policy.js";
import type { SiteReviewRepository } from "../storage/site-review-repository.js";
import type { ProjectScope } from "../storage/project-repository.js";

export interface SiteReviewInput {
  interactionId: string;
  scope: ProjectScope;
  url: string;
  focus?: string;
}

export interface SiteReviewReport {
  reviewId: string;
  status: "completed" | "partial" | "failed" | "cancelled";
  results: Readonly<
    Record<"codex" | "claude", SiteReviewAgentResponse | undefined>
  >;
  comparison?: SiteReviewComparison;
}

export interface SiteReviewServiceDependencies {
  reviews: SiteReviewRepository;
  policy: UrlPolicy;
  runAgent(input: {
    agentId: "codex" | "claude";
    url: string;
    focus?: string;
    signal: AbortSignal;
  }): Promise<SiteReviewAgentResponse>;
}

export class SiteReviewService {
  constructor(private readonly dependencies: SiteReviewServiceDependencies) {}

  async review(input: SiteReviewInput): Promise<SiteReviewReport> {
    const target = await this.dependencies.policy.validateInitial(input.url);
    const review = this.dependencies.reviews.create({
      interactionId: input.interactionId,
      guildId: input.scope.guildId,
      channelId: input.scope.channelId,
      userId: input.scope.userId,
      initialUrl: target.canonicalUrl,
      ...(input.focus === undefined ? {} : { focus: input.focus }),
    });
    if (review.status !== "queued") throw new Error("INTERACTION_IN_PROGRESS");
    this.dependencies.reviews.markRunning(review.id);
    const controller = new AbortController();
    const settled = await Promise.allSettled(
      (["codex", "claude"] as const).map((agentId) =>
        this.dependencies.runAgent({
          agentId,
          url: target.canonicalUrl,
          ...(input.focus === undefined ? {} : { focus: input.focus }),
          signal: controller.signal,
        }),
      ),
    );
    const codex =
      settled[0]?.status === "fulfilled" ? settled[0].value : undefined;
    const claude =
      settled[1]?.status === "fulfilled" ? settled[1].value : undefined;
    if (codex !== undefined && claude !== undefined) {
      this.dependencies.reviews.markCompleted(review.id);
      return {
        reviewId: review.id,
        status: "completed",
        results: { codex, claude },
        comparison: compareSiteReviews(
          { agentId: "codex", response: codex },
          { agentId: "claude", response: claude },
        ),
      };
    }
    if (codex !== undefined || claude !== undefined) {
      this.dependencies.reviews.markPartial(review.id);
      return {
        reviewId: review.id,
        status: "partial",
        results: { codex, claude },
      };
    }
    this.dependencies.reviews.markFailed(review.id);
    return {
      reviewId: review.id,
      status: "failed",
      results: { codex, claude },
    };
  }
}
