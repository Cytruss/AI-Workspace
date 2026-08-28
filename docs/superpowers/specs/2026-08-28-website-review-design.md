# Website Review Design

## Status and scope

This design adds a read-only `/review-site` workflow. It accepts a public URL supplied by an authorized Discord user and returns an evidence-backed assessment of what the site does, how its public user interface behaves, and how it looks.

The agreed first release has these boundaries:

- Review any supplied public `http` or `https` URL, subject to network-safety validation.
- Visit at most ten pages on the initial URL's origin per agent.
- Give Codex and Claude separate, fresh, unauthenticated Chrome DevTools MCP browser sessions so their exploration does not interfere.
- Capture desktop and mobile screenshots, rendered-page observations, navigation results, and basic accessibility observations.
- Do not sign in, submit forms, upload files, make purchases, change settings, or perform account actions.
- Keep the current local-project `/ask` and `/debate` behavior unchanged.

This release does not crawl arbitrary external domains, reuse the operator's browser profile, bypass access controls, publish findings, or make GitHub changes. Repository and GitHub review is a later, separate workflow.

## User experience

Discord receives a new command:

```text
/review-site url:<public URL> focus:<optional question>
```

`focus` refines the review, for example "Can a new user understand the pricing?" or "Review mobile navigation and accessibility." It cannot expand the safety policy.

The main reply contains:

1. A plain-language description of the site's apparent purpose.
2. Observed public flows and broken, blocked, or ambiguous interactions.
3. A visual assessment of hierarchy, readability, responsiveness, and obvious accessibility concerns.
4. Where Codex and Claude agree, disagree, or remain uncertain.
5. A result count and links or attachments for screenshots and technical evidence.

Long reports use the existing Discord continuation-message behavior. The first message contains the primary audit attachment; screenshots are sent as separate image attachments or grouped detail attachments as required by Discord limits.

## Architecture

Add a `site-review` module with four responsibilities:

- `UrlPolicy` validates requested URLs and every redirect target.
- `BrowserSessionFactory` starts an isolated DevTools MCP session and fresh browser profile for one agent run.
- `SiteReviewService` coordinates both independent agent reviews, limits traversal, persists results, and derives the comparison summary.
- `SiteReviewRepository` stores immutable review inputs, observations, artifacts, and final reports.

The service creates two sessions for each request:

```text
authorized Discord request
  -> validate initial URL
  -> Codex review session  -> isolated Chrome + DevTools MCP -> structured observation
  -> Claude review session -> isolated Chrome + DevTools MCP -> structured observation
  -> deterministic comparison + persisted audit -> Discord report
```

The sessions do not share tabs, cookies, local storage, cache, screenshots, or DevTools page selection. They start from the same normalized initial URL and receive the same focus instruction and page limit. This preserves independent review while avoiding the cost and risk of a full virtual-machine or container boundary.

## Explicit MCP policy

The current adapters intentionally disable ambient MCP access: Codex ignores user configuration and Claude rejects `mcp__*`. `/review-site` must keep that policy for `/ask` and `/debate` and add a narrowly scoped review-only exception.

For a review run, the bot supplies a generated, per-session Chrome DevTools MCP configuration to the relevant provider process. It must not reuse arbitrary user MCP configuration or the user's logged-in Chrome profile. Startup probes verify the intended MCP server and only the required read-only inspection capabilities before an agent begins; a missing or incompatible capability fails the review safely.

The provider-specific adapters expose only a reviewed allowlist equivalent to:

- create or select a review page;
- navigate to an approved URL and wait for load;
- inspect accessibility/rendered snapshots;
- capture screenshots at desktop and mobile viewports;
- read non-sensitive console errors and bounded network summaries;
- follow approved same-origin navigation.

The host, not either model, owns URL validation, page-count accounting, artifact paths, and the tool policy. The first release does not expose arbitrary DevTools script evaluation, cookie access, local-storage access, request replay, downloads, file chooser interaction, arbitrary headers, or an unrestricted `mcp__*` wildcard.

Public interaction testing is deliberately limited to route/navigation and presentation controls that the host classifies as non-submitting. Forms, password fields, file inputs, content editing, checkout flows, destructive controls, and buttons that may submit state are excluded. A report says when a meaningful flow could not be tested under this policy rather than guessing.

## URL and network safety

`UrlPolicy` accepts only absolute `http` and `https` URLs. It rejects credentials in URLs, `file:`, `data:`, `javascript:`, local hostnames, literal loopback/private/link-local/reserved IP addresses, and non-default schemes.

Before each navigation and after each redirect, the host resolves the destination and rejects any address in loopback, private, link-local, multicast, carrier-grade NAT, documentation/reserved, or otherwise non-public ranges. The browser is configured so it cannot use a proxy supplied by the target URL. Cross-origin redirects are not followed; same-origin pages are limited to ten successfully visited canonical URLs per agent.

Every visited page has bounded navigation, rendered-content, screenshot, and network-summary sizes and timeouts. A failed page is recorded as an observation and does not cause the service to silently try unbounded alternatives.

Website text, DOM attributes, console text, and network responses are untrusted evidence. The agent instructions explicitly say that page content cannot authorize tool use, disclose secrets, change the review goal, or override the host policy. This protects against prompt injection delivered through the reviewed site.

## Evidence and persistence

Web evidence is distinct from tracked project-file evidence. The repository stores, at minimum:

- normalized initial URL, requested focus, authenticated Discord scope, and start/finish time;
- per-agent session identity and terminal status;
- canonical URL, redirect chain, page title, viewport, and visit order for each observation;
- content/screenshot hashes, local artifact path, bounded accessibility snapshot hash, and bounded console/network summary;
- the model's structured findings and links to the observations that support them;
- deterministic comparison counts and the complete report artifact.

Screenshots and large snapshots live under the application's data directory rather than SQLite blobs. SQLite stores relative, validated paths and hashes. Existing session, diagnostics, retention, and authorization rules apply. The Discord attachment is a copy of the persisted artifact, never the only record.

The review schema separates observed facts from recommendations:

- `observations`: visited URL, state, and directly observed behavior;
- `findings`: usability, visual, accessibility, and functional concerns with observation IDs;
- `uncertainties`: features excluded by policy, loading failures, or evidence that could not be verified;
- `recommendations`: clearly labeled suggestions that do not claim to be facts.

The host derives agreement only when both agents reference materially matching observations. It never lets presentation prose alter the underlying per-agent findings or counts.

## Error handling and cancellation

The command defers its Discord reply and exposes the existing `/stop` cancellation path. Cancellation terminates each provider process and its corresponding browser/MCP process tree, removes ephemeral browser profiles, and preserves already-complete artifacts as partial results when safe.

Specific user-facing outcomes include invalid or blocked URL, redirect blocked, unsupported browser capability, page limit reached, page timeout, provider unavailable, partial review, and cancelled review. Diagnostics redact paths, browser tokens, headers, cookies, and any accidental sensitive text.

## Testing and acceptance criteria

Unit tests cover URL parsing; public-address and redirect validation; same-origin canonicalization; page-count accounting; tool-policy decisions; prompt-injection instruction boundaries; artifact hashing; and deterministic comparison formatting.

Integration tests use a local controllable fixture server but exercise it only through an explicitly test-only browser policy. They prove that redirects to loopback/private targets are rejected, forms are never submitted, each agent gets distinct session/profile identifiers, the ten-page cap is enforced independently, screenshots and observations persist, cancellation cleans up both process trees, and long Discord reviews continue across messages.

An opt-in live smoke test against a public static site confirms desktop/mobile capture and both provider adapters' explicit DevTools MCP capability probe. It never uses real account credentials or a personal Chrome profile.

Success means an authorized user can issue `/review-site`, receive two independent evidence-backed assessments of up to ten same-origin public pages, see the reconciled report and screenshots in Discord, and verify from the attachment exactly what each agent observed.
