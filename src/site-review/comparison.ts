import type { SiteReviewAgentResponse } from "./structured-response.js";

export interface AgentSiteReview {
  agentId: "codex" | "claude";
  response: SiteReviewAgentResponse;
}

export interface ComparedFinding {
  category: SiteReviewAgentResponse["findings"][number]["category"];
  statement: string;
  sourceAgents: readonly ("codex" | "claude")[];
}

export interface ComparedUncertainty {
  statement: string;
  sourceAgents: readonly ("codex" | "claude")[];
}

export interface SiteReviewComparison {
  agreed: readonly ComparedFinding[];
  different: readonly ComparedFinding[];
  uncertain: readonly ComparedUncertainty[];
}

function normalized(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function findingKey(
  review: AgentSiteReview,
  finding: SiteReviewAgentResponse["findings"][number],
): string {
  const urls = finding.observationIds
    .flatMap((id) =>
      review.response.observations
        .filter((observation) => observation.id === id)
        .map((observation) => observation.url),
    )
    .sort();
  return [finding.category, normalized(finding.statement), ...urls].join(
    "\u0000",
  );
}

function sortedAgents(
  agents: Iterable<"codex" | "claude">,
): readonly ("codex" | "claude")[] {
  return Object.freeze([...new Set(agents)].sort());
}

export function compareSiteReviews(
  first: AgentSiteReview,
  second: AgentSiteReview,
): SiteReviewComparison {
  const grouped = new Map<
    string,
    {
      category: ComparedFinding["category"];
      statement: string;
      agents: ("codex" | "claude")[];
    }
  >();
  for (const review of [first, second]) {
    for (const finding of review.response.findings) {
      const key = findingKey(review, finding);
      const existing = grouped.get(key);
      if (existing === undefined) {
        grouped.set(key, {
          category: finding.category,
          statement: finding.statement,
          agents: [review.agentId],
        });
      } else {
        existing.agents.push(review.agentId);
      }
    }
  }
  const agreed: ComparedFinding[] = [];
  const different: ComparedFinding[] = [];
  for (const entry of grouped.values()) {
    const item: ComparedFinding = {
      category: entry.category,
      statement: entry.statement,
      sourceAgents: sortedAgents(entry.agents),
    };
    if (item.sourceAgents.length === 2) agreed.push(item);
    else different.push(item);
  }
  const uncertaintyGroups = new Map<string, ComparedUncertainty>();
  for (const review of [first, second]) {
    for (const uncertainty of review.response.uncertainties) {
      const key = normalized(uncertainty.statement);
      const existing = uncertaintyGroups.get(key);
      uncertaintyGroups.set(
        key,
        existing === undefined
          ? { statement: uncertainty.statement, sourceAgents: [review.agentId] }
          : {
              ...existing,
              sourceAgents: sortedAgents([
                ...existing.sourceAgents,
                review.agentId,
              ]),
            },
      );
    }
  }
  const sortFindings = (left: ComparedFinding, right: ComparedFinding) =>
    left.category.localeCompare(right.category) ||
    left.statement.localeCompare(right.statement);
  return Object.freeze({
    agreed: Object.freeze(agreed.sort(sortFindings)),
    different: Object.freeze(different.sort(sortFindings)),
    uncertain: Object.freeze(
      [...uncertaintyGroups.values()].sort((left, right) =>
        left.statement.localeCompare(right.statement),
      ),
    ),
  });
}
