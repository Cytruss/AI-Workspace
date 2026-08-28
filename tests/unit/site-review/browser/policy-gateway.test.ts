import { describe, expect, test } from "vitest";
import {
  ReviewBrowserToolPolicy,
  ReviewBrowserToolPolicyError,
} from "../../../../src/site-review/browser/policy-gateway.js";

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
