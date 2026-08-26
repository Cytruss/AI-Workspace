# v0.1 release readiness evidence

## Clean-clone verification

An empty disposable directory outside every repository worktree was used to clone the current remote `main`. The clone was removed after the commands completed.

| Field | Observed value |
| --- | --- |
| Operating system | Windows 10.0.26200 |
| Node.js | v24.18.0 (major 24; Node 22 was unavailable locally) |
| pnpm | 11.19.0 |
| `main` commit | `aa8ecf2ca4ec3b0a704c6c0df933099983f9a166` |
| Completion time (UTC) | 2026-08-25T21:54:32Z |

| Command | Exit code | Result |
| --- | ---: | --- |
| `pnpm install --frozen-lockfile` | 1 | The native dependency build could not find the local Windows C++ toolchain. |
| `pnpm format:check` | 1 | Blocked by the failed dependency installation before the formatter ran. |
| `pnpm lint` | 1 | Blocked by the failed dependency installation before the linter ran. |
| `pnpm typecheck` | 1 | Blocked by the failed dependency installation before the type checker ran. |
| `pnpm test` | 1 | Blocked by the failed dependency installation before the test runner ran. |
| `pnpm build` | 1 | Blocked by the failed dependency installation before the build ran. |

Test total: unavailable — the test runner did not start. This is a local Windows prerequisite limitation, not a passing clean-clone result.

## Task 3 remote CI evidence

- Pull request: https://github.com/Cytruss/AI-Workspace/pull/4
- Head commit: `89296b395428cfee5d6f233684ca850b25910193`
- CI run: https://github.com/Cytruss/AI-Workspace/actions/runs/32899964040
- Successful checks: secret-scan, quality (ubuntu-latest), quality (macos-latest), and quality (windows-latest).
- The Task 3 CI log was scanned for Node-20 and action-runtime warnings; none were observed.

These results support Task 3 CI evidence only.

## Task 4 remote CI evidence

- Pull request: https://github.com/Cytruss/AI-Workspace/pull/5
- Head commit: `18d8f2d2798ce22dda5e19c4c4a4e71f5d1b3c67`
- CI run: https://github.com/Cytruss/AI-Workspace/actions/runs/32943395691
- Successful checks: secret-scan, quality (ubuntu-latest), quality (macos-latest), and quality (windows-latest).
- The immutable full run log confirms the reviewed maintained action versions and that application quality ran on Node 22. A full-log scan found no Node-20 action-runtime warning.

These results support Task 4 CI evidence only; they do not replace or reinterpret the Task 3 evidence above.

## Opt-in real-provider smoke checklist

- [ ] Codex CLI is installed and authenticated outside AI Workspace. — not run — credentials unavailable
- [ ] Claude Code is installed and authenticated outside AI Workspace. — not run — credentials unavailable
- [ ] A private Discord bot is created, restricted to intended guilds, and its token is present only in ignored `.env`. — not run — credentials unavailable
- [ ] `pnpm setup` accepts the intended Git project and directly probes both native executables without accepting a Windows shim. — not run — credentials unavailable
- [ ] `pnpm run doctor` reports both providers healthy without making a paid model call. — not run — credentials unavailable
- [ ] `pnpm start` registers the private bot and `/models` shows only configured selections/defaults. — not run — credentials unavailable
- [ ] A read-only `/ask agent:both` completes or reports a persisted partial result without source changes. — not run — credentials unavailable
- [ ] A bounded `/debate` renders deterministic verdict categories and persisted evidence status. — not run — credentials unavailable
- [ ] `/stop` cancels an active request and `git status --short` of the selected project is unchanged. — not run — credentials unavailable

## Disclosure review

The required broad disclosure scan was run against this record. It matches benign generic words, including `secret-scan` and `token` in the required checklist. A value-oriented manual review found no credential values, private identifiers, personal paths, authorization values, or token-shaped samples.

## Self-review

- Reviewed the broad-scan matches and confirmed they are generic labels rather than values.
- Reviewed the record for personal paths, environment dumps, private identifiers, private provider URLs, credential values, authorization values, and token-shaped samples: none included.
- Confirmed the local clean-clone result is recorded as blocked, not successful.
- Confirmed all real-provider checks remain explicitly unrun.
- Confirmed Task 3 CI evidence is not represented as Task 4 pull-request CI evidence.
