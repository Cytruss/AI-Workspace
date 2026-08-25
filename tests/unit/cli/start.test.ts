import { describe, expect, test, vi } from "vitest";
import { createShutdownHandler } from "../../../src/cli/start.js";

describe("application shutdown", () => {
  test("stops input, cancels work, closes resources, and exits exactly once", async () => {
    const events: string[] = [];
    const exit = vi.fn((code: number) => {
      events.push(`exit:${String(code)}`);
    });
    const shutdown = createShutdownHandler({
      runtime: {
        stopAcceptingInteractions: () => events.push("stop-accepting"),
        stop: () => events.push("stop-runtime"),
      },
      activeRuns: {
        cancelAll: () => events.push("cancel-all"),
        list: () => [],
      },
      closeDatabase: () => events.push("close-database"),
      exit,
    });

    await shutdown(true);
    await shutdown(true);

    expect(events).toEqual([
      "stop-accepting",
      "cancel-all",
      "stop-runtime",
      "close-database",
      "exit:0",
    ]);
    expect(exit).toHaveBeenCalledOnce();
  });
});
