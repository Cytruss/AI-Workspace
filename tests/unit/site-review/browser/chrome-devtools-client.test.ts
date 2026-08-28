import { describe, expect, test, vi } from "vitest";
import { ChromeDevtoolsClient } from "../../../../src/site-review/browser/chrome-devtools-client.js";

describe("ChromeDevtoolsClient", () => {
  test("maps a review screenshot request to the raw DevTools tool without forwarding controls", async () => {
    const callTool = vi.fn(async () => ({ content: [] }));
    const client = new ChromeDevtoolsClient({ callTool });

    await client.call("capture_screenshot", { format: "png" });

    expect(callTool).toHaveBeenCalledWith({
      name: "take_screenshot",
      arguments: {},
    });
  });

  test("uses fixed navigation controls and rejects injected raw parameters", async () => {
    const callTool = vi.fn(async () => ({ content: [] }));
    const client = new ChromeDevtoolsClient({ callTool });

    await client.call("navigate_same_origin", {
      url: "https://example.com/pricing",
      initScript: "unsafe",
    });

    expect(callTool).toHaveBeenCalledWith({
      name: "navigate_page",
      arguments: {
        type: "url",
        url: "https://example.com/pricing",
        handleBeforeUnload: "dismiss",
        timeout: 10_000,
      },
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
