import { compareSiteReviews, type SiteReviewComparison } from "./comparison.js";
import type { SiteReviewAgentResponse } from "./structured-response.js";
import { UrlPolicy } from "./url-policy.js";
import type { SiteReviewRepository } from "../storage/site-review-repository.js";
import type { ProjectScope } from "../storage/project-repository.js";
import type { ActiveRuns } from "../orchestrator/active-runs.js";

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
  diagnostics?: Partial<Record<"codex" | "claude", readonly string[]>>;
}

export interface SiteReviewServiceDependencies {
  reviews: SiteReviewRepository;
  policy: UrlPolicy;
  activeRuns: ActiveRuns;
  runAgent(input: {
    reviewId: string;
    agentId: "codex" | "claude";
    url: string;
    focus?: string;
    signal: AbortSignal;
  }): Promise<SiteReviewAgentResponse>;
}

function failureDiagnostic(
  agentId: "codex" | "claude",
  reason: unknown,
): string {
  const safeCodes = new Set([
    `${agentId.toUpperCase()}_REVIEW_FAILED`,
    `${agentId.toUpperCase()}_REVIEW_CANCELLED`,
    `${agentId.toUpperCase()}_REVIEW_TIMED_OUT`,
    `${agentId.toUpperCase()}_REVIEW_AUTH_UNAVAILABLE`,
  ]);
  return reason instanceof Error && safeCodes.has(reason.message)
    ? reason.message
    : `${agentId.toUpperCase()}_REVIEW_FAILED`;
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
    if (review.status !== "queued") {
      if (
        review.status === "completed" ||
        review.status === "partial" ||
        review.status === "failed" ||
        review.status === "cancelled"
      ) {
        const persisted = this.dependencies.reviews.report(review.id);
        if (persisted !== undefined) return persisted as SiteReviewReport;
      }
      throw new Error("INTERACTION_IN_PROGRESS");
    }
    this.dependencies.reviews.markRunning(review.id);
    const controller = new AbortController();
    this.dependencies.activeRuns.register(
      review.id,
      input.scope.userId,
      controller,
    );
    try {
      const settled = await Promise.allSettled(
        (["codex", "claude"] as const).map((agentId) =>
          this.dependencies.runAgent({
            reviewId: review.id,
            agentId,
            url: target.canonicalUrl,
            ...(input.focus === undefined ? {} : { focus: input.focus }),
            signal: controller.signal,
          }),
        ),
      );
      if (controller.signal.aborted) {
        this.dependencies.reviews.markCancelled(review.id);
        const report: SiteReviewReport = {
          reviewId: review.id,
          status: "cancelled",
          results: { codex: undefined, claude: undefined },
        };
        this.dependencies.reviews.persistReport(review.id, report);
        return report;
      }
      const codex =
        settled[0]?.status === "fulfilled" ? settled[0].value : undefined;
      const claude =
        settled[1]?.status === "fulfilled" ? settled[1].value : undefined;
      const diagnostics: Partial<
        Record<"codex" | "claude", readonly string[]>
      > = {};
      for (const [index, agentId] of (["codex", "claude"] as const).entries()) {
        const result = settled[index];
        if (result?.status !== "rejected") continue;
        const failure = [failureDiagnostic(agentId, result.reason)];
        diagnostics[agentId] = failure;
        this.dependencies.reviews.persistAgentFailure(
          review.id,
          agentId,
          failure,
        );
      }
      const reportDiagnostics =
        Object.keys(diagnostics).length === 0 ? {} : { diagnostics };
      if (codex !== undefined && claude !== undefined) {
        this.dependencies.reviews.persistAgentResponse(
          review.id,
          "codex",
          codex,
        );
        this.dependencies.reviews.persistAgentResponse(
          review.id,
          "claude",
          claude,
        );
        this.dependencies.reviews.markCompleted(review.id);
        const report: SiteReviewReport = {
          reviewId: review.id,
          status: "completed",
          results: { codex, claude },
          comparison: compareSiteReviews(
            { agentId: "codex", response: codex },
            { agentId: "claude", response: claude },
          ),
          ...reportDiagnostics,
        };
        this.dependencies.reviews.persistReport(review.id, report);
        return report;
      }
      if (codex !== undefined || claude !== undefined) {
        if (codex !== undefined)
          this.dependencies.reviews.persistAgentResponse(
            review.id,
            "codex",
            codex,
          );
        if (claude !== undefined)
          this.dependencies.reviews.persistAgentResponse(
            review.id,
            "claude",
            claude,
          );
        this.dependencies.reviews.markPartial(review.id);
        const report: SiteReviewReport = {
          reviewId: review.id,
          status: "partial",
          results: { codex, claude },
          ...reportDiagnostics,
        };
        this.dependencies.reviews.persistReport(review.id, report);
        return report;
      }
      this.dependencies.reviews.markFailed(review.id);
      const report: SiteReviewReport = {
        reviewId: review.id,
        status: "failed",
        results: { codex, claude },
        ...reportDiagnostics,
      };
      this.dependencies.reviews.persistReport(review.id, report);
      return report;
    } finally {
      this.dependencies.activeRuns.unregister(review.id);
    }
  }
}
