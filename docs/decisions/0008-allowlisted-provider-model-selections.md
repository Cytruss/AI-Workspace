# ADR-0008: Use Allowlisted Provider Model Selections

## Status

Accepted

## Date

2026-08-23

## Context

Operators may want different concrete Codex and Claude model classes for cost, latency, or capability. Model catalogs and account entitlements change independently, and the two providers do not share model identifiers or effort controls. Discord input must not become an unrestricted path to CLI arguments, and a multi-phase debate must remain reproducible.

## Decision

Configure an allowlist of at most 25 concrete selections per provider. Each selection maps a public `class` to an opaque exact `cliModelId` and optional provider-specific effort. Classes are unique within a provider. Operators can add future concrete classes and IDs through configuration without a code change.

Portable initial configuration has an empty allowlist and no `defaultModel`. Absence of a command option and unset `defaultModel` mean provider default; provider default is not displayed as an invented model class. Runs persist the selected class, requested/resolved CLI model ID, optional effort, and an observed model ID when provider output exposes one; nullable selection/model fields distinctly record provider-default behavior.

`/ask` and `/debate` expose separate optional `codex_model` and `claude_model` choices. They never accept a shared model option or a raw model ID. Discord registers the configured concrete classes as provider-specific choices, and `/models` lists choices and whether omission uses provider default. The host resolves and validates selections before any process starts. One resolved selection per provider is frozen for an entire debate and used in every initial, cross-examination, and final call.

Adapters pass resolved model IDs and efforts as direct argument-array values without a shell. Codex uses its probed model option and explicit CLI configuration override for reasoning effort; Claude uses its probed model and effort options. Unsupported or unauthorized model failures are actionable and never trigger fallback.

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

## Consequences

- Operators maintain mappings that match their accounts and installed CLI versions.
- Configuration validation and Discord registration enforce a 25-selection limit per provider.
- `doctor` can prove flag compatibility but normally cannot prove entitlement without making a paid call.
- A selected model becoming unavailable causes an actionable run failure rather than silent fallback.

## Revisit when

Revisit if either provider exposes a stable safe model-listing contract, Discord choice limits change, model selection becomes project-specific, or evaluation demonstrates a need for controlled per-round switching.

## Primary sources

- [OpenAI model catalog](https://developers.openai.com/api/docs/models)
- [Codex CLI exec argument source](https://github.com/openai/codex/blob/main/codex-rs/exec/src/cli.rs)
- [Claude Code CLI reference](https://code.claude.com/docs/en/cli-usage)
