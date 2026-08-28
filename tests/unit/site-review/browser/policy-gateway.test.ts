import { describe, expect, test, vi } from "vitest";
import {
  ReviewNavigationGateway,
  ReviewBrowserToolPolicy,
  ReviewBrowserToolPolicyError,
} from "../../../../src/site-review/browser/policy-gateway.js";
import { UrlPolicy } from "../../../../src/site-review/url-policy.js";

describe("ReviewBrowserToolPolicy", () => {
  test("permits only named read-only review tools", () => {
    const policy = new ReviewBrowserToolPolicy();

    expect(() => policy.assertAllowed("inspect_accessibility")).not.toThrow();
    expect(() => policy.assertAllowed("capture_screenshot")).not.toThrow();
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

    expect(() => policy.assertAllowed(tool)).toThrow(
      ReviewBrowserToolPolicyError,
    );
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
});
