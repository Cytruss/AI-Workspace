# ADR-0004: Use Hardened Local Agent CLIs

## Status

Accepted (supersedes the original SDK decision in commit `8565acc`)

## Date

2026-08-23

## Context

V0.1 must reuse each operator's local authentication while enforcing source non-modification, ambient configuration isolation, bounded output, cancellation, and complete descendant-process termination on Windows, macOS, and Linux. Both providers offer separately installed command-line tools with structured non-interactive output.

The Codex TypeScript SDK source exposes an `AbortSignal` and selected execution arguments, but it does not establish ownership of the complete descendant process tree or expose the complete set of ambient configuration and rule isolation controls required by this boundary. The upstream hardened-execution issue records the missing automation controls. The Codex CLI source exposes the required flags directly.

## Decision

Invoke separately installed and authenticated Codex and Claude Code CLIs through AI Workspace's bounded cross-platform process runner.

For Codex, require and use `exec`, `--ephemeral`, `--ignore-user-config`, `--ignore-rules`, `--json`, `--output-schema`, `--sandbox read-only`, and `--cd` or `-C`. For Claude, require and use non-interactive JSON or JSON-schema output, plan/read-only permission controls, disabled session persistence, and supported tool restrictions. Capability probing fails closed if any required flag is absent.

Do not depend on `@openai/codex-sdk` in v0.1.

## Alternatives considered

- The official `@openai/codex-sdk`, for its typed Node.js interface and structured events.
- Provider SDKs with application-managed API credentials.
- Bundling or automatically installing either CLI.
- Requiring only one provider integration.

## Reasons

- The project process runner owns the direct child and its process group/tree, making cancellation and forced descendant termination testable on every supported OS.
- Codex CLI flags explicitly disable session persistence, user configuration, and repository rule loading while selecting read-only sandboxing and structured output.
- Symmetric CLI adapters share output bounds, timeout handling, environment filtering, Git integrity checks, and failure semantics.
- Separate installation preserves operator-controlled versions and authentication.

## Consequences

- Both adapters depend on compatible local executables and strict capability probes.
- CLI flag or output changes require fixture and integration-test updates.
- AI Workspace must create and clean up bounded temporary JSON-schema files where a CLI requires a path.
- SDK conveniences are intentionally deferred until an SDK exposes equivalent isolation and process-ownership guarantees.

## Revisit when

Revisit if an official SDK exposes every required isolation flag, documents complete descendant-tree cancellation semantics, supports bounded structured output, and passes the same Windows, macOS, and Linux process-runner integration tests.

## Primary sources

- [Codex TypeScript SDK execution source](https://github.com/openai/codex/blob/main/sdk/typescript/src/exec.ts)
- [OpenAI Codex hardened-execution issue](https://github.com/openai/codex/issues/34802)
- [Codex CLI exec argument source](https://github.com/openai/codex/blob/main/codex-rs/exec/src/cli.rs)
