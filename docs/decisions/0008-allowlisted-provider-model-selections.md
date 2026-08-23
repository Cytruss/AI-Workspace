# ADR-0008: Use Allowlisted Provider Model Selections

## Status

Accepted

## Date

2026-08-23

## Context

Operators may want different concrete Codex and Claude model classes for cost, latency, or capability. Model catalogs and account entitlements change independently, and the two providers do not share model identifiers or effort controls. Discord input must not become an unrestricted path to CLI arguments, and a multi-phase debate must remain reproducible.

## Decision

Configure an allowlist of at most 25 concrete selections per provider. Each selection maps a public `class` to an opaque exact `cliModelId` and optional provider-specific effort. Classes are unique within a provider. Operators can add future concrete classes and IDs through configuration without a code change.

Each configured selection also has a bounded, literal observed-model policy: exact IDs and/or family prefixes that are compared as strings and are never compiled as regular expressions. This policy defines the concrete class even when an alias resolves to a newer version. A full `cliModelId` plus exact accepted IDs provides operator-controlled version pinning.

Portable initial configuration has an empty allowlist and no `defaultModel`. Absence of a command option and unset `defaultModel` mean provider default; provider default is not displayed as an invented model class. The normalized boundary is explicit: `AgentRequest` carries an optional immutable `ResolvedModelSelection { class, cliModelId, requestedEffort? }`; `AgentCapabilities` reports model-flag support, effort-flag support and safely knowable values, and observed-model reporting separately; and `AgentResult` carries a `ModelExecution` containing the requested fields, every normalized observed model ID, and `verified` or `unverified` verification. Runs persist that complete execution record. Nullable requested fields distinctly record provider-default behavior.

`/ask` and `/debate` expose separate optional `codex_model` and `claude_model` choices. They never accept a shared model option or a raw model ID. Discord registers the configured concrete classes as provider-specific choices, and `/models` lists choices and whether omission uses provider default. The host resolves and validates selections before any process starts. One resolved selection per provider is frozen for an entire debate and used in every initial, cross-examination, and final call.

Adapters pass resolved model IDs and efforts as direct argument-array values without a shell. Codex uses its probed model option and explicit CLI configuration override for reasoning effort; Claude uses its probed model and effort options. Ask and debate orchestration resolve once, then pass the same immutable selection into every applicable call. Unsupported or unauthorized model failures are actionable and never trigger fallback.

For Claude, AI Workspace passes an inline `--settings` JSON argument containing `{"fallbackModel":[],"switchModelsOnFlag":false}` in addition to `--bare`. The empty availability-fallback chain is the documented no-fallback form, and disabling flagged-message switching makes a classifier refusal a failed call in non-interactive mode rather than a model change. Capability probing requires `--settings` and initially version 2.1.233 or later, the conservative reviewed floor for the complete locally verified flag set and documented settings/output contracts; tests prove ambient user fallback settings cannot re-enable either path.

Claude JSON results must include `modelUsage` for every explicit selection. The adapter normalizes and sorts all model IDs in that object and verifies every ID against the selected class's literal exact-ID/prefix policy. A different class fails with `MODEL_CLASS_CHANGED`; absent observations fail with `MODEL_OBSERVATION_UNAVAILABLE`. Both failures retain bounded diagnostics and the attempted model-execution record for audit and are never formatted as a valid selected-model result. Provider-default runs preserve any observations but may remain `unverified`.

This is a model-**class** stability guarantee, not an immutable alias-to-version guarantee. An alias can resolve to a newer approved version in the same configured class. Effort is persisted as requested because neither CLI contract is assumed to report effective effort; unsupported configured effort fails capability validation before spawn, while any documented provider-side adjustment is reported separately and never treated as model-class verification.

`doctor` validates model and effort flag capabilities from version/help output without paid inference. It cannot prove account entitlement unless a provider later exposes a stable, safe, non-inference model-listing contract; entitlement is otherwise discovered only when the selected model runs.

Documented concrete examples are Codex classes `sol`, `terra`, and `luna` mapped to `gpt-5.6-sol`, `gpt-5.6-terra`, and `gpt-5.6-luna`, and Claude classes `opus`, `fable`, `sonnet`, and `haiku` mapped to their official CLI aliases. Accounts may not expose every example, so portable defaults do not insert them automatically.

## Alternatives considered

- Accept arbitrary unallowlisted model strings from Discord.
- Ship a hardcoded-only provider catalog.
- Introduce abstract `fast`, `balanced`, or `deep` quality profiles over concrete model classes.
- Use one ambiguous shared model choice for both providers.
- Permit model changes between debate rounds or phases.

## Reasons

- Provider-specific allowlists keep Discord input separate from raw CLI arguments.
- Concrete model-class names are already clear and avoid maintaining a second quality vocabulary.
- Opaque configurable IDs tolerate catalog changes without a release.
- Omission preserves a portable provider default without fabricating a class.
- Freezing selection across debate phases makes results reproducible and comparisons coherent.
- Persisted requested and observed values explain which concrete configuration produced every output.
- Literal accepted-observation policies support class verification without unsafe operator-supplied regular expressions.
- Availability fallback and classifier switching are disabled for Claude, so a selected class is never silently replaced by another class.

## Consequences

- Operators maintain mappings that match their accounts and installed CLI versions.
- Configuration validation and Discord registration enforce a 25-selection limit per provider.
- `doctor` can prove flag compatibility but normally cannot prove entitlement without making a paid call.
- A selected model becoming unavailable or refused causes an actionable run failure rather than silent fallback.
- Claude aliases may move to newer versions within the configured class; operators who require an exact version must configure a full ID and exact accepted observations.
- Provider-default executions may be unverified because no class was selected.

## Revisit when

Revisit if either provider exposes a stable safe model-listing or effective-effort contract, Discord choice limits change, model selection becomes project-specific, or evaluation demonstrates a need for controlled per-round switching.

## Primary sources

- [OpenAI model catalog](https://developers.openai.com/api/docs/models)
- [Codex CLI exec argument source](https://github.com/openai/codex/blob/main/codex-rs/exec/src/cli.rs)
- [Claude Code CLI reference](https://code.claude.com/docs/en/cli-usage)
- [Claude Code model configuration](https://code.claude.com/docs/en/model-config)
