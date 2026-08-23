# Architecture Amendments Report

## Result

REMEDIATED — PENDING RE-REVIEW. The first architecture review failed. The findings have been addressed, but this report does not claim review acceptance.

Architecture amendment commit: `8565acca7238b842076e9ee8eb0f5eed9a1a533a` (`docs: strengthen architecture for structured debate`).

## Changed files

- `docs/decisions/README.md`
- `docs/decisions/0001-typescript-node-first-implementation.md`
- `docs/decisions/0002-apache-2-license.md`
- `docs/decisions/0003-better-sqlite3-until-node-sqlite-stable.md`
- `docs/decisions/0004-hardened-local-agent-clis.md`
- `docs/decisions/0005-observe-security-boundary.md`
- `docs/decisions/0006-structured-deliberation.md`
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
