# ADR-0007: Use Hardened Local Agent CLIs

## Status

Accepted; supersedes [ADR-0004](0004-codex-sdk-and-claude-cli.md)

## Date

2026-08-23

## Context

V0.1 must reuse each operator's local authentication while enforcing source non-modification, ambient customization and MCP isolation, bounded output, cancellation, and complete descendant-process termination on Windows, macOS, and Linux. Both providers offer separately installed command-line tools with structured non-interactive output.

The Codex TypeScript SDK source exposes an `AbortSignal` and selected execution arguments, but it does not establish ownership of the complete descendant process tree or expose the complete set of ambient configuration and rule isolation controls required by this boundary. The upstream hardened-execution issue records the missing automation controls. The Codex CLI source exposes the required flags directly.

After reviewing those primary sources, the controller amended the binding architecture brief and authorized this replacement decision. A new ADR is required because an accepted historical decision must not be rewritten under the same number.

## Decision

Invoke separately installed and authenticated Codex and Claude Code CLIs through AI Workspace's bounded cross-platform process runner.

For Codex, require and use `exec`, `--ephemeral`, `--ignore-user-config`, `--ignore-rules`, `--json`, `--output-schema`, `--sandbox read-only`, and `--cd` or `-C`. Codex receives a restrictive JSON Schema through a private temporary file path.

For Claude, require and use `--bare`, `--tools "Read,Glob,Grep"`, `--disallowedTools "mcp__*"`, `--permission-mode plan`, `--no-session-persistence`, `-p`, `--output-format json`, and `--json-schema <compact-inline-json>`. The schema is one bounded argument, never a file path or shell fragment. `--bare` disables discovered MCP servers and customizations; the explicit `mcp__*` denial is defense in depth. Bash, Edit, Write, Notebook, and every tool other than Read, Glob, and Grep are unavailable.

Capability and minimum-version probing fails closed if any essential flag or behavior is absent. Do not depend on `@openai/codex-sdk` in v0.1.

Provider-local evidence IDs are untrusted run-scoped references. After claim canonicalization, host code deterministically assigns canonical `evidence-NNNN` IDs, merges mechanically identical path/range/hash references, retains invalid or missing references for audit, translates every claim/stance evidence link, and preserves each source in `evidence_origins`.

## Alternatives considered

- The official `@openai/codex-sdk`, for its typed Node.js interface and structured events.
- Provider SDKs with application-managed API credentials.
- Bundling or automatically installing either CLI.
- Requiring only one provider integration.

## Reasons

- The project process runner owns the direct child and its process group/tree, making cancellation and forced descendant termination testable on every supported OS.
- Codex CLI flags explicitly disable session persistence, user configuration, and repository rule loading while selecting read-only sandboxing and structured output.
- Claude bare mode, a minimal read-tool allowlist, and explicit MCP denial prevent discovered customizations or ambient MCP tools from expanding the boundary.
- Separate schema transports match the providers' documented contracts without shell interpolation.
- Symmetric CLI adapters share output bounds, timeout handling, environment filtering, Git integrity checks, and failure semantics.

## Consequences

- Both adapters depend on compatible local executables and strict capability/version probes.
- CLI flag or output changes require fixture and integration-test updates.
- AI Workspace creates and removes a bounded temporary schema file only for Codex; Claude's bounded schema JSON remains inline.
- Claude can inspect a project only through Read, Glob, and Grep.
- SDK conveniences are intentionally deferred until an SDK exposes equivalent isolation and process-ownership guarantees.

## Revisit when

Revisit if official SDKs expose every required isolation and MCP-denial control, document complete descendant-tree cancellation semantics, support bounded structured output, and pass the same Windows, macOS, and Linux process-runner integration tests.

## Primary sources

- [Codex TypeScript SDK execution source](https://github.com/openai/codex/blob/main/sdk/typescript/src/exec.ts)
- [OpenAI Codex hardened-execution issue](https://github.com/openai/codex/issues/34802)
- [Codex CLI exec argument source](https://github.com/openai/codex/blob/main/codex-rs/exec/src/cli.rs)
- [Claude Code CLI reference](https://code.claude.com/docs/en/cli-usage)
