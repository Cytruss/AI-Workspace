/* eslint-disable @typescript-eslint/require-await */
import { describe, expect, test, vi } from "vitest";
import {
  ReviewNavigationGateway,
  ReviewBrowserGateway,
  ReviewBrowserToolPolicy,
  ReviewBrowserToolPolicyError,
} from "../../../../src/site-review/browser/policy-gateway.js";
import { UrlPolicy } from "../../../../src/site-review/url-policy.js";

describe("ReviewBrowserToolPolicy", () => {
  test("permits only named read-only review tools", () => {
    const policy = new ReviewBrowserToolPolicy();

    expect(() => {
      policy.assertAllowed("inspect_accessibility");
    }).not.toThrow();
    expect(() => {
      policy.assertAllowed("capture_screenshot");
    }).not.toThrow();
  });

  test.each([
    "evaluate_script",
    "click",
    "type",
    "set_cookie",
    "replay_request",
    "mcp__chrome-devtools__evaluate_script",
  ])("rejects forbidden browser tool: %s", (tool) => {
    const policy = new ReviewBrowserToolPolicy();

    expect(() => {
      policy.assertAllowed(tool);
    }).toThrow(ReviewBrowserToolPolicyError);
  });
});

describe("ReviewNavigationGateway", () => {
  test("validates same-origin pages and enforces the successful-page limit", async () => {
    const policy = new UrlPolicy({
      resolveHost: async () => ["93.184.216.34"],
    });
    const initial = await policy.validateInitial("https://example.com/");
    const navigate = vi.fn(async (url: string) => ({ url }));
    const gateway = new ReviewNavigationGateway({ policy, initial, navigate });

    await gateway.navigate("https://example.com/pricing#plans");
    expect(navigate).toHaveBeenCalledWith("https://example.com/pricing");
    await expect(
      gateway.navigate("https://other.example/"),
    ).rejects.toMatchObject({
      code: "SITE_REDIRECT_BLOCKED",
    });
  });

  test("rejects a cross-origin redirect reported after navigation", async () => {
    const policy = new UrlPolicy({
      resolveHost: async () => ["93.184.216.34"],
    });
    const initial = await policy.validateInitial("https://example.com/");
    const navigate = vi.fn(async () => ({ ok: true }));
    const gateway = new ReviewNavigationGateway({
      policy,
      initial,
      navigate,
      currentUrl: async () => "https://other.example/landing",
    });

    await expect(
      gateway.navigate("https://example.com/pricing"),
    ).rejects.toMatchObject({
      code: "SITE_REDIRECT_BLOCKED",
    });
    expect(navigate).toHaveBeenCalledWith("https://example.com/pricing");
  });
});

describe("ReviewBrowserGateway", () => {
  test("exposes navigation only after it passes the URL policy", async () => {
    const client = {
      call: vi.fn(async (tool: string) =>
        tool === "list_pages"
          ? {
              structuredContent: {
                pages: [{ selected: true, url: "https://example.com/pricing" }],
              },
            }
          : { content: [] },
      ),
    };
    const policy = new UrlPolicy({
      resolveHost: async () => ["93.184.216.34"],
    });
    const initial = await policy.validateInitial("https://example.com/");
    const gateway = new ReviewBrowserGateway({
      client,
      urlPolicy: policy,
      initial,
    });

    await gateway.call("open_page", { url: "https://example.com/pricing" });

    expect(client.call).toHaveBeenCalledWith("open_page", {
      url: "https://example.com/pricing",
    });
    await expect(
      gateway.call("open_page", { url: "https://other.example/" }),
    ).rejects.toMatchObject({ code: "SITE_REDIRECT_BLOCKED" });
  });
});
