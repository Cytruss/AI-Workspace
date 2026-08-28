import { describe, expect, test } from "vitest";
import { verifyReviewBrowserTools } from "../../../../src/site-review/browser/provider-capability.js";

describe("review browser provider capability", () => {
  test("accepts exactly the review gateway tool set", () => {
    expect(() =>
      verifyReviewBrowserTools([
        "read_network_summary",
        "capture_screenshot",
        "inspect_accessibility",
        "inspect_rendered_page",
        "follow_visible_link",
        "navigate_same_origin",
        "open_page",
        "list_pages",
        "read_console_summary",
      ]),
    ).not.toThrow();
  });

  test("fails closed when the provider exposes an unexpected tool", () => {
    expect(() =>
      verifyReviewBrowserTools([
        "list_pages",
        "open_page",
        "navigate_same_origin",
        "follow_visible_link",
        "inspect_rendered_page",
        "inspect_accessibility",
        "capture_screenshot",
        "read_console_summary",
        "read_network_summary",
        "evaluate_script",
      ]),
    ).toThrow("unexpected tool");
  });

  test("fails closed when a required tool is missing", () => {
    expect(() => verifyReviewBrowserTools(["list_pages"])).toThrow(
      "missing required tool",
    );
  });
});
