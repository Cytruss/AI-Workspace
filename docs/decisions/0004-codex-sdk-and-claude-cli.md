# ADR-0004: Use the Codex SDK and the Local Claude Code CLI

## Status

Accepted

## Date

2026-08-23

## Context

The two providers expose different supported automation paths. Codex has an official Node.js SDK with structured events and output support. The v0.1 product goal for Claude is to reuse an operator's separately installed and authenticated Claude Code CLI rather than introduce a different API-key authentication model.

## Decision

Implement the Codex adapter with the official `@openai/codex-sdk`. Implement the Claude adapter by directly spawning a separately installed and authenticated Claude Code CLI in non-interactive mode and consuming its JSON or JSON-schema output.

## Alternatives considered

- Spawn and parse raw Codex CLI JSONL without the SDK.
- Bundle or automatically install either provider CLI.
- Use the Claude Agent SDK with application-managed API credentials.
- Require only one provider integration.

## Reasons

- The Codex SDK provides a maintained structured integration boundary and working-directory controls.
- The Claude CLI preserves the operator's local Claude Code installation and authentication model.
- Separate normalized adapters keep provider mechanics out of orchestration and deliberation.
- Neither integration requires AI Workspace to install or authenticate third-party software automatically.

## Consequences

- The two adapters have intentionally different implementation mechanics.
- Claude availability depends on a compatible local executable and capability probes.
- Codex SDK upgrades and Claude CLI output changes require independent compatibility tests.
- Provider calls remain stateless by default; orchestration supplies all required context explicitly.

## Revisit when

Revisit if Claude offers a supported SDK path that preserves local user authentication, if the Codex SDK no longer meets read-only or structured-output needs, or if provider compatibility costs exceed the adapter-boundary benefits.
