# Architecture Amendments Report

## Result

PASS. The first, second, third, fourth, and fifth architecture reviews failed and were addressed in successive remediation commits. The fifth re-review accepted the architecture amendments with no new Critical or Important findings.

Architecture amendment commit: `8565acca7238b842076e9ee8eb0f5eed9a1a533a` (`docs: strengthen architecture for structured debate`).

Architecture/remediation history:

- `8565acca7238b842076e9ee8eb0f5eed9a1a533a` — initial architecture amendments.
- `2f25462a2fdf6f367d87c6492c1523752f5664d5` — initial amendment report and ledger evidence.
- `21d85d80e78eb1ca476ca255675577e88572ccda` — first-review remediation.
- `218d8c06d67e8e49f02833da7ca926e02cab9b1e` — second-review architecture remediation.
- `83b698b3bf0f53738dd98e7dcdf244a3157b9fe6` — second-remediation report and ledger evidence.
- `12c1906cb65b697955732b0e5848a8843d2ee7d9` — third-review architecture remediation and model-selection decision.
- `847da0a3e3128fd7cc23b3a74e63a564fd63dccc` — third-remediation report and ledger evidence.
- `ba5bb22a45d9ef5532bd3092a8ce3f64fb898c46` — fourth-review model-execution, Claude fallback, and executable-discovery remediation.
- `0e568a6c348706168cea165c5eff2774786eeafc` — fourth-remediation report and ledger evidence.
- `366600941188c0afc8899f3bc5a43eb3587ab37f` — fifth-review managed-settings, native-executable, and effort-capability remediation.
- `2eb1f69ebcda98ef74a6876c5ff431d19ea2e530` — fifth-remediation report and ledger evidence.

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

| Command             | Result                                            |
| ------------------- | ------------------------------------------------- |
| `pnpm format`       | PASS; all formatter-covered files were unchanged. |
| `pnpm format:check` | PASS; all matched files use Prettier style.       |
| `pnpm lint`         | PASS; exit 0.                                     |
| `pnpm typecheck`    | PASS; exit 0.                                     |
| `pnpm test`         | PASS; 1 test file and 1 test passed.              |
| `pnpm build`        | PASS; exit 0.                                     |
| `git diff --check`  | PASS; no whitespace errors.                       |

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

| Command                          | Result                                                            |
| -------------------------------- | ----------------------------------------------------------------- |
| `pnpm install --frozen-lockfile` | PASS; lockfile was current and the Codex SDK package was removed. |
| `pnpm format`                    | PASS; all formatter-covered files were unchanged.                 |
| `pnpm format:check`              | PASS; all matched files use Prettier style.                       |
| `pnpm lint`                      | PASS; exit 0.                                                     |
| `pnpm typecheck`                 | PASS; exit 0.                                                     |
| `pnpm test`                      | PASS; 1 test file and 1 test passed.                              |
| `pnpm build`                     | PASS; exit 0.                                                     |
| `git diff --check`               | PASS; no whitespace errors.                                       |

The complete remediation diff was inspected against each review finding. Tracked-file scans found no active SDK dependency or SDK-based implementation instruction, stale ADR filename, personal machine path, personal name, email address, project-specific sample identifier, Polish-language public text, or secret. Historical ledger text labels the rejected SDK choice as superseded rather than active.

Review status after these checks: PENDING RE-REVIEW.

## Second failed review and remediation

The second review rejected the rewritten ADR history, an incomplete Claude CLI boundary, a shared temporary-schema assumption, and incomplete canonical evidence identity/provenance. It also required the architecture fix to precede the report update so the report could name a real fix commit without self-reference.

Commit `218d8c06d67e8e49f02833da7ca926e02cab9b1e` restores the original ADR-0004 decision text with `Superseded` status and moves the controller-authorized hardened CLI decision to ADR-0007. ADR-0007 records that controller authority amended the binding brief after primary-source review.

Claude now has an exact fail-closed boundary: compatible version plus every essential flag is probed; runs require `--bare`, `--tools "Read,Glob,Grep"`, `--disallowedTools "mcp__*"`, `--permission-mode plan`, `--no-session-persistence`, `-p`, `--output-format json`, and one bounded inline `--json-schema` value. Bash, Edit, Write, Notebook, ambient MCP tools, and shell interpolation are outside the boundary. Codex alone receives a bounded private schema file, which is the only schema temporary removed in `finally`.

The spec, ADRs, plan types, migration sketch, repository interfaces, implementation steps, tests, and completion gate now define deterministic canonical evidence IDs, mechanically identical-reference merging, complete `evidence_origins`, claim/stance local-to-canonical translation, cross-provider ID reuse, within-run collision rejection, and retention of invalid/missing evidence for audit.

## Second-remediation verification evidence

| Command                          | Result                                            |
| -------------------------------- | ------------------------------------------------- |
| `pnpm install --frozen-lockfile` | PASS; lockfile was current.                       |
| `pnpm format`                    | PASS; all formatter-covered files were unchanged. |
| `pnpm format:check`              | PASS; all matched files use Prettier style.       |
| `pnpm lint`                      | PASS; exit 0.                                     |
| `pnpm typecheck`                 | PASS; exit 0.                                     |
| `pnpm test`                      | PASS; 1 test file and 1 test passed.              |
| `pnpm build`                     | PASS; exit 0.                                     |
| `git diff --check`               | PASS; no whitespace errors.                       |

Tracked-file scans found no stale active ADR-0004 hardened-CLI link, active SDK dependency or implementation instruction, personal machine path, personal name, email address, project-specific identifier, secret, or non-English public prose. Historical ADR-0004 references to the SDK are intentionally retained as superseded decision history.

Review status after second remediation: PENDING RE-REVIEW.

## Third failed review, correction, and remediation

The third review found that the second-remediation report overstated evidence-reference completeness. Although canonical evidence IDs and origins were described, the provider contract still used one ambiguous stance shape: it did not separate phase-specific ID namespaces, prevent later claim creation, or define exact cross-examination/final board coverage. The migration sketch also omitted an explicit evidence-to-board foreign key. This report corrects that overstatement rather than treating the earlier check results as architecture acceptance.

Commit `12c1906cb65b697955732b0e5848a8843d2ee7d9` defines non-interchangeable `InitialPhaseResponse`, `CrossExaminationPhaseResponse`, and `FinalPhaseResponse` schemas across the spec and implementation plan. Initial alone creates provider-local claim/evidence drafts. Later stances use canonical claims, separate existing canonical evidence from response-local new evidence, reject every namespace/coverage/dangling/cross-run error, and canonicalize new evidence before the next board. Earlier stances never substitute for an exact final position.

The migration now explicitly references `claim_boards` from evidence rows, couples evidence to its session with a composite foreign key, couples origins to same-session runs, and couples stance/evidence joins to the same board. Planned migration/reconstruction tests reject orphan and cross-board evidence.

The same commit adds ADR-0008 for allowlisted concrete provider model selections. Config maps public concrete classes to opaque CLI IDs and optional effort, provider default is omission/null, `/ask` and `/debate` have separate `codex_model` and `claude_model` choices, `/models` reports configured choices, and each run persists nullable class/requested model/observed model/effort. One selection per provider remains fixed across a debate; doctor probes flags without a paid inference call and reports the account-entitlement limitation. Abstract quality profiles, raw Discord model strings, hardcoded-only catalogs, shared choices, per-round switching, and silent fallback are rejected.

## Third-remediation verification evidence

| Command                          | Result                                            |
| -------------------------------- | ------------------------------------------------- |
| `pnpm install --frozen-lockfile` | PASS; lockfile was current.                       |
| `pnpm format`                    | PASS; all formatter-covered files were unchanged. |
| `pnpm format:check`              | PASS; all matched files use Prettier style.       |
| `pnpm lint`                      | PASS; exit 0.                                     |
| `pnpm typecheck`                 | PASS; exit 0.                                     |
| `pnpm test`                      | PASS; 1 test file and 1 test passed.              |
| `pnpm build`                     | PASS; exit 0.                                     |
| `git diff --check`               | PASS; no whitespace errors.                       |

Tracked-file scans found no active abstract model-profile vocabulary, stale ADR-0008 filename, active SDK dependency/instruction, personal machine path/name/email, project-specific identifier, secret, or non-English public prose. Historical SDK text remains only in superseded ADR-0004.

Review status after third remediation: PENDING RE-REVIEW.

## Fourth failed review and remediation

The fourth review found that the third remediation overstated model-selection completeness. It did not define one normalized request/result model contract end to end, distinguish capability discovery from runtime observation, verify Claude's executed model class, neutralize ambient availability and classifier fallback, or cover a CLI installed outside the current process `PATH`. This report corrects the overstatement and records the review as failed.

Commit `ba5bb22a45d9ef5532bd3092a8ce3f64fb898c46` defines exact `ResolvedModelSelection`, `AgentCapabilities`, and `ModelExecution` contracts in the normative spec and plan. Ask and debate resolve an optional selection once and pass it unchanged to every provider call. Persistence, Discord results, and `/status` retain requested class/CLI ID/effort, every normalized observed model ID, verification, and failure diagnostics. Unknown classes fail before argument construction or spawn.

ADR-0008, ADR-0007, the spec, and adapter tasks now require Claude's bounded inline `--settings` value `{"fallbackModel":[],"switchModelsOnFlag":false}` together with `--bare`. The reviewed compatibility floor is Claude Code 2.1.233. JSON `modelUsage` is normalized and checked against bounded literal exact-ID/family-prefix policies: same-class alias version movement is accepted, cross-class use fails `MODEL_CLASS_CHANGED`, and absent observations for explicit selection fail `MODEL_OBSERVATION_UNAVAILABLE`. Classifier refusal and availability failure remain failures, never fallback. Requested effort is not represented as observed effort.

Setup and doctor now resolve commands in a portable order: configured explicit path, direct `PATH` lookup, then only narrow platform candidates. The plan includes `%APPDATA%\npm\claude.cmd`, the provider-documented Windows native launcher, and `~/.local/bin/claude` on macOS/Linux, with Windows/macOS/Linux tests and actionable diagnostics. Resolution never recursively scans a home directory, reads credentials/session state, invokes a shell, or mutates `PATH`; setup saves a discovered path only after confirmation. Local read-only discovery observed Claude Code 2.1.233 at the generic Windows npm-shim location while bare `claude` was absent from the current process `PATH`; no personal absolute path is recorded.

## Fourth-remediation verification evidence

| Command                          | Result                                                  |
| -------------------------------- | ------------------------------------------------------- |
| `pnpm install --frozen-lockfile` | PASS; lockfile was current.                             |
| `pnpm format`                    | PASS after sandbox permission allowed dependency reads. |
| `pnpm format:check`              | PASS; all matched files use Prettier style.             |
| `pnpm lint`                      | PASS; exit 0.                                           |
| `pnpm typecheck`                 | PASS; exit 0.                                           |
| `pnpm test`                      | PASS; 1 test file and 1 test passed.                    |
| `pnpm build`                     | PASS; exit 0.                                           |
| `git diff --check`               | PASS; no whitespace errors.                             |

The full architecture diff was inspected for spec/plan contradictions. Tracked-file scans found no personal absolute path, personal name, email address, numeric Discord identifier, secret, active SDK dependency/instruction, stale singular observed-model persistence contract, abstract model-profile vocabulary, or non-English public prose. Historical SDK text remains only in superseded ADR-0004 and ADR-0007's rejected alternative.

Review status after fourth remediation: PENDING RE-REVIEW.

## Fifth failed review and remediation

The fifth review found two remaining overstatements and one fail-open capability path. The fourth remediation treated Claude inline settings as if they could prevent all fallback, although managed and server-managed settings outrank `--settings`; it also allowed a Windows npm `.cmd` shim into executable discovery despite the no-shell boundary. Finally, an explicit effort could be passed when the probe did not expose an allowed-values list. This report records the review as failed and corrects the prior claims.

Commit `366600941188c0afc8899f3bc5a43eb3587ab37f` narrows ADR-0007, ADR-0008, the normative spec, and the implementation plan. `--settings` plus `--bare` now guarantees neutralization only of ordinary user, shared-project, and project-local fallback configuration. Managed policy may override those values, execute fallback, and incur provider work/cost. Explicit selections are validated after execution from `modelUsage`; cross-class use fails `MODEL_CLASS_CHANGED`, absent observation fails `MODEL_OBSERVATION_UNAVAILABLE`, and both retain safe audit/usage diagnostics. Provider-default remains unverified. Doctor and future README/security documentation must state the precedence and cost limitation. The ADRs cite the official Claude settings-precedence and model-configuration sources.

Windows discovery now rejects every `.cmd` and `.bat` path for selection, persistence, parsing, or execution. A `%APPDATA%\npm\claude.cmd` shim is diagnostic-only. The generic native npm candidate is `%APPDATA%\npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe`, alongside the provider-documented native launcher. Every accepted candidate must be a regular native executable and pass a direct `<candidate> --version` call through the bounded runner. Regression tests cover shim rejection, missing targets, native candidate selection, and proof that `cmd.exe` is never invoked. Local read-only evidence found a 160-byte npm shim whose native package executable directly returned Claude Code 2.1.233; no personal absolute path is recorded.

Explicit `requestedEffort` is now fail-closed: the capability probe must expose a bounded `allowedValues` list containing the exact value, or validation fails before spawn as `AGENT_EFFORT_UNSUPPORTED`. Omitted effort remains valid, and requested effort is never represented as observed effort.

## Fifth-remediation verification evidence

| Command                          | Result                                            |
| -------------------------------- | ------------------------------------------------- |
| `pnpm install --frozen-lockfile` | PASS; lockfile was current.                       |
| `pnpm format`                    | PASS; all formatter-covered files were unchanged. |
| `pnpm format:check`              | PASS; all matched files use Prettier style.       |
| `pnpm lint`                      | PASS; exit 0.                                     |
| `pnpm typecheck`                 | PASS; exit 0.                                     |
| `pnpm test`                      | PASS; 1 test file and 1 test passed.              |
| `pnpm build`                     | PASS; exit 0.                                     |
| `git diff --check`               | PASS; no whitespace errors.                       |

The complete architecture diff was inspected against all fifth-review findings. Tracked-file scans found no personal absolute path, personal name, email address, numeric Discord identifier, secret, active SDK dependency/instruction, fail-open effort rule, Windows shell-shim execution path, unconditional managed-fallback prevention claim, abstract model-profile vocabulary, or non-English public prose. Historical SDK text remains only in superseded ADR-0004 and ADR-0007's rejected alternative.

## Fifth re-review

PASS on 2026-08-23. The reviewer concluded that the amended architecture resolves the prior Critical and Important findings and reported no new Critical or Important findings.

Final architecture-amendment status: PASS.
