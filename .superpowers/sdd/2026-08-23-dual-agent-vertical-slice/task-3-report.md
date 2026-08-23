# Task 3 implementation report

Implementation commit: `64a45d4 feat: enforce authorized Git projects`

## What I implemented

- Added canonical project-root validation that rejects filesystem roots, the
  resolved user home, non-Git directories, and nested directories that are not
  the Git worktree top level.
- Enumerated symbolic links only from the Git index and rejected tracked links
  whose resolved canonical targets escape the project root. Untracked links and
  dependency-manager link layouts are not recursively scanned.
- Added exact normalized `git status --porcelain=v2 --untracked-files=all`
  integrity snapshots and comparison without requiring or modifying a clean
  worktree.
- Added `ProjectService` creation, listing, lookup, immutable return copies,
  canonical registered roots, and the stable error codes `PROJECT_NOT_FOUND`,
  `PROJECT_ROOT_INVALID`, and `PROJECT_EXTERNAL_SYMLINK`.
- All Git commands use direct `execFile` argument arrays with no shell.

## TDD evidence

### RED: initial interfaces

Command:

```text
pnpm vitest run tests/integration/permissions tests/unit/projects
```

Expected result: three failed suites because the Task 3 modules did not exist:

```text
Cannot find module '../../../src/permissions/git-integrity.js'
Cannot find module '../../../src/permissions/project-root.js'
Cannot find module '../../../src/projects/project-service.js'
Test Files  3 failed (3)
```

The first sandboxed attempt could not execute the installed Vitest binary, so
the same command was rerun with access to the explicitly assigned worktree; the
module-resolution failures above are the actual RED evidence.

### GREEN: initial implementation

Command:

```text
pnpm vitest run tests/integration/permissions tests/unit/projects
```

Result:

```text
Test Files  3 passed (3)
Tests  11 passed (11)
```

### RED: containment regression from self-review

Command:

```text
pnpm vitest run tests/integration/permissions/project-root.test.ts -t "accepts a tracked symbolic link to an in-root dot-prefixed directory"
```

Expected result: one failed test because the original containment predicate
mistook the in-root `..safe` directory for a parent-directory escape and threw
`PROJECT_EXTERNAL_SYMLINK`.

### GREEN: containment regression

The same focused command passed 1/1 after matching only `..` as a full path
segment.

## Verification

Exact Task 3 gate:

```text
pnpm vitest run tests/integration/permissions tests/unit/projects && pnpm lint && pnpm typecheck
Test Files  3 passed (3)
Tests  12 passed (12)
eslint exited 0
tsc --noEmit exited 0
```

Full repository gate:

```text
pnpm test && pnpm build && pnpm format:check && git diff --check
Test Files  6 passed (6)
Tests  45 passed (45)
tsc build exited 0
All matched files use Prettier code style
git diff --check exited 0
```

## Files changed

- `src/permissions/project-root.ts`
- `src/permissions/git-integrity.ts`
- `src/projects/project-service.ts`
- `tests/integration/permissions/project-root.test.ts`
- `tests/integration/permissions/git-integrity.test.ts`
- `tests/unit/projects/project-service.test.ts`

## Self-review

- Re-read the Task 3 brief, current plan/spec, progress ledger, ADRs, and
  implementer prompt before implementation.
- Confirmed index-only symlink enumeration and no working-tree recursion.
- Confirmed direct process argument arrays, canonical roots, exact dirty-state
  preservation, staged/unstaged/untracked detection, and immutable project
  results.
- Found and fixed the `..safe` containment false positive through a separate
  RED/GREEN cycle.
- No unrelated files were changed.

## Issues or concerns

None.

---

## Fix round 1 after initial review

Remediation commit: `9f6cfb5 fix: harden project integrity guard`

### Findings addressed

- Extended integrity snapshots with deterministic SHA-256 fingerprints for
  every path reported by NUL-delimited porcelain v2. Regular files are hashed
  through streams; symbolic links hash their link text and type without
  following targets; missing/type state is explicit; stat changes during a
  capture fail closed. Exact pre-existing dirty content is now preserved, not
  only its Git status class.
- Added coverage for same-size already-dirty tracked and untracked changes,
  already-staged changes, staged renames, unmerged paths, restored identical
  content, odd filenames, changed link text, and external target content that
  must not affect a link fingerprint.
- Parse every `git ls-files --stage -z` entry and validate each mode-120000
  object by its listed OID through `git cat-file blob <oid>`. Conflict stages
  1, 2, and 3 are each tested independently, with an all-safe conflict case.
- Inspect effective worktree links at stage-zero and unmerged symlink paths,
  rejecting dirty external junctions/symlinks even when the index blob is safe.
- Canonicalize dangling targets by walking to the nearest existing ancestor,
  resolving all intervening links/junctions, and appending the missing suffix.
  Loops, permissions, malformed link bytes, and other unexpected errors fail
  closed. The external-junction-plus-missing-suffix regression is covered.
- Preserved tracked-index-only enumeration, direct process argument arrays,
  cross-platform link-permission skips, and no dependency-tree recursion.

### TDD evidence

Initial RED command:

```text
pnpm vitest run tests/integration/permissions
```

The valid security regressions failed as expected: same-status dirty tracked
and untracked changes were not detected; safe index blobs hid external
effective stage-zero and unmerged links; and a dangling target behind an
external junction was accepted. The first conflict fixture accidentally wrote
stage zero and the first odd filename used characters Windows cannot create;
both fixture issues were corrected rather than treated as product failures.

Corrected conflict-stage RED command:

```text
pnpm vitest run tests/integration/permissions/project-root.test.ts -t "validates every symbolic-link blob in conflict stages"
```

Result: 1/1 failed because an external stage-2 blob was accepted. The final
test checks external targets independently in stages 1, 2, and 3 plus an
all-safe conflict.

GREEN command:

```text
pnpm vitest run tests/integration/permissions tests/unit/projects
```

Result: 3 files passed, 27 tests passed.

### Verification

```text
pnpm vitest run tests/integration/permissions tests/unit/projects && pnpm lint && pnpm typecheck
3 files passed; 27 tests passed; lint and typecheck exited 0

pnpm test && pnpm build && pnpm format:check && git diff --check
6 files passed; 60 tests passed; build exited 0; formatting clean; diff check exited 0
```

### Files changed in fix round

- `src/permissions/git-integrity.ts`
- `src/permissions/project-root.ts`
- `tests/integration/permissions/git-integrity.test.ts`
- `tests/integration/permissions/project-root.test.ts`
- `.superpowers/sdd/2026-08-23-dual-agent-vertical-slice/task-3-report.md`
- `.superpowers/sdd/2026-08-23-dual-agent-vertical-slice/progress.md`

### Self-review and concerns

- Fingerprint ordering is byte-deterministic and path parsing is NUL-safe.
- Raw Git status/index output is decoded with fatal UTF-8 handling so malformed
  names fail closed instead of being silently replaced.
- Link targets are fingerprinted without reading external target content.
- No remaining implementation concern; status is pending scoped re-review.

---

## Fix round 2 after scoped re-review

Remediation commit: `002067d fix: close project guard edge cases`

### Findings addressed

- Effective worktree-link inspection now runs for every unique path returned by
  `git ls-files --stage -z`, independent of index mode or stage. Index entries
  with mode `120000` still receive separate all-stage blob-target validation by
  listed OID.
- Added regressions for a tracked regular file replaced by an external
  junction/link, the corresponding safe internal replacement, and an unmerged
  regular index path whose worktree entry is an external link.
- Removed the constant directory fingerprint. If Git collapses a dirty path to
  a directory record, integrity capture now fails closed without recursive
  scanning via `GIT_INTEGRITY_UNSUPPORTED_DIRECTORY` and an actionable message.
- Added a nested untracked repository regression and retained a regression
  proving ordinary untracked-directory files are enumerated and fingerprinted
  individually.

### TDD evidence

RED command:

```text
pnpm vitest run tests/integration/permissions -t "tracked regular file replaced|unmerged regular path|nested repository"
```

Result: 3 expected failures. External links replacing a stage-zero regular file
and an unmerged regular path were accepted, while the nested repository
resolved to `? nested-repository/` with the same constant directory hash.

GREEN result for the same command: 4 passed (the three regressions plus the
matched safe internal replacement), 25 skipped.

### Verification

```text
pnpm vitest run tests/integration/permissions tests/unit/projects && pnpm lint && pnpm typecheck
3 files passed; 32 tests passed; lint and typecheck exited 0

pnpm test && pnpm build && pnpm format:check && git diff --check
6 files passed; 65 tests passed; build exited 0; formatting clean; diff check exited 0
```

The repository scan for the removed constant directory fingerprint and the old
effective-path-only name returned no matches.

### Files changed in fix round

- `src/permissions/git-integrity.ts`
- `src/permissions/project-root.ts`
- `tests/integration/permissions/git-integrity.test.ts`
- `tests/integration/permissions/project-root.test.ts`
- `.superpowers/sdd/2026-08-23-dual-agent-vertical-slice/task-3-report.md`
- `.superpowers/sdd/2026-08-23-dual-agent-vertical-slice/progress.md`

### Self-review and concerns

- All tracked index paths are deduplicated before effective worktree checks.
- Directory dirty entries fail closed with no arbitrary nested-repository scan.
- No remaining implementation concern; status is pending a second scoped
  re-review.

---

## Final review result

Final scoped re-review: **PASS**.

The reviewer confirmed that both remaining Important findings are resolved:
effective worktree-link inspection covers every unique tracked index path, and
collapsed dirty directory records fail closed without recursive scanning or a
constant fingerprint. No new Critical or Important findings remain.

Task 3 is complete with implementation commits `64a45d4`, `9f6cfb5`, and
`002067d`.
