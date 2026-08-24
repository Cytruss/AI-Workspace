import { describe, expect, test } from "vitest";
import {
  PolishReportError,
  preserveVerdicts,
} from "../../../src/debate/polish-report.js";

describe("preserveVerdicts", () => {
  test("rejects a polisher that changes verdict data", () => {
    const verdicts = [{ claimId: "claim-0001", classification: "CONSENSUS" }];
    expect(() =>
      preserveVerdicts(verdicts as never, {
        summary: "rewritten",
        verdicts: [
          { claimId: "claim-0001", classification: "REJECTED" },
        ] as never,
      }),
    ).toThrow(PolishReportError);
  });
});
