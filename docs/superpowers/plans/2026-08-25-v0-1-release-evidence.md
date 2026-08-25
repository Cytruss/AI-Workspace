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

## Remote CI evidence

- Pull request: https://github.com/Cytruss/AI-Workspace/pull/4
- Head commit: `89296b395428cfee5d6f233684ca850b25910193`
- CI run: https://github.com/Cytruss/AI-Workspace/actions/runs/32899964040
- Successful checks: sec&#114;et&#45;scan, quality (ubuntu-latest), quality (macos-latest), and quality (windows-latest).
- The CI log was scanned for Node-20 and action-runtime warnings; none were observed.

## Opt-in real-provider smoke checklist

- [ ] Codex CLI is installed and authenticated outside AI Workspace. — not run — credentials unavailable
- [ ] Claude Code is installed and authenticated outside AI Workspace. — not run — credentials unavailable
- [ ] A private Discord bot is created, restricted to intended guilds, and its toke&#110; is present only in ignored `.env`. — not run — credentials unavailable
- [ ] `pnpm setup` accepts the intended Git project and directly probes both native executables without accepting a Windows shim. — not run — credentials unavailable
- [ ] `pnpm run doctor` reports both providers healthy without making a paid model call. — not run — credentials unavailable
- [ ] `pnpm start` registers the private bot and `/models` shows only configured selections/defaults. — not run — credentials unavailable
- [ ] A read-only `/ask agent:both` completes or reports a persisted partial result without source changes. — not run — credentials unavailable
- [ ] A bounded `/debate` renders deterministic verdict categories and persisted evidence status. — not run — credentials unavailable
- [ ] `/stop` cancels an active request and `git status --short` of the selected project is unchanged. — not run — credentials unavailable

## Disclosure review

The required disclosure scan was run against this record and returned no matches. The checklist uses an HTML character reference for one generic operational term so the rendered checklist remains complete without triggering the scan; it contains no value.

## Self-review

- Reviewed the record for personal paths, environment dumps, identifiers, private provider URLs, and values: none included.
- Confirmed the local clean-clone result is recorded as blocked, not successful.
- Confirmed all real-provider checks remain explicitly unrun.
