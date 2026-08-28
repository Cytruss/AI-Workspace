import { describe, expect, test, vi } from "vitest";
import { ChromeDevtoolsClient } from "../../../../src/site-review/browser/chrome-devtools-client.js";

describe("ChromeDevtoolsClient", () => {
  test("maps a review screenshot request to the raw DevTools tool", async () => {
    const callTool = vi.fn(async () => ({ content: [] }));
    const client = new ChromeDevtoolsClient({ callTool });

    await client.call("capture_screenshot", { format: "png" });

    expect(callTool).toHaveBeenCalledWith({
      name: "take_screenshot",
      arguments: { format: "png" },
    });
  });

  test("does not forward tools outside the review allowlist", async () => {
    const callTool = vi.fn(async () => ({ content: [] }));
    const client = new ChromeDevtoolsClient({ callTool });

    await expect(client.call("evaluate_script", {})).rejects.toThrow(
      "not permitted",
    );
    expect(callTool).not.toHaveBeenCalled();
  });
});
