/* eslint-disable @typescript-eslint/require-await */
import { describe, expect, test } from "vitest";
import {
  SiteReviewError,
  UrlPolicy,
} from "../../../src/site-review/url-policy.js";

describe("UrlPolicy", () => {
  test("normalizes a public initial URL without silently dropping its query", async () => {
    const resolved: string[] = [];
    const policy = new UrlPolicy({
      resolveHost: async (hostname) => {
        resolved.push(hostname);
        return ["93.184.216.34"];
      },
    });

    await expect(
      policy.validateInitial("https://example.com:443/pricing?plan=pro#faq"),
    ).resolves.toEqual({
      canonicalUrl: "https://example.com/pricing?plan=pro",
      origin: "https://example.com",
    });
    expect(resolved).toEqual(["example.com"]);
  });

  test.each([
    "file:///C:/private.txt",
    "javascript:alert(1)",
    "https://user:password@example.com/",
    "https://localhost/",
    "https://127.0.0.1/",
    "https://[::1]/",
    "https://[2001:db8::1]/",
  ])("rejects an unsafe initial target: %s", async (input) => {
    const policy = new UrlPolicy({
      resolveHost: async () => ["93.184.216.34"],
    });

    await expect(policy.validateInitial(input)).rejects.toMatchObject({
      code: "SITE_URL_BLOCKED",
    } satisfies Partial<SiteReviewError>);
  });

  test("rejects a hostname with any private DNS answer", async () => {
    const policy = new UrlPolicy({
      resolveHost: async () => ["93.184.216.34", "10.0.0.8"],
    });

    await expect(
      policy.validateInitial("https://example.com/"),
    ).rejects.toMatchObject({
      code: "SITE_URL_BLOCKED",
    } satisfies Partial<SiteReviewError>);
  });

  test.each([
    "https://0.1.2.3/",
    "https://100.64.0.1/",
    "https://169.254.1.1/",
    "https://172.16.0.1/",
    "https://192.0.0.8/",
    "https://192.0.2.1/",
    "https://192.88.99.1/",
    "https://198.18.0.1/",
    "https://198.51.100.1/",
    "https://203.0.113.1/",
    "https://224.0.0.1/",
    "https://240.0.0.1/",
  ])("rejects a non-global IPv4 target: %s", async (input) => {
    const policy = new UrlPolicy();

    await expect(policy.validateInitial(input)).rejects.toMatchObject({
      code: "SITE_URL_BLOCKED",
    } satisfies Partial<SiteReviewError>);
  });

  test.each([
    "https://[::]/",
    "https://[::1]/",
    "https://[fc00::1]/",
    "https://[fe80::1]/",
    "https://[ff00::1]/",
    "https://[2001:db8::1]/",
    "https://[::ffff:10.0.0.1]/",
  ])("rejects a non-global IPv6 target: %s", async (input) => {
    const policy = new UrlPolicy();

    await expect(policy.validateInitial(input)).rejects.toMatchObject({
      code: "SITE_URL_BLOCKED",
    } satisfies Partial<SiteReviewError>);
  });

  test("allows a public literal IPv6 target", async () => {
    const policy = new UrlPolicy();

    await expect(
      policy.validateInitial("https://[2606:4700:4700::1111]/"),
    ).resolves.toEqual({
      canonicalUrl: "https://[2606:4700:4700::1111]/",
      origin: "https://[2606:4700:4700::1111]",
    });
  });

  test("rejects a cross-origin navigation after a valid initial target", async () => {
    const policy = new UrlPolicy({
      resolveHost: async () => ["93.184.216.34"],
    });
    const initial = await policy.validateInitial("https://example.com/");

    await expect(
      policy.validateNavigation(initial, "https://other.example/path"),
    ).rejects.toMatchObject({
      code: "SITE_REDIRECT_BLOCKED",
    } satisfies Partial<SiteReviewError>);
  });

  test("allows only ten distinct successful canonical page visits", async () => {
    const policy = new UrlPolicy({
      resolveHost: async () => ["93.184.216.34"],
    });
    const initial = await policy.validateInitial("https://example.com/");
    const ledger = policy.createVisitLedger(initial);

    for (let index = 0; index < 10; index += 1) {
      const page = await policy.validateNavigation(
        initial,
        `https://example.com/page-${String(index)}#section`,
      );
      ledger.recordSuccess(page);
    }

    const next = await policy.validateNavigation(
      initial,
      "https://example.com/page-10",
    );
    expect(() => {
      ledger.recordSuccess(next);
    }).toThrow("page limit reached");
  });
});
