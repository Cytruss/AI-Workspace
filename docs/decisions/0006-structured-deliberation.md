# ADR-0006: Use Structured Deliberation

## Status

Accepted

## Date

2026-08-23

## Context

The product must provide genuine, inspectable communication between Codex and Claude. Relaying unconstrained transcripts consumes unbounded context and makes conclusions difficult to audit. Delegating the verdict to a single synthesizing model can silently replace one agent's position or manufacture agreement.

## Decision

Use a structured deliberation protocol with:

1. independent initial claims with provider-local references and explicit evidence references;
2. deterministic host-assigned canonical claim and evidence IDs, complete many-to-one origin provenance for both, and immutable persisted claim-board snapshots;
3. cross-examination stances of `ACCEPT`, `DISPUTE`, or `UNCERTAIN`;
4. additional rounds only for unresolved material claims and only within a fixed round cap;
5. independent final positions; and
6. deterministic verdict derivation from exactly the two agents' final stances.

Use three non-interchangeable provider response schemas. `InitialPhaseResponse` alone contains provider-local claim drafts and evidence drafts. `CrossExaminationPhaseResponse` and `FinalPhaseResponse` contain stances over canonical claim IDs plus separately named existing canonical evidence IDs and response-local new-evidence IDs. Host code rejects wrong-phase fields, namespace mixing, missing/extra/duplicate claim coverage, and dangling or cross-run references before canonicalizing new evidence.

Only the initial phase may create claims in v0.1. Later disagreement is represented by `DISPUTE` or `UNCERTAIN` rationale and evidence against existing canonical claims. This deliberately bounds board growth and identity semantics; revisit the restriction if evaluation shows agents need material later-phase counterclaims that cannot be expressed against the initial board.

Earlier stances are audit history only. `ACCEPT` plus `ACCEPT` is `CONSENSUS`; `ACCEPT` plus `DISPUTE` in either order is `DISAGREEMENT`; `DISPUTE` plus `DISPUTE` is `REJECTED`; every pair containing `UNCERTAIN`, any missing/failed/cancelled agent, or anything other than exactly two valid final stances is `UNRESOLVED`.

Provider evidence IDs are run-local references only. After claim canonicalization, host code deterministically orders normalized evidence tuples, assigns monotonic `evidence-NNNN` IDs, merges mechanically identical path/range/hash references, preserves every source in `evidence_origins`, and translates all claim and stance references to canonical evidence IDs. Same-named local IDs from different providers cannot collide. Invalid and missing references remain auditable canonical records.

Host code resolves tracked in-root path and line/hash evidence mechanically as `VERIFIED`, `INVALID`, or `MISSING`; this validates cited bytes, not semantic truth. Consensus without verified evidence is visibly `UNSUPPORTED`.

Each provider call is stateless by default and receives an explicit compact claim board. A model may polish summary prose only. Host code deep-compares and rejects any change to immutable verdicts, classifications, stances, evidence/provenance, IDs, or counts.

## Alternatives considered

- Relay complete, unconstrained transcripts between providers.
- Resume hidden provider sessions across turns.
- Ask a single synthesizer model to decide the final verdict.
- Run only independent answers without cross-examination.

## Reasons

- Canonical claims and evidence, every provider origin, local-to-canonical translations, evidence resolution, call inputs/outputs, and stance transitions remain inspectable and reproducible.
- Deterministic verdict rules preserve disagreements instead of asking one model to erase them.
- Explicit bounded context treats providers symmetrically and limits token growth.
- Stateless calls reduce dependence on provider-specific session behavior.

## Consequences

- Schemas, persistence, validation, and protocol tests add implementation work.
- Structured prompts may feel less conversational and carry claim-board overhead.
- Unsupported evidence and partial provider failure require explicit degraded outcomes.
- Presentation polish is constrained by the recorded machine-derived verdict.

## Revisit when

Revisit if measured deliberation quality is worse than independent answers, later-phase claim creation is necessary to express material counterclaims, schema overhead prevents useful work within provider limits, or a provider-neutral session mechanism becomes reproducible and fully auditable.
