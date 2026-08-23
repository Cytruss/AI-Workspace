# Architecture Amendments Report

## Result

REMEDIATED — PENDING RE-REVIEW. The first and second architecture reviews failed. Their findings have been addressed in successive remediation commits, but this report does not claim review acceptance.

Architecture amendment commit: `8565acca7238b842076e9ee8eb0f5eed9a1a533a` (`docs: strengthen architecture for structured debate`).

Architecture/remediation history:

- `8565acca7238b842076e9ee8eb0f5eed9a1a533a` — initial architecture amendments.
- `2f25462a2fdf6f367d87c6492c1523752f5664d5` — initial amendment report and ledger evidence.
- `21d85d80e78eb1ca476ca255675577e88572ccda` — first-review remediation.
- `218d8c06d67e8e49f02833da7ca926e02cab9b1e` — second-review architecture remediation.

## Changed files

- `docs/decisions/README.md`
- `docs/decisions/0001-typescript-node-first-implementation.md`
- `docs/decisions/0002-apache-2-license.md`
- `docs/decisions/0003-better-sqlite3-until-node-sqlite-stable.md`
- `docs/decisions/0004-codex-sdk-and-claude-cli.md` (historical, superseded)
- `docs/decisions/0005-observe-security-boundary.md`
- `docs/decisions/0006-structured-deliberation.md`
- `docs/decisions/0007-hardened-local-agent-clis.md`
- `docs/superpowers/specs/2026-08-23-ai-workspace-design.md`
- `docs/superpowers/plans/2026-08-23-dual-agent-vertical-slice.md`
- `.superpowers/sdd/2026-08-23-dual-agent-vertical-slice/progress.md`
- `.superpowers/sdd/2026-08-23-dual-agent-vertical-slice/architecture-amendments-report.md`
- `package.json`
- `pnpm-lock.yaml`

No runtime source code was changed. The unused Codex SDK dependency was removed from the manifest and lockfile.

## First amendment verification evidence

The following commands were run after the final architecture edits:

| Command             | Result |
| ------------------- | ------ |
| `pnpm format`       | PASS; all formatter-covered files were unchanged. |
| `pnpm format:check` | PASS; all matched files use Prettier style. |
| `pnpm lint`         | PASS; exit 0. |
| `pnpm typecheck`    | PASS; exit 0. |
| `pnpm test`         | PASS; 1 test file and 1 test passed. |
| `pnpm build`        | PASS; exit 0. |
| `git diff --check`  | PASS; no whitespace errors. |

These checks passed for the first amendment, but the subsequent architecture review still failed on substantive design completeness. The first-pass command success did not establish review acceptance.

## Concerns

- `OBSERVE` prevents and detects project source modification but cannot provide complete host read isolation until an optional OS sandbox or container is designed.
- Both adapters remain coupled to the safety and structured-output capabilities of separately installed CLIs; capability uncertainty must continue to fail closed.
- `better-sqlite3` remains a native dependency until `node:sqlite` is stable in the minimum supported Node.js release and passes the repository's persistence tests.
- The structured protocol adds schema, persistence, and token overhead. Its bounded-context limits and deterministic verdict rules need implementation-time tests before quality can be evaluated with real providers.

## Failed review and remediation

The first review rejected the SDK process boundary, incomplete verdict derivation, unspecified debate bounds, non-reconstructible persistence, provider-assigned claim identity, inconsistent `/debate` options, and an incorrect future README ADR link.

Remediation now requires both CLIs to run through the bounded process runner; exhaustive final-stances-only verdicts; separate mechanical evidence resolution; immutable deep-compared verdicts; exact bounded `DebateConfig`; hashed board snapshots and fully linked calls; host-assigned canonical IDs with many-to-one origins; `/debate topic:<text> project:<id?>`; and the repository-root link `docs/decisions/README.md`.

The final verification evidence for this remediation is appended below before the remediation commit. Review status remains pending.

## Remediation verification evidence

| Command                          | Result |
| -------------------------------- | ------ |
| `pnpm install --frozen-lockfile` | PASS; lockfile was current and the Codex SDK package was removed. |
| `pnpm format`                    | PASS; all formatter-covered files were unchanged. |
| `pnpm format:check`              | PASS; all matched files use Prettier style. |
| `pnpm lint`                      | PASS; exit 0. |
| `pnpm typecheck`                 | PASS; exit 0. |
| `pnpm test`                      | PASS; 1 test file and 1 test passed. |
| `pnpm build`                     | PASS; exit 0. |
| `git diff --check`               | PASS; no whitespace errors. |

The complete remediation diff was inspected against each review finding. Tracked-file scans found no active SDK dependency or SDK-based implementation instruction, stale ADR filename, personal machine path, personal name, email address, project-specific sample identifier, Polish-language public text, or secret. Historical ledger text labels the rejected SDK choice as superseded rather than active.

Review status after these checks: PENDING RE-REVIEW.

## Second failed review and remediation

The second review rejected the rewritten ADR history, an incomplete Claude CLI boundary, a shared temporary-schema assumption, and incomplete canonical evidence identity/provenance. It also required the architecture fix to precede the report update so the report could name a real fix commit without self-reference.

Commit `218d8c06d67e8e49f02833da7ca926e02cab9b1e` restores the original ADR-0004 decision text with `Superseded` status and moves the controller-authorized hardened CLI decision to ADR-0007. ADR-0007 records that controller authority amended the binding brief after primary-source review.

Claude now has an exact fail-closed boundary: compatible version plus every essential flag is probed; runs require `--bare`, `--tools "Read,Glob,Grep"`, `--disallowedTools "mcp__*"`, `--permission-mode plan`, `--no-session-persistence`, `-p`, `--output-format json`, and one bounded inline `--json-schema` value. Bash, Edit, Write, Notebook, ambient MCP tools, and shell interpolation are outside the boundary. Codex alone receives a bounded private schema file, which is the only schema temporary removed in `finally`.

The spec, ADRs, plan types, migration sketch, repository interfaces, implementation steps, tests, and completion gate now define deterministic canonical evidence IDs, mechanically identical-reference merging, complete `evidence_origins`, claim/stance local-to-canonical translation, cross-provider ID reuse, within-run collision rejection, and retention of invalid/missing evidence for audit.

## Second-remediation verification evidence

| Command                          | Result |
| -------------------------------- | ------ |
| `pnpm install --frozen-lockfile` | PASS; lockfile was current. |
| `pnpm format`                    | PASS; all formatter-covered files were unchanged. |
| `pnpm format:check`              | PASS; all matched files use Prettier style. |
| `pnpm lint`                      | PASS; exit 0. |
| `pnpm typecheck`                 | PASS; exit 0. |
| `pnpm test`                      | PASS; 1 test file and 1 test passed. |
| `pnpm build`                     | PASS; exit 0. |
| `git diff --check`               | PASS; no whitespace errors. |

Tracked-file scans found no stale active ADR-0004 hardened-CLI link, active SDK dependency or implementation instruction, personal machine path, personal name, email address, project-specific identifier, secret, or non-English public prose. Historical ADR-0004 references to the SDK are intentionally retained as superseded decision history.

Review status after second remediation: PENDING RE-REVIEW.
