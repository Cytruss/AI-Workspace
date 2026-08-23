# SDD ledger — plan: docs/superpowers/plans/2026-08-23-dual-agent-vertical-slice.md

Branch: codex/dual-agent-vertical-slice
Branch base: 0d27451
Spec: docs/superpowers/specs/2026-08-23-ai-workspace-design.md
Baseline: no package.json exists, so there is no dependency setup or test suite to run before Task 1.

## Task status

| Work item               | Status | Evidence                                                                         |
| ----------------------- | ------ | -------------------------------------------------------------------------------- |
| Task 1: foundation      | PASS   | Review accepted commits `88d3a00` and `57abf0c`; all quality gates pass.         |
| Task 2: configuration   | PASS   | Re-review accepted `168b9f0` and `b37f38a`; all findings addressed, no new Critical or Important issues. |
| Task 3: project guard   | PASS   | Final scoped re-review accepted `64a45d4`, `9f6cfb5`, and `002067d`; all findings are resolved. |
| Task 4: persistence     | FAIL   | Provider-identity fix `2e9c83f` is implemented and pending the next scoped re-review.        |
| Architecture amendments | PASS   | Fifth re-review accepted all remediation; no new Critical or Important findings. |

Task 2: fix round 1/5 — reviewer found post-rename chmod could report failure after commit and chmod/cleanup errors were not correctly classified or preserved. Commit `b37f38a` makes destination rename the last fallible successful-path mutation, tolerates only documented unsupported/permission-denied POSIX chmod codes, rethrows unexpected chmod failures, and preserves primary write/chmod/rename errors if exact-temp cleanup fails. RED: 9 expected failures. GREEN: 27/27 regression tests; focused 32/32; full 33/33 with build, lint, typecheck, format check, and `git diff --check` clean. Status pending scoped re-review, not PASS.

Task 2: complete — scoped re-review PASS; all findings addressed, with no new Critical or Important issues. Implementation commits: `168b9f0` and `b37f38a`.

Task 3: fix round 1/5 — initial review found status-only integrity snapshots, stage-0-only index-link validation, unchecked effective worktree links, and lexical fallback for dangling targets. Commit `9f6cfb5` adds deterministic SHA-256 content/type/link-target fingerprints for every NUL-delimited dirty tracked/untracked path; covers staged, unstaged, rename, conflict, restored-content, odd-name, and link cases; validates every index symlink OID across stages 0–3; checks effective tracked/unmerged worktree links; and canonicalizes dangling targets through the nearest existing real ancestor. RED: expected dirty-content, conflict-stage, effective-link, and junction-ancestor regressions failed; the corrected conflict fixture independently failed before implementation. GREEN: focused 27/27 and full 60/60 with lint, typecheck, build, format check, and `git diff --check` clean. Status remains FAIL pending scoped re-review, not PASS.

Task 3: fix round 2/5 — scoped re-review found that effective worktree-link inspection still covered only index symlink modes and that collapsed dirty directory entries received a constant fingerprint. Commit `002067d` now inspects every unique tracked index path for an effective symlink/junction while retaining all-stage index-symlink blob validation. Integrity capture rejects dirty directory records without recursion using stable code `GIT_INTEGRITY_UNSUPPORTED_DIRECTORY`; ordinary untracked directories remain per-file snapshots through porcelain `--untracked-files=all`. RED: 3 expected regressions failed (tracked regular replacement, unmerged regular replacement, collapsed nested repository). GREEN: focused 32/32 and full 65/65 with lint, typecheck, build, format check, and `git diff --check` clean. Status remains FAIL pending a second scoped re-review, not PASS.

Task 3: complete — final scoped re-review PASS; both remaining Important findings are resolved and no new Critical or Important issues remain. Implementation commits: `64a45d4`, `9f6cfb5`, and `002067d`.

Task 4: fix round 1/5 — initial review found run/round tuple divergence, permissive JSON envelopes, incomplete semantic hashes, insufficient SQL/runtime state invariants, and missing adversarial persistence tests. The fix adds composite round/run phase-input FKs plus transactional reconstruction/output guards; bounded phase-discriminated plain-object request/response validation with stable corruption errors; complete canonical final-position/verdict semantic hashes; enum, temporal, duration, and transition constraints; response-before-output linkage; and direct adversarial tests for raw FK violations, malformed/oversized envelopes, partial selections, cross-session/cross-board links, duplicate evidence origins, rollback, and scalar/link/child hash tampering. RED: 7 expected regression failures. GREEN: focused 37/37 and full 102/102 with build, lint, typecheck, format check, and `git diff --check` clean. Status remains FAIL pending scoped re-review, not PASS.

Task 4: fix round 2/5 — first scoped re-review found final-position/verdict writes still lacked complete lifecycle ordering, nullable composite FKs skipped run/round validation, immutable hashes omitted record identity/timestamps, and claimed rollback/cross-session tests did not exercise the database at the required boundary. The fix requires completed valid final responses, finalized final rounds and compatible output boards before final positions; validates every verdict producer, persisted final stance, and deterministic classification before the last write; installs null-safe run/round tuple and output triggers; includes IDs/timestamps in semantic hashes; uses direct raw cross-session evidence-origin insertion; and proves rollback with temporary triggers that abort after the parent mutation. RED: 9 expected failures (8 product gaps plus one corrected assertion). GREEN: focused 50/50 and full 115/115 with build, lint, typecheck, format check, and `git diff --check` clean. Status remains FAIL pending scoped re-review, not PASS.

Task 4: fix round 3/5 — second scoped re-review found that nullable update paths still allowed a run's round link and finalized output link to be cleared, and debate-run loading silently accepted a missing round. Commit `e66c0cb` adds migration-v2 null-safe immutable-identity and write-once output triggers, a phase/link schema contract, ask-versus-debate runtime validation, and stable legacy corruption detection. Direct raw-SQL tests cover round/input/phase/session/purpose mutation, run and round output clearing/changing, a valid unlinked ask run, the valid null-to-matching-output sequence, and controlled legacy corruption. RED: 2 expected failures. GREEN: focused 41/41 plus adjacent 12/12, and full 118/118 with build, lint, typecheck, format check, and `git diff --check` clean. Status remains FAIL pending third scoped re-review, not PASS.

Task 4: fix round 4/5 — third scoped re-review found `agent_id` missing from immutable run identity, so a completed provider could be relabeled after final graph persistence. Commit `2e9c83f` adds migration-v3 null-safe provider identity immutability and load-time producer checks for claim/evidence origins, stances, final positions, and the provider-specific verdict slots. Tests reproduce the exact completed-final-graph mutation, prove raw SQL rejection, and use controlled legacy fixtures to prove stable corruption detection for final-position, verdict, origin, and stance identity divergence. RED: 3 expected failures. GREEN: focused 47/47 and full 122/122 with build, lint, typecheck, format check, and `git diff --check` clean. Status remains FAIL pending the next scoped re-review, not PASS.

## Pre-flight dependency scan

| Producer | Consumer | Shared file or interface                 | Finding                                                                          |
| -------- | -------- | ---------------------------------------- | -------------------------------------------------------------------------------- |
| Task 1   | Task 11  | `package.json`, `.env.example`           | Consistent: Task 11 modifies the foundation created by Task 1.                   |
| Task 2   | Task 3   | `ProjectConfig`                          | Consistent: canonical project validation consumes configured roots.              |
| Task 2   | Task 6   | `AgentConfig`                            | Consistent: agent settings feed the registry and adapters.                       |
| Task 2   | Task 7   | concrete model selections                | Consistent: adapters receive exact resolved selections and observation policies. |
| Task 2   | Task 8   | concrete model selections                | Consistent: ask resolves separate provider classes before runs.                  |
| Task 2   | Task 9   | `DebateConfig`, model selections         | Consistent: debate freezes bounds and one selection per provider.                |
| Task 2   | Task 10  | configured model classes                 | Consistent: Discord registers only provider allowlisted choices.                 |
| Task 2   | Task 11  | configuration and executable overrides   | Consistent: CLI composition owns config I/O and portable command discovery.      |
| Task 3   | Task 7   | `captureGitIntegrity`, canonical roots   | Consistent: both adapters use the same integrity boundary.                       |
| Task 3   | Task 8   | `ProjectService`, `RegisteredProject`    | Consistent: ask orchestration resolves validated projects.                       |
| Task 3   | Task 11  | project validation                       | Consistent: setup validates projects before saving.                              |
| Task 4   | Task 8   | project/session repositories             | Consistent: orchestration persists lifecycle state.                              |
| Task 4   | Task 9   | deliberation repositories                | Consistent: the claim board and verdict inputs are fully auditable.              |
| Task 4   | Task 10  | active project and recent sessions       | Consistent: Discord commands read/write scoped state.                            |
| Task 4   | Task 11  | database open/migrate/close              | Consistent: startup owns persistence lifetime.                                   |
| Task 5   | Task 6   | `ProcessResult`                          | Consistent: normalized process outcomes underpin agent results.                  |
| Task 5   | Task 7   | `runProcess`, termination                | Consistent: adapters delegate all process handling.                              |
| Task 5   | Task 11  | graceful shutdown                        | Consistent: startup cancels active process trees.                                |
| Task 6   | Task 7   | adapter/model contracts and capabilities | Consistent: adapters implement normalized request, result, and probe boundaries. |
| Task 6   | Task 8   | `AgentRegistry`, `AgentResult`           | Consistent: orchestration is CLI-independent.                                    |
| Task 6   | Task 9   | phase-discriminated response schemas     | Consistent: deliberation validates exact phase namespaces/coverage.              |
| Task 6   | Task 10  | capability probes                        | Consistent: `/projects` can report adapter availability.                         |
| Task 6   | Task 11  | registry composition                     | Consistent: startup constructs the registered adapters.                          |
| Task 7   | Task 8   | Codex and Claude adapters                | Consistent: both are selected through `AgentRegistry`.                           |
| Task 7   | Task 9   | structured provider calls                | Consistent: debate uses exact phase schemas and frozen selections.               |
| Task 7   | Task 11  | provider configuration and diagnostics   | Consistent: doctor and startup own adapter construction.                         |
| Task 8   | Task 9   | `ActiveRuns`, `ConcurrencyGate`          | Consistent: debate shares bounded lifecycle infrastructure.                      |
| Task 8   | Task 10  | `AskService`, `ActiveRuns`               | Consistent: Discord remains a thin transport.                                    |
| Task 8   | Task 11  | cancellation and shutdown                | Consistent: startup cancels all active work.                                     |
| Task 9   | Task 10  | `DebateService`, deterministic reports   | Consistent: Discord renders but does not decide verdicts.                        |
| Task 9   | Task 11  | debate composition                       | Consistent: startup constructs structured deliberation.                          |
| Task 10  | Task 11  | Discord runtime and command handler      | Consistent: Task 11 is the composition root.                                     |

## Pre-flight task self-consistency scan

| Task    | Tests against implementation                                                   | Files against later use                                 | Finding                                               |
| ------- | ------------------------------------------------------------------------------ | ------------------------------------------------------- | ----------------------------------------------------- |
| Task 1  | Build-info red/green matches `getBuildInfo`                                    | Tooling is consumed by all tasks                        | Ruling recorded below for pre-existing `.gitignore`.  |
| Task 2  | Path/schema cases match exported functions                                     | Config types are consumed consistently                  | Consistent.                                           |
| Task 3  | Git-root, tracked-link, and integrity cases match APIs                         | Project and integrity APIs have named consumers         | Consistent.                                           |
| Task 4  | Migration/repository tests match schema and methods                            | Ask and deliberation state have explicit repositories   | Consistent.                                           |
| Task 5  | Fake modes cover every process outcome                                         | Result type is consumed by agent core                   | Consistent.                                           |
| Task 6  | Registry, environment, capability, model, and phase-schema tests match APIs    | Types and helpers are consumed by adapters/orchestrator | Consistent.                                           |
| Task 7  | Hardened CLI, model-argument, and three-phase integration tests match adapters | Adapters are consumed through registry                  | Consistent; real provider smoke checks remain opt-in. |
| Task 8  | Single/both/failure/cancel/idempotency/concurrency cases match services        | Discord and startup consume outputs                     | Consistent.                                           |
| Task 9  | Phase/namespace/evidence/model/agreement/failure/cap cases match protocol      | Persisted board feeds deterministic verdicts            | Consistent.                                           |
| Task 10 | Authorization/model-choice/handler/format cases match command surface          | Runtime is composed by Task 11                          | Consistent.                                           |
| Task 11 | CLI and `/models` plus `/ask`/`debate` vertical-slice tests match composition  | Terminal milestone task                                 | Ruling recorded below for reply test boundary.        |

Ruling: Task 1 must modify and extend the existing `.gitignore` rather than create it — worktree safety required `.worktrees/` to be committed before isolation — if wrong, the only cost is a one-line merge adjustment in Task 1.

Ruling: Task 11's vertical-slice test should assert the framework-neutral formatted response model returned by the command handler, not a raw discord.js interaction object — this preserves the transport boundary required by the spec — if wrong, the test will need a small adapter-level rewrite without changing production behavior.

Ruling: Task 1 must pin TypeScript 5.9.3 instead of plan-mandated 7.0.2 because `typescript-eslint@8.67.0` declares `typescript >=4.8.4 <6.1.0` and refuses to start with 7.0.2; the approved spec mandates Node and platform support but no TypeScript version — if wrong, adopting TypeScript 7 later costs a dependency upgrade and one tooling commit.

Ruling: Task 1 must explicitly allow pnpm lifecycle builds only for `better-sqlite3` and `esbuild`, the two pinned dependencies that require installation scripts; this preserves pnpm's fail-closed default for every other package while making installs and quality scripts runnable — if wrong, installation will fail and the allowlist can be removed or narrowed in one manifest edit.

Ruling: Retain TypeScript rather than switch the MVP to Go or Rust because Discord.js, Node process orchestration, JSON/JSONL adapters, and contributor accessibility align with the approved modular-monolith design; Go's single binary and Rust's stronger systems guarantees do not offset the rewrite and ecosystem cost yet — if wrong, the adapter and domain boundaries limit a later runtime rewrite, but the cost would still be substantial.

Ruling: Retain `better-sqlite3` rather than raise the runtime floor and use `node:sqlite` because Node 24's built-in module is still Stability 1.2 (release candidate) as of 2026-08-23; narrow pnpm lifecycle permission is a smaller risk than coupling persistence to a release-candidate API — if wrong, Task 4's repository boundary makes a driver swap localized, at the cost of maintaining one native dependency meanwhile.

Superseded ruling from the failed first review: implement Codex through `@openai/codex-sdk@0.149.0`.

Remediation ruling: invoke a separately installed Codex CLI through the project process runner, require `--ephemeral`, `--ignore-user-config`, `--ignore-rules`, `--json`, `--output-schema`, read-only sandboxing, and explicit working-directory flags, and fail closed if any capability is absent. The SDK exposes an abort signal but does not establish the complete descendant-tree ownership or ambient configuration/rule isolation required by v0.1; if those guarantees become available later, ADR-0007 defines the revisit test. ADR-0004 is retained as superseded history rather than rewritten in place.

Ruling: Keep Claude on its separately installed CLI for Milestone 1 rather than bundle `@anthropic-ai/claude-agent-sdk`; require fail-closed compatible-version and flag probing plus `--bare`, the exact Read/Glob/Grep allowlist, explicit `mcp__*` denial, plan permission mode, no session persistence, print mode, JSON output, and a bounded inline schema argument. Bash, Edit, Write, Notebook, ambient MCP tools, and shell interpolation remain unavailable — if wrong, the adapter can migrate to an official SDK later, at the cost of maintaining CLI parsing in the first release.

Ruling: Task 3 must validate only Git-tracked symlinks using the index rather than recursively scanning the full working tree; recursive scanning would reject legitimate pnpm dependency links and scale with generated directories, while tracked source symlinks are the project-controlled isolation risk — if wrong, an untracked external symlink could remain readable, so native agent restrictions and the documented V0.1 read-isolation limitation remain necessary backstops.

Ruling: V0.1's enforceable promise is source non-modification, not complete read isolation from the host; Codex/Claude controls and root allowlisting do not constitute a portable OS security boundary for reads — if wrong, the wording is overly conservative, but no user receives a false security guarantee. Full read isolation remains an optional OS-sandbox/container milestone.

Ruling: Persist material technical choices as one Architecture Decision Record per decision under `docs/decisions/`, with an indexed README and explicit revisit triggers, rather than relying on chat history or one monolithic rationale file — if wrong, the cost is modest documentation overhead and the ADRs can later be consolidated without changing code.

Ruling: Replace transcript-centric debate plus a single authoritative synthesizer with a structured deliberation protocol: independent claims/evidence, claim-board cross-examination using ACCEPT/DISPUTE/UNCERTAIN, unresolved-issue rounds, independent final positions, and deterministic consensus/disagreement derivation; an optional model may edit prose but cannot change verdicts — if wrong, structured schemas add implementation and token overhead and can be simplified behind the debate engine boundary.

Ruling: Move the first working `/debate` flow into the currently executed vertical-slice milestone after the ask orchestrator, because agent-to-agent communication is the product's primary value rather than a secondary enhancement — if wrong, Milestone 1 grows by one engine task, persistence additions, and Discord wiring before the first public checkpoint.

Ruling: Debate turns are stateless by default and receive an explicit compact claim board rather than resuming provider-specific hidden sessions; this keeps Codex and Claude behavior symmetric, reproducible, and auditable — if wrong, debate coherence may be lower and provider session continuation can be added as an opt-in adapter capability later.

Ruling: Use phase-discriminated provider schemas rather than one generic response. Initial alone creates run-local claim/evidence drafts; cross-examination and final positions cover supplied canonical claims, separate existing canonical evidence from same-response new evidence, and reject wrong-phase fields and all namespace/coverage/dangling/cross-run errors — if wrong, later-phase claim creation may be needed, and ADR-0006 records that evaluation trigger.

Ruling: Expose allowlisted concrete provider model classes rather than abstract quality profiles or raw model strings. Config maps each class to an opaque CLI ID, optional requested effort, and bounded literal accepted-observation policy. Omission means provider default. Orchestration passes one immutable `ResolvedModelSelection` unchanged across a debate, while every run records a normalized `ModelExecution` with all observed IDs and verification — if wrong, ADR-0008 keeps the mapping reversible without changing the adapter boundary.

Ruling: Claude selected-model stability is post-execution concrete-class validation, not guaranteed pre-execution fallback prevention or permanent alias-to-version identity. Inline settings neutralize ordinary user/project/local fallback configuration, but managed/server policy can override them and incur work/cost before `modelUsage` validation rejects cross-class or absent observations. Store effort only as requested — if wrong, operators can narrow accepted observations to exact IDs or ADR-0008 can be revisited without weakening process isolation.

Ruling: Resolve agent executables by configured explicit native path, direct native `PATH` lookup, then narrow native platform candidates only. Windows `.cmd`/`.bat` shims are diagnostic-only; accept only regular `.exe` files that pass a direct bounded-runner version probe. Do not parse shims, recursively scan home, read credentials/sessions, invoke a shell, or mutate `PATH`; setup persists a verified path only after confirmation — if wrong, adding another provider-documented native candidate is a localized resolver change with platform tests.

Ruling: Treat explicit requested effort as unsupported unless the capability probe safely exposes a bounded allowed-values list containing it; fail before spawn with `AGENT_EFFORT_UNSUPPORTED`. Omitted effort remains valid — if wrong, a future official effective-effort contract can expand the capability without changing request or persistence types.

## Architecture amendment audit

First review status: FAILED on 2026-08-23.

Second review status: FAILED on 2026-08-23.

Third review status: FAILED on 2026-08-23.

Fourth review status: FAILED on 2026-08-23.

Fifth review status: FAILED on 2026-08-23.

Fifth re-review status: PASS on 2026-08-23; no new Critical or Important findings.

Remediation status: PASS.

The failed review found that the Codex SDK choice did not establish the required process-tree and ambient-config isolation guarantees; verdict rules were not exhaustive; debate configuration was underspecified; persistence could not reconstruct every provider call; provider IDs and duplicate provenance were ambiguous; and command/documentation details were inconsistent.

The first remediation pivots to symmetric hardened local CLIs, removes the SDK dependency, defines the exact final-stances-only verdict matrix and mechanical evidence resolution, adds bounded `DebateConfig`, makes board/run/round/final-position/verdict persistence reconstructible, assigns canonical claim IDs in host code while preserving every provider origin, aligns `/debate topic` plus optional `project`, and fixes the future README ADR link.

The second remediation restores superseded ADR-0004 as historical record and creates ADR-0007 for the controller-authorized hardened design; defines Claude's exact bare/read-only/MCP-denied argument boundary and fail-closed version/flag probes; separates Codex file-schema transport from Claude's bounded inline schema; and adds deterministic canonical evidence IDs, many-to-one evidence origins, local-to-canonical claim/stance evidence joins, collision rules, and reconstruction tests. The third review established that this description overstated completeness because phase-specific provider namespaces/coverage and an explicit evidence-board FK were still absent.

The third remediation defines exact initial/cross-examination/final provider schemas, forbids later claim creation, validates/translates existing versus same-response new evidence, adds orphan/cross-board evidence FKs/tests, and adds ADR-0008 plus concrete provider model-class selection across config, adapters, persistence, Discord, doctor, tests, and future public docs.

The fourth review found that model selection was not normalized across request, capabilities, result, persistence, and presentation; Claude fallback and runtime class observation were not enforced; and CLI discovery did not cover a safe executable outside the current process `PATH`. The fourth remediation adds the exact normalized model contracts, literal class-observation policy, Claude fallback-neutralizing settings and `modelUsage` verification, audit-preserving model failure codes, and portable explicit-path/PATH/narrow-candidate discovery with confirmation and platform tests.

The fifth review found that managed Claude settings outrank inline settings, so fallback cannot be prevented or cost-avoided at this boundary; the Windows npm command was a shell shim rather than a directly spawnable native executable; and explicit effort lacked fail-closed allowed-value validation. The fifth remediation narrows guarantees to post-execution class validation, rejects Windows `.cmd`/`.bat` while directly probing native `.exe` candidates, and requires effort membership before spawn.

Architecture/remediation history is `8565acca7238b842076e9ee8eb0f5eed9a1a533a`, `2f25462a2fdf6f367d87c6492c1523752f5664d5`, `21d85d80e78eb1ca476ca255675577e88572ccda`, `218d8c06d67e8e49f02833da7ca926e02cab9b1e`, `83b698b3bf0f53738dd98e7dcdf244a3157b9fe6`, `12c1906cb65b697955732b0e5848a8843d2ee7d9`, `847da0a3e3128fd7cc23b3a74e63a564fd63dccc`, `ba5bb22a45d9ef5532bd3092a8ce3f64fb898c46`, `0e568a6c348706168cea165c5eff2774786eeafc`, `366600941188c0afc8899f3bc5a43eb3587ab37f`, and `2eb1f69ebcda98ef74a6876c5ff431d19ea2e530`. Final local evidence is recorded in the architecture amendment report; the fifth re-review accepted the amendments with no new Critical or Important findings.

Third-remediation verification: `pnpm install --frozen-lockfile`, `pnpm format`, `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and `git diff --check` exited 0; Vitest reported one passing file and one passing test. Repository scans found no active abstract profile vocabulary, SDK dependency/instruction, stale active ADR link, personal identifier/path/email, project-specific sample identifier, secret, or non-English public prose. Historical SDK text remains only in superseded ADR-0004. Status remains PENDING RE-REVIEW.

Fourth-remediation verification: `pnpm install --frozen-lockfile`, `pnpm format`, `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and `git diff --check` exited 0; Vitest reported one passing file and one passing test. The formatter initially encountered sandbox-denied dependency reads, then passed after the permitted rerun. Repository scans found no personal absolute path/name/email, numeric Discord identifier, secret, active SDK dependency/instruction, stale singular observed-model contract, abstract model-profile vocabulary, or non-English public prose. Historical SDK text remains only in superseded ADR-0004 and ADR-0007's rejected alternative. Status remains PENDING RE-REVIEW.

Fifth-remediation verification: `pnpm install --frozen-lockfile`, `pnpm format`, `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and `git diff --check` exited 0; Vitest reported one passing file and one passing test. Repository scans found no personal absolute path/name/email, numeric Discord identifier, secret, active SDK dependency/instruction, fail-open effort rule, Windows shell-shim execution path, unconditional managed-fallback prevention claim, abstract model-profile vocabulary, or non-English public prose. Historical SDK text remains only in superseded ADR-0004 and ADR-0007's rejected alternative. The fifth re-review status is PASS.
