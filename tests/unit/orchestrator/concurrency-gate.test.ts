import { describe, expect, test } from "vitest";
import { ConcurrencyGate } from "../../../src/orchestrator/concurrency-gate.js";

describe("ConcurrencyGate", () => {
  test("runs queued work in FIFO order at the configured limit", async () => {
    const gate = new ConcurrencyGate(1);
    const controller = new AbortController();
    const started: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const first = gate.run(controller.signal, () => {
      started.push("first");
      return new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
    });
    const second = gate.run(controller.signal, () => {
      started.push("second");
      return Promise.resolve();
    });

    await Promise.resolve();
    expect(started).toEqual(["first"]);
    releaseFirst?.();
    await Promise.all([first, second]);
    expect(started).toEqual(["first", "second"]);
  });

  test("removes an aborted queued operation without consuming a slot", async () => {
    const gate = new ConcurrencyGate(1);
    const active = new AbortController();
    const queued = new AbortController();
    let release: (() => void) | undefined;
    const first = gate.run(
      active.signal,
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const never = gate.run(queued.signal, () =>
      Promise.reject(new Error("must not run")),
    );
    queued.abort();
    await expect(never).rejects.toMatchObject({ name: "AbortError" });
    release?.();
    await first;
  });
});
