# Task 5 report — command integration safety regressions

## Scope

- Updated `tests/unit/cli/index.test.ts` to require onboarding dispatch before dotenv or configuration loading.
- Updated `tests/unit/cli/resolve-agent-command.test.ts` to require both `.cmd` and `.bat` shims to remain unresolved and unprobed.
- Retained the existing `tests/unit/cli/doctor.test.ts` provider-default/no-observed-model assertion; it already exercises the required capability-only semantics.
- No production edit was necessary: `src/index.ts` already dispatches `runOnboarding(paths)` before `loadEnvironment()` and `loadConfig()` (introduced by Task 1, commit `8566c9b`).

## RED/GREEN evidence

- RED: no feature-missing RED was available. The required direct onboarding dispatch and the existing doctor assertion were already implemented by completed earlier tasks. The new entrypoint regression therefore passed on its first runnable execution; reporting a synthetic RED would be inaccurate.
- Initial command attempt: `pnpm vitest run ...` could not resolve `vitest` in this Windows sandbox. The direct local Vitest binary was used instead.
- Initial direct-binary run: blocked before test collection because the sandbox prohibited Vite from writing its temporary config bundle under `node_modules/.vite-temp`.
- GREEN: after allowing the shared worktree's normal test-time temporary writes, the focused suite passed: 3 files, 13 tests, 0 failures.

Command that passed:

```text
C:\Users\ostro\Gitrepo\AI-Workspace\.worktrees\windows-onboarding-implementation\node_modules\.bin\vitest.cmd run tests/unit/cli/index.test.ts tests/unit/cli/resolve-agent-command.test.ts tests/unit/cli/doctor.test.ts
```

## Limits

- This task intentionally did not change start or doctor production behavior.
- The requested `pnpm vitest run ...` invocation is not runnable in this host because pnpm does not resolve the installed local Vitest binary; the equivalent local binary command above was used.
- Only the focused regressions were run. Native/runtime-wide verification remains subject to the preflight limitation recorded in `progress.md` (host Node 24.18.0 and unavailable `better-sqlite3` native build prerequisites, rather than the repository's Node 22 target).
