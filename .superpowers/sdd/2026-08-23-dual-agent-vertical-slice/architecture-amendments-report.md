# Architecture Amendments Report

## Result

REMEDIATED — PENDING RE-REVIEW. The first, second, and third architecture reviews failed. Their findings have been addressed in successive remediation commits, but this report does not claim review acceptance.

Architecture amendment commit: `8565acca7238b842076e9ee8eb0f5eed9a1a533a` (`docs: strengthen architecture for structured debate`).

Architecture/remediation history:

- `8565acca7238b842076e9ee8eb0f5eed9a1a533a` — initial architecture amendments.
- `2f25462a2fdf6f367d87c6492c1523752f5664d5` — initial amendment report and ledger evidence.
- `21d85d80e78eb1ca476ca255675577e88572ccda` — first-review remediation.
- `218d8c06d67e8e49f02833da7ca926e02cab9b1e` — second-review architecture remediation.
- `83b698b3bf0f53738dd98e7dcdf244a3157b9fe6` — second-remediation report and ledger evidence.
- `12c1906cb65b697955732b0e5848a8843d2ee7d9` — third-review architecture remediation and model-selection decision.

## Changed files

- `docs/decisions/README.md`
- `docs/decisions/0001-typescript-node-first-implementation.md`
- `docs/decisions/0002-apache-2-license.md`
- `docs/decisions/0003-better-sqlite3-until-node-sqlite-stable.md`
- `docs/decisions/0004-codex-sdk-and-claude-cli.md` (historical, superseded)
- `docs/decisions/0005-observe-security-boundary.md`
- `docs/decisions/0006-structured-deliberation.md`
- `docs/decisions/0007-hardened-local-agent-clis.md`
- `docs/decisions/0008-allowlisted-provider-model-selections.md`
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

## Third failed review, correction, and remediation

The third review found that the second-remediation report overstated evidence-reference completeness. Although canonical evidence IDs and origins were described, the provider contract still used one ambiguous stance shape: it did not separate phase-specific ID namespaces, prevent later claim creation, or define exact cross-examination/final board coverage. The migration sketch also omitted an explicit evidence-to-board foreign key. This report corrects that overstatement rather than treating the earlier check results as architecture acceptance.

Commit `12c1906cb65b697955732b0e5848a8843d2ee7d9` defines non-interchangeable `InitialPhaseResponse`, `CrossExaminationPhaseResponse`, and `FinalPhaseResponse` schemas across the spec and implementation plan. Initial alone creates provider-local claim/evidence drafts. Later stances use canonical claims, separate existing canonical evidence from response-local new evidence, reject every namespace/coverage/dangling/cross-run error, and canonicalize new evidence before the next board. Earlier stances never substitute for an exact final position.

The migration now explicitly references `claim_boards` from evidence rows, couples evidence to its session with a composite foreign key, couples origins to same-session runs, and couples stance/evidence joins to the same board. Planned migration/reconstruction tests reject orphan and cross-board evidence.

The same commit adds ADR-0008 for allowlisted concrete provider model selections. Config maps public concrete classes to opaque CLI IDs and optional effort, provider default is omission/null, `/ask` and `/debate` have separate `codex_model` and `claude_model` choices, `/models` reports configured choices, and each run persists nullable class/requested model/observed model/effort. One selection per provider remains fixed across a debate; doctor probes flags without a paid inference call and reports the account-entitlement limitation. Abstract quality profiles, raw Discord model strings, hardcoded-only catalogs, shared choices, per-round switching, and silent fallback are rejected.

## Third-remediation verification evidence

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

Tracked-file scans found no active abstract model-profile vocabulary, stale ADR-0008 filename, active SDK dependency/instruction, personal machine path/name/email, project-specific identifier, secret, or non-English public prose. Historical SDK text remains only in superseded ADR-0004.

Review status after third remediation: PENDING RE-REVIEW.
