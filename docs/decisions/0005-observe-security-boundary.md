# ADR-0005: Define the OBSERVE Security Boundary

## Status

Accepted

## Date

2026-08-23

## Context

AI Workspace runs locally authenticated agents against operator-selected repositories. Provider read-only controls and Git checks can enforce and detect project source non-modification, but they do not create a portable operating-system boundary that prevents all reads elsewhere on the host.

## Decision

`OBSERVE` guarantees source non-modification through mandatory provider controls plus exact pre-run and post-run Git integrity checks. It does not promise complete host read isolation. Full read isolation requires a future optional operating-system sandbox or container.

Project registration validates only symbolic links tracked by Git and rejects a tracked link whose resolved target escapes the canonical project root. It does not recursively reject untracked or dependency-manager links such as pnpm's `node_modules` layout.

## Alternatives considered

- Describe provider read-only mode as complete host isolation.
- Recursively scan every symbolic link in the working tree.
- Require a container or operating-system sandbox for every v0.1 run.
- Depend only on the post-run Git integrity check.

## Reasons

- The stated guarantee matches controls the application can verify across supported platforms.
- Provider controls prevent writes, while Git integrity checks detect tracked changes and untracked additions without modifying user state.
- Git-tracked links represent project-controlled source; scanning generated dependency trees would be slow and would reject legitimate layouts.
- A mandatory sandbox would make the first local release substantially harder to install consistently.

## Consequences

- An agent may retain whatever host read access its process and provider sandbox allow.
- Untracked external symlinks are not a project-registration guarantee.
- A detected source change fails the run and is never cleaned up automatically.
- Documentation and diagnostics must distinguish source non-modification from host read isolation.

## Revisit when

Revisit when a portable OS sandbox or container can be offered as an optional execution backend, when provider controls materially change, or when evidence shows Git-tracked-link validation is insufficient for the documented boundary.
