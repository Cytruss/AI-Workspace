import { describe, expect, test } from "vitest";
import { ActiveRuns } from "../../../src/orchestrator/active-runs.js";

describe("ActiveRuns", () => {
  test("authorizes an idempotent owner cancellation", () => {
    const runs = new ActiveRuns();
    const controller = new AbortController();
    runs.register("run-1", "owner", controller);

    expect(runs.cancel("run-1", "other")).toBe(false);
    expect(controller.signal.aborted).toBe(false);
    expect(runs.cancel("run-1", "owner")).toBe(true);
    expect(controller.signal.aborted).toBe(true);
    expect(runs.cancel("run-1", "owner")).toBe(false);
    expect(runs.list()).toEqual([{ runId: "run-1", ownerUserId: "owner" }]);
  });

  test("rejects duplicate IDs and cancels every registered run", () => {
    const runs = new ActiveRuns();
    const first = new AbortController();
    const second = new AbortController();
    runs.register("one", "owner", first);
    expect(() => {
      runs.register("one", "owner", second);
    }).toThrow(/duplicate/i);
    runs.register("two", "owner", second);

    runs.cancelAll();
    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(true);
  });
});
