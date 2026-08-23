# ADR-0001: Use TypeScript and Node.js for the First Implementation

## Status

Accepted

## Date

2026-08-23

## Context

The first implementation must integrate Discord, coordinate local processes, consume JSON and JSONL, and remain approachable to contributors on Windows, macOS, and Linux. Go and Rust offer attractive deployment or systems-safety properties but would require a different ecosystem and an early rewrite of the approved modular-monolith plan.

## Decision

Implement v0.1 with TypeScript on Node.js 22 or later.

## Alternatives considered

- Go, for simple static binaries and straightforward concurrency.
- Rust, for strong memory and type safety with fine-grained process control.

## Reasons

- `discord.js`, Node's cross-platform process APIs, and the selected validation and test tools integrate directly with Node.js.
- TypeScript is well suited to normalized schemas and JSON-based provider boundaries.
- The language is broadly accessible to likely contributors.
- Explicit module ports preserve the option to replace infrastructure or the runtime later.

## Consequences

- Distribution depends on a supported Node.js runtime and pnpm.
- Process-tree handling and native SQLite installation require cross-platform testing.
- TypeScript cannot provide the compile-time resource guarantees of Rust or the single-binary simplicity of Go.

## Revisit when

Revisit if measured runtime, distribution, reliability, or security requirements cannot be met with Node.js, or if a stable adapter boundary makes a partial runtime migration demonstrably cheaper than continued Node.js maintenance.
