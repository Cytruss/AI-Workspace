# Security policy

AI Workspace is OBSERVE-only. Discord use is restricted by configured guild and user allowlists. Projects are validated Git roots; only Git-tracked symlinks that escape the project root are rejected, preserving dependency-manager layouts.

Provider execution is guarded by version/help capability gates, direct argument arrays, bounded runners, process-tree cancellation, and Git-integrity snapshots. Codex and Claude require their hardened read-only/plan-mode controls, explicit ambient-config and fallback-isolation flags where supported, model/effort controls, structured output, and observed-model reporting contracts. Ordinary configuration can be neutralized, but managed provider policy may outrank inline controls; fallback can incur cost before post-execution model-class validation rejects it.

Post-execution model-class verification never relabels persisted provider evidence, provenance, or verdicts. Integrity checks are a backstop, not complete host read isolation: the host may expose files outside a project according to OS permissions.

Tokens are read from `AI_WORKSPACE_DISCORD_TOKEN` in ignored `.env`; never commit tokens, credentials, user IDs, guild IDs, private project paths, or logs containing them. Report vulnerabilities privately to the maintainers with reproduction steps, impact, and a safe redacted proof of concept. Do not publish an exploit before a fix is available.
