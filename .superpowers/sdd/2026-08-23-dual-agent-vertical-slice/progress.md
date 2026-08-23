# SDD ledger — plan: docs/superpowers/plans/2026-08-23-dual-agent-vertical-slice.md

Branch: codex/dual-agent-vertical-slice
Branch base: 0d27451
Spec: docs/superpowers/specs/2026-08-23-ai-workspace-design.md
Baseline: no package.json exists, so there is no dependency setup or test suite to run before Task 1.

## Task status

| Work item               | Status      | Evidence                                                                 |
| ----------------------- | ----------- | ------------------------------------------------------------------------ |
| Task 1: foundation      | PASS        | Review accepted commits `88d3a00` and `57abf0c`; all quality gates pass. |
| Architecture amendments | PENDING RE-REVIEW | First and second reviews failed; both remediation rounds await re-review. |

## Pre-flight dependency scan

| Producer | Consumer | Shared file or interface                     | Finding                                                             |
| -------- | -------- | -------------------------------------------- | ------------------------------------------------------------------- |
| Task 1   | Task 11  | `package.json`, `.env.example`               | Consistent: Task 11 modifies the foundation created by Task 1.      |
| Task 2   | Task 3   | `ProjectConfig`                              | Consistent: canonical project validation consumes configured roots. |
| Task 2   | Task 6   | `AgentConfig`                                | Consistent: agent settings feed the registry and adapters.          |
| Task 2   | Task 11  | `getAppPaths`, `loadConfig`, `saveConfig`    | Consistent: CLI composition owns configuration I/O.                 |
| Task 3   | Task 7   | `captureGitIntegrity`, canonical roots       | Consistent: both adapters use the same integrity boundary.          |
| Task 3   | Task 8   | `ProjectService`, `RegisteredProject`        | Consistent: ask orchestration resolves validated projects.          |
| Task 3   | Task 11  | project validation                           | Consistent: setup validates projects before saving.                 |
| Task 4   | Task 8   | project/session repositories                 | Consistent: orchestration persists lifecycle state.                 |
| Task 4   | Task 9   | deliberation repositories                    | Consistent: the claim board and verdict inputs are fully auditable. |
| Task 4   | Task 10  | active project and recent sessions           | Consistent: Discord commands read/write scoped state.               |
| Task 4   | Task 11  | database open/migrate/close                  | Consistent: startup owns persistence lifetime.                      |
| Task 5   | Task 6   | `ProcessResult`                              | Consistent: normalized process outcomes underpin agent results.     |
| Task 5   | Task 7   | `runProcess`, termination                    | Consistent: adapters delegate all process handling.                 |
| Task 5   | Task 11  | graceful shutdown                            | Consistent: startup cancels active process trees.                   |
| Task 6   | Task 7   | `AgentAdapter`, safe environment, help flags | Consistent: adapters implement and reuse the shared boundary.       |
| Task 6   | Task 8   | `AgentRegistry`, `AgentResult`               | Consistent: orchestration is CLI-independent.                       |
| Task 6   | Task 9   | structured response schemas                  | Consistent: deliberation consumes normalized provider-neutral data. |
| Task 6   | Task 10  | capability probes                            | Consistent: `/projects` can report adapter availability.            |
| Task 6   | Task 11  | registry composition                         | Consistent: startup constructs the registered adapters.             |
| Task 7   | Task 8   | Codex and Claude adapters                    | Consistent: both are selected through `AgentRegistry`.              |
| Task 7   | Task 9   | structured provider calls                    | Consistent: debate uses both adapters through stable schemas.       |
| Task 7   | Task 11  | provider configuration and diagnostics       | Consistent: doctor and startup own adapter construction.            |
| Task 8   | Task 9   | `ActiveRuns`, `ConcurrencyGate`              | Consistent: debate shares bounded lifecycle infrastructure.         |
| Task 8   | Task 10  | `AskService`, `ActiveRuns`                   | Consistent: Discord remains a thin transport.                       |
| Task 8   | Task 11  | cancellation and shutdown                    | Consistent: startup cancels all active work.                        |
| Task 9   | Task 10  | `DebateService`, deterministic reports       | Consistent: Discord renders but does not decide verdicts.           |
| Task 9   | Task 11  | debate composition                           | Consistent: startup constructs structured deliberation.             |
| Task 10  | Task 11  | Discord runtime and command handler          | Consistent: Task 11 is the composition root.                        |

## Pre-flight task self-consistency scan

| Task    | Tests against implementation                                            | Files against later use                                     | Finding                                              |
| ------- | ----------------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------- |
| Task 1  | Build-info red/green matches `getBuildInfo`                             | Tooling is consumed by all tasks                            | Ruling recorded below for pre-existing `.gitignore`. |
| Task 2  | Path/schema cases match exported functions                              | Config types are consumed consistently                      | Consistent.                                          |
| Task 3  | Git-root, tracked-link, and integrity cases match APIs                   | Project and integrity APIs have named consumers             | Consistent.                                          |
| Task 4  | Migration/repository tests match schema and methods                     | Ask and deliberation state have explicit repositories       | Consistent.                                          |
| Task 5  | Fake modes cover every process outcome                                  | Result type is consumed by agent core                       | Consistent.                                          |
| Task 6  | Registry, environment, capability, and schema tests match APIs           | Types and helpers are consumed by adapters/orchestrator     | Consistent.                                          |
| Task 7  | Symmetric hardened CLI integration tests match both adapters              | Adapters are consumed through registry                      | Consistent; real provider smoke checks remain opt-in. |
| Task 8  | Single/both/failure/cancel/idempotency/concurrency cases match services | Discord and startup consume outputs                         | Consistent.                                          |
| Task 9  | Agreement/disagreement/failure/cap/cancellation/context cases match protocol | Persisted board feeds deterministic verdicts            | Consistent.                                          |
| Task 10 | Authorization/handler/format cases match command surface                | Runtime is composed by Task 11                              | Consistent.                                          |
| Task 11 | CLI and `/ask` plus `/debate` vertical-slice tests match composition     | Terminal milestone task                                     | Ruling recorded below for reply test boundary.       |

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

## Architecture amendment audit

First review status: FAILED on 2026-08-23.

Second review status: FAILED on 2026-08-23.

Remediation status: PENDING RE-REVIEW.

The failed review found that the Codex SDK choice did not establish the required process-tree and ambient-config isolation guarantees; verdict rules were not exhaustive; debate configuration was underspecified; persistence could not reconstruct every provider call; provider IDs and duplicate provenance were ambiguous; and command/documentation details were inconsistent.

The first remediation pivots to symmetric hardened local CLIs, removes the SDK dependency, defines the exact final-stances-only verdict matrix and mechanical evidence resolution, adds bounded `DebateConfig`, makes board/run/round/final-position/verdict persistence reconstructible, assigns canonical claim IDs in host code while preserving every provider origin, aligns `/debate topic` plus optional `project`, and fixes the future README ADR link.

The second remediation restores superseded ADR-0004 as historical record and creates ADR-0007 for the controller-authorized hardened design; defines Claude's exact bare/read-only/MCP-denied argument boundary and fail-closed version/flag probes; separates Codex file-schema transport from Claude's bounded inline schema; and adds deterministic canonical evidence IDs, many-to-one evidence origins, local-to-canonical claim/stance evidence joins, collision rules, and reconstruction tests. Architecture/remediation commits are `8565acca7238b842076e9ee8eb0f5eed9a1a533a`, `2f25462a2fdf6f367d87c6492c1523752f5664d5`, `21d85d80e78eb1ca476ca255675577e88572ccda`, and `218d8c06d67e8e49f02833da7ca926e02cab9b1e`. Final local evidence is recorded in the architecture amendment report; acceptance remains pending an independent re-review.

Second-remediation verification: `pnpm install --frozen-lockfile`, `pnpm format`, `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and `git diff --check` exited 0; Vitest reported one passing file and one passing test. Repository scans found no active SDK dependency/instruction, stale active ADR link, personal identifier/path/email, project-specific sample identifier, secret, or non-English public prose. Historical SDK text remains only in superseded ADR-0004. Status remains PENDING RE-REVIEW.
