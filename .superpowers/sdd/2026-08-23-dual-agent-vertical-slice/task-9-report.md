# Task 9 Report: Structured Deliberation and Deterministic Verdicts

## Scope

Implemented the Task 9 deliberation layer in `src/debate`, plus the required persistence compatibility for the structured `cross-examination` phase discriminator.

## Requirements coverage

- Deterministic canonical claim/evidence IDs, duplicate claim merging, run-scoped provider-local IDs, origin preservation, and auditable invalid/missing evidence records.
- Host-only mechanical evidence resolution with tracked-path, containment, range, and SHA-256 checks. `VERIFIED` is documented and treated as byte identity only, not semantic truth.
- Compact, bounded cross-examination/final context with fail-closed `DEBATE_CONTEXT_LIMIT` behavior.
- Fresh stateless provider requests; requests contain only topic, protocol rules, schema discriminator, and compact board/context.
- Frozen per-provider model selection is resolved before session/process creation and passed unchanged to each provider call.
- Exact final-position verdict matrix is pure and fail-closed. Consensus without verified evidence is `UNSUPPORTED`; verdict values are deeply immutable through the Task 6 schema.
- Optional prose polishing is guarded by canonical deep comparison of verdict data.
- Initial failure returns `DEBATE_NOT_ESTABLISHED`; later failures/cancellation produce partial/cancelled outcomes and preserve completed state.
- Session, round, board, run, origin, final-position, and verdict persistence use existing immutable repositories.

## Files

- Added `src/debate/types.ts`, `claim-board.ts`, `evidence-canonicalizer.ts`, `context-builder.ts`, `evidence-resolver.ts`, `verdicts.ts`, `polish-report.ts`, and `debate-service.ts`.
- Added debate unit tests under `tests/unit/debate/`.
- Updated `src/storage/session-repository.ts` so structured provider calls may persist the schema discriminator `cross-examination` while legacy stored `cross_examination` records remain valid.

## TDD evidence

RED: `node node_modules/vitest/vitest.mjs run tests/unit/debate/verdicts.test.ts` initially failed with `Cannot find module '../../../src/debate/verdicts.js'`.

GREEN: the same test passed after the minimal deterministic verdict implementation (8 tests).

## Verification evidence

- `node node_modules/vitest/vitest.mjs run tests/unit/debate tests/integration/storage` — 10 files, 71 tests passed.
- `node node_modules/eslint/bin/eslint.js .` — passed.
- `node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit` — passed.
- `node node_modules/prettier/bin/prettier.cjs --check .` — passed.
- `git diff --check` — passed.

## Self-review and concerns

The implementation is limited to OBSERVE mode and does not carry hidden provider sessions/transcripts. Existing persistence integration passed after the phase compatibility addition.

The unit coverage establishes the principal deterministic helpers and current storage integration. Follow-on review should expand end-to-end fake-adapter coverage for every exhaustive protocol violation in the Task 9 brief, particularly later-phase `newEvidence` translation and all cancellation/model-observation edge cases.

## Commit

Pending commit by the Task 9 implementer: `feat: add structured dual-agent deliberation`.

## Reviewer fix round 1/5

RED: added a later-phase evidence regression to `claim-board.test.ts`; it failed because `appendPhaseEvidence` did not exist.

GREEN: later-phase `newEvidence` now canonicalizes into the next board, preserves origins, translates provider-local stance references, persists cross/final stance-evidence joins, and feeds resolved evidence into final verdict construction. Effective board count/byte limits are checked before every persisted initial/cross/final board and before final calls. Cross-round partial/cancelled state is retained as a terminal degradation over a later successful final round. Evidence paths are normalized project-relative before containment/tracked-file checks.

Verification: `node node_modules/vitest/vitest.mjs run tests/unit/debate tests/integration/storage` passed (10 files, 72 tests); ESLint, TypeScript, Prettier, and `git diff --check` passed.

Commit: `e360f73 fix: persist later-phase debate evidence`.

## Reviewer fix round 2/5

RED: an integration regression for a failed final round showed `addVerdict` rejected an auditable `UNRESOLVED` verdict because it only accepted completed/partial final rounds.

GREEN: terminal failed/cancelled final rounds now persist `UNRESOLVED` verdicts, and final provider requests are built through the same fail-closed byte/count bounded context mechanism used for cross-examination.

Verification: TypeScript passed; `tests/integration/storage/deliberation-repository.test.ts tests/unit/debate` passed (8 files, 63 tests).

## Compact input snapshot follow-up

Cross-examination and final calls now persist a dedicated immutable input-board snapshot before their rounds are created. The request carries that exact snapshot payload (including its unique snapshot version), and every run's `inputBoardId` points to it, so repository reconstruction returns the byte-identical compact board that the provider received.

Verification: TypeScript passed; debate/storage tests passed (10 files, 75 tests).

## Reviewer fix round 3/5

Compact snapshot versions now advance monotonically (`current + 1`), with the resulting output board advancing once more. The effective count/byte guard runs after this request-board rewrite, before persistence and provider invocation. Verification remains 75 debate/storage tests, typecheck, lint, formatting, and diff checks passing.

## Reviewer fix round 4/5

RED: the focused debate/storage run failed seven regressions. The new fake-provider service cases exposed missing normalized claim/evidence rows and origins on compact and carried boards, failed/cancelled final-outcome gaps, and the unchecked `9 -> 10` full-request byte transition. Existing storage collision tests also confirmed that `INSERT OR IGNORE` silently accepted duplicate provider-local origins.

GREEN: context construction now assigns the next snapshot version before checking the complete serialized request; the service repeats that effective request check before persistence or provider invocation. Compact input snapshots use the same normalized persistence path as output boards. Migration 4 scopes provider-local origin uniqueness to each board, while repository inserts fail loudly on same-board collisions. Claim/evidence joins are inserted only after both FK parents exist. Fake-provider end-to-end tests now cover happy, failed-final, cancelled-final, effective claim bounds, and the version-width byte boundary.

Verification: the scoped command `node node_modules/vitest/vitest.mjs run tests/unit/debate tests/integration/storage` passed (10 files, 81 tests). Fresh whole-project verification then passed: 27 test files / 260 tests, ESLint, TypeScript, Prettier, and `git diff --check`.

## Reviewer fix round 5/5

RED: a real fake-provider end-to-end regression ran both concrete CLI adapters through the bounded process runner, let Codex complete its final response, then aborted the shared controller while Claude's final process remained pending. The service crashed with `Final position requires a completed final response and finalized matching round output` because final-position persistence excluded a terminal `cancelled` round even when its producing run was completed and linked correctly.

GREEN: final-position persistence now accepts a finalized cancelled final round while retaining every existing producer invariant: the run must be a completed, response-bearing final run for the same session, round, provider, and exact output board. Failed/cancelled provider runs, non-final rounds, unfinished rounds, and mismatched links remain ineligible. The regression proves a cancelled debate report returns an `UNRESOLVED` verdict, persists Codex's auditable completed final position, records Claude as cancelled, finalizes the round/session as cancelled, and unregisters the active run.

Changed files: `src/storage/deliberation-repository.ts`, `tests/fake-agents/codex-cli.mjs`, `tests/fake-agents/claude-cli.mjs`, and `tests/unit/debate/debate-service.test.ts`.

Verification: focused RED reproduced the repository lifecycle error; focused GREEN passed (1 regression, 6 skipped); adjacent debate/storage/adapter verification passed (11 files, 92 tests); fresh whole-project verification passed with 27 test files / 261 tests, ESLint, TypeScript, Prettier, build, and `git diff --check` all exiting 0.

Implementation commit: `2753951 fix: preserve completed finals on cancellation`.

Concern: the fake-provider scenario intentionally cancels immediately after Codex's final process exits, before Claude's hanging process can finish. This deterministically exercises the mixed terminal state without relying on timing sleeps; production cancellation semantics remain unchanged.
