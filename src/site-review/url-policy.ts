import { resolve4, resolve6 } from "node:dns/promises";
import { isIP } from "node:net";

export type SiteReviewErrorCode =
  | "SITE_URL_INVALID"
  | "SITE_URL_BLOCKED"
  | "SITE_REDIRECT_BLOCKED"
  | "SITE_PAGE_LIMIT";

export class SiteReviewError extends Error {
  constructor(
    readonly code: SiteReviewErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SiteReviewError";
  }
}

export interface ValidatedReviewUrl {
  canonicalUrl: string;
  origin: string;
}

export interface UrlPolicyDependencies {
  resolveHost?: (hostname: string) => Promise<readonly string[]>;
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  const [first, second] = parts;
  if (parts.length !== 4 || first === undefined || second === undefined)
    return true;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    first >= 224 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 192 && second === 0) ||
    (first === 192 && second === 2) ||
    (first === 198 && (second === 18 || second === 19 || second === 51)) ||
    (first === 203 && second === 0)
  );
}

function isPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb") ||
    normalized.startsWith("ff") ||
    normalized.startsWith("2001:db8")
  )
    return true;
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped?.[1] === undefined ? false : isPrivateIpv4(mapped[1]);
}

function isPublicAddress(address: string): boolean {
  const kind = isIP(address);
  if (kind === 4) return !isPrivateIpv4(address);
  if (kind === 6) return !isPrivateIpv6(address);
  return false;
}

async function resolvePublicHost(hostname: string): Promise<readonly string[]> {
  if (isIP(hostname) !== 0) return [hostname];
  const results = await Promise.allSettled([
    resolve4(hostname),
    resolve6(hostname),
  ]);
  const addresses = results.flatMap((result) =>
    result.status === "fulfilled" ? result.value : [],
  );
  if (addresses.length === 0) throw new Error("hostname did not resolve");
  return addresses;
}

function isLocalHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return normalized === "localhost" || !normalized.includes(".");
}

function canonicalize(value: URL): ValidatedReviewUrl {
  value.hash = "";
  return Object.freeze({ canonicalUrl: value.href, origin: value.origin });
}

export class UrlPolicy {
  private readonly resolveHost: NonNullable<
    UrlPolicyDependencies["resolveHost"]
  >;

  constructor(dependencies: UrlPolicyDependencies = {}) {
    this.resolveHost = dependencies.resolveHost ?? resolvePublicHost;
  }

  async validateInitial(input: string): Promise<ValidatedReviewUrl> {
    return this.validate(input, "SITE_URL_BLOCKED");
  }

  async validateNavigation(
    initial: ValidatedReviewUrl,
    input: string,
  ): Promise<ValidatedReviewUrl> {
    const validated = await this.validate(input, "SITE_REDIRECT_BLOCKED");
    if (validated.origin !== initial.origin) {
      throw new SiteReviewError(
        "SITE_REDIRECT_BLOCKED",
        "Cross-origin navigation is blocked",
      );
    }
    return validated;
  }

  createVisitLedger(initial: ValidatedReviewUrl): VisitLedger {
    return new VisitLedger(initial);
  }

  private async validate(
    input: string,
    blockedCode: "SITE_URL_BLOCKED" | "SITE_REDIRECT_BLOCKED",
  ): Promise<ValidatedReviewUrl> {
    let parsed: URL;
    try {
      parsed = new URL(input);
    } catch {
      throw new SiteReviewError("SITE_URL_INVALID", "URL is invalid");
    }
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      isLocalHostname(parsed.hostname)
    ) {
      throw new SiteReviewError(
        blockedCode,
        "URL is not a public HTTP(S) target",
      );
    }
    let addresses: readonly string[];
    try {
      addresses =
        isIP(parsed.hostname) === 0
          ? await this.resolveHost(parsed.hostname)
          : [parsed.hostname];
    } catch {
      throw new SiteReviewError(blockedCode, "URL host could not be verified");
    }
    if (
      addresses.length === 0 ||
      addresses.some((address) => !isPublicAddress(address))
    ) {
      throw new SiteReviewError(
        blockedCode,
        "URL host resolves to a blocked address",
      );
    }
    return canonicalize(parsed);
  }
}

export class VisitLedger {
  private readonly visited = new Set<string>();

  constructor(private readonly initial: ValidatedReviewUrl) {}

  recordSuccess(page: ValidatedReviewUrl): void {
    if (page.origin !== this.initial.origin) {
      throw new SiteReviewError(
        "SITE_REDIRECT_BLOCKED",
        "Cross-origin page cannot be recorded",
      );
    }
    if (this.visited.has(page.canonicalUrl)) return;
    if (this.visited.size >= 10) {
      throw new SiteReviewError("SITE_PAGE_LIMIT", "Review page limit reached");
    }
    this.visited.add(page.canonicalUrl);
  }
}
