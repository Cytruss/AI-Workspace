# ADR-0006: Use Structured Deliberation

## Status

Accepted

## Date

2026-08-23

## Context

The product must provide genuine, inspectable communication between Codex and Claude. Relaying unconstrained transcripts consumes unbounded context and makes conclusions difficult to audit. Delegating the verdict to a single synthesizing model can silently replace one agent's position or manufacture agreement.

## Decision

Use a structured deliberation protocol with:

1. independent initial claims and explicit evidence references;
2. a shared, persisted claim board;
3. cross-examination stances of `ACCEPT`, `DISPUTE`, or `UNCERTAIN`;
4. additional rounds only for unresolved material claims and only within a fixed round cap;
5. independent final positions; and
6. deterministic derivation of consensus and unresolved disagreements from recorded stances and final positions.

Each provider call is stateless by default and receives an explicit compact claim board. A model may polish the final presentation but cannot add, remove, or alter verdicts.

## Alternatives considered

- Relay complete, unconstrained transcripts between providers.
- Resume hidden provider sessions across turns.
- Ask a single synthesizer model to decide the final verdict.
- Run only independent answers without cross-examination.

## Reasons

- Claims, evidence, and stance transitions remain inspectable and reproducible.
- Deterministic verdict rules preserve disagreements instead of asking one model to erase them.
- Explicit bounded context treats providers symmetrically and limits token growth.
- Stateless calls reduce dependence on provider-specific session behavior.

## Consequences

- Schemas, persistence, validation, and protocol tests add implementation work.
- Structured prompts may feel less conversational and carry claim-board overhead.
- Unsupported evidence and partial provider failure require explicit degraded outcomes.
- Presentation polish is constrained by the recorded machine-derived verdict.

## Revisit when

Revisit if measured deliberation quality is worse than independent answers, schema overhead prevents useful work within provider limits, or a provider-neutral session mechanism becomes reproducible and fully auditable.
