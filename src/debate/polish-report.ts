import { canonicalJson } from "../storage/session-repository.js";
import type { Verdict } from "../agents/structured-response.js";

export class PolishReportError extends Error {
  constructor(message = "Polisher changed immutable verdict data") {
    super(message);
    this.name = "PolishReportError";
  }
}

export interface PolishedReport {
  summary: string;
  verdicts: readonly Verdict[];
}

/** Summary prose is optional; verdict data is host-owned and immutable. */
export function preserveVerdicts(
  verdicts: readonly Verdict[],
  candidate: PolishedReport,
): PolishedReport {
  if (canonicalJson(candidate.verdicts) !== canonicalJson(verdicts)) {
    throw new PolishReportError();
  }
  return Object.freeze({ summary: candidate.summary, verdicts });
}
