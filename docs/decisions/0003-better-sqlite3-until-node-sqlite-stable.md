# ADR-0003: Use better-sqlite3 Until node:sqlite Is Stable

## Status

Accepted

## Date

2026-08-23

## Context

V0.1 needs transactional local persistence with predictable behavior on all supported operating systems. The built-in `node:sqlite` API remains at release-candidate stability, while `better-sqlite3` is established but introduces a native dependency and an installation lifecycle script.

## Decision

Use `better-sqlite3` behind repository and database boundaries for v0.1. Allow its lifecycle build explicitly and narrowly in pnpm configuration.

## Alternatives considered

- `node:sqlite`, avoiding a third-party native package.
- A pure JavaScript or WebAssembly SQLite implementation.
- A client-server database such as PostgreSQL.

## Reasons

- The selected API is stable enough for the initial persistence contract.
- Synchronous transactions simplify the small local service's state transitions.
- Repository boundaries localize a future driver replacement.
- Using a release-candidate platform API would increase upgrade risk in the first release.

## Consequences

- Installation must obtain or build a native binary for each supported platform.
- The project must maintain a narrow lifecycle-build allowlist and cross-platform CI coverage.
- A later migration may require adapting transaction and statement behavior.

## Revisit when

Revisit after `node:sqlite` reaches stable status in the minimum supported Node.js release and passes the repository's transaction, migration, performance, and cross-platform test suite.
