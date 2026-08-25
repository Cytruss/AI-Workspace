# AI Workspace

AI Workspace is an OBSERVE-only Discord workspace for parallel Codex and Claude analysis of Git projects. Read the architecture decisions in [docs/decisions/README.md](docs/decisions/README.md) before operating it.

## Install and configure

Follow the private-operator runbook below on the machine that will run the bot. It covers the external accounts and CLI authentication required before setup.

```text
pnpm install --frozen-lockfile
```

## Private Discord, Codex, and Claude setup

AI Workspace is intended for a private Discord bot, not a public multi-tenant service. Do these steps on the machine that will run `pnpm start`.

1. Install Node.js 22 or later, pnpm 11, and Git. Clone this repository and run `pnpm install --frozen-lockfile`.
2. Install and authenticate the native [Codex CLI](https://developers.openai.com/codex/cli/) and [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview) separately. AI Workspace never stores either provider's login credential. On Windows, use a directly executable native `.exe`; do not configure a `.cmd` or `.bat` shim.
3. In the [Discord Developer Portal](https://discord.com/developers/applications), create an application, add a bot, and keep it private. Under OAuth2 URL Generator select `bot` and `applications.commands`; grant only the permissions needed for the bot to view its intended channel and send its own command responses. Invite it only to guilds you control.
4. Enable Discord Developer Mode, then copy the intended guild ID and your user ID. Copy the Discord application ID from General Information. Treat the bot token as a password: do not put it in source control, screenshots, chat messages, shell history, or issue reports.
5. Run `pnpm setup`. Enter the Discord application ID, a comma-separated private guild allowlist, a comma-separated authorized-user allowlist, and one or more Git project entries in `id|name|absolute-root` form. For each provider, setup prompts for an optional native executable path, directly probes it, and requires confirmation before saving it; it then accepts zero or more `class|CLI ID|effort?|exact observed IDs|prefixes` model entries and an optional default model class. Model classes are optional local configuration, not entitlement claims; leave the model entries and default blank to use the provider default.
6. Enter the bot token only at the hidden `Discord token:` prompt, then answer `yes` to create local configuration. Setup writes the token only to ignored `.env` under the `AI_WORKSPACE_DISCORD_TOKEN` variable; application configuration and SQLite data live in the platform application-data directory.
7. Run `pnpm run doctor`. A missing executable, failed authentication/capability probe, unsupported safety contract, unsupported requested effort, or unavailable observed-model contract is an actionable failure. Doctor makes no paid model call. Fix the reported provider installation or configuration before starting the bot.
8. Run `pnpm start`. In an authorized Discord channel, first use `/models`, then `/switch project:<project ID entered during setup>`. Issue a small read-only request such as `/ask agent:both question:Summarize this project without changing files`. After the result, use `/debate topic:Identify the highest-risk module and justify the choice` for the selected project. Start with provider defaults unless you have configured and verified concrete model classes.
9. For cancellation verification, begin a deliberately long but read-only request and send `/stop`. Confirm the bot records cancellation and `git status --short` in the selected project remains unchanged.

This procedure does not prove account entitlement, effective managed provider settings, complete host read isolation, semantic truth of cited evidence, or zero provider cost before a managed fallback mismatch is rejected. Review the Safety and troubleshooting section before relying on a result.

## Discord commands

The runbook's smoke procedure uses `/models`, `/switch`, `/ask`, `/debate`, and `/stop`. Use `/projects` to list the registered project IDs and `/status` to view active or recent runs in the channel.

`/ask` supports Codex, Claude, or both. `/debate` uses structured initial claims, cross-examination, bounded rounds, final positions, and deterministic verdict rendering. It renders `CONSENSUS`, `DISAGREEMENT`, `REJECTED`, `UNRESOLVED`, and mechanical evidence status separately. Evidence verification establishes cited bytes and paths; it does not prove semantic truth.

Model classes are local configuration, not product availability or entitlement claims. Optional examples are Codex `sol`, `terra`, `luna` and Claude `opus`, `fable`, `sonnet`, `haiku`. Omit a provider selection to use its provider default. Each provider keeps one requested class fixed across a debate; aliases may evolve within a class, while optional exact pins may be configured. Accepted observed-model policies are literal exact IDs and literal prefixes. Unknown classes fail before process creation.

Ordinary user/project/local fallback settings are neutralized where the CLI supports it, but managed settings can outrank inline controls. Provider fallback can therefore run and incur cost before post-execution model-class rejection. Entitlement, effective managed settings, and runtime observation are not safely knowable in advance. Provider-default executions are unverified; a requested effort must be a reported allowed value or execution fails closed.

## Safety and troubleshooting

The adapters invoke direct argument arrays only, never a shell, and enforce provider capability gates, bounded context, process-tree cancellation, and Git integrity snapshots. They do not modify the selected Git project. Executable resolution is portable and shell-free: an explicitly configured native executable is checked first, then direct native executables in `PATH`, then narrow documented provider locations. On Windows `.cmd` and `.bat` shims are never parsed or executed. An npm `claude.cmd` shim is diagnostic evidence only; configure or install its native package `.exe` target. Setup never mutates `PATH`. This is not complete host read isolation: a local process may still read host-visible files outside the selected project according to operating-system permissions.

`pnpm run doctor` checks Node, Git, database, project, executable, and capability diagnostics. `pnpm doctor` invokes pnpm's own diagnostic command on current pnpm releases. The application doctor makes no paid model call and redacts home-relative executable details in shareable output. If it reports an unresolved executable, install/authenticate the native CLI or choose an explicit native path in setup. If a configured class fails verification, inspect its accepted-observation policy and provider-managed settings; do not relabel persisted evidence, provenance, or model verdicts.

Local data lives in `%APPDATA%\\ai-workspace` on Windows, `~/Library/Application Support/ai-workspace` on macOS, and `$XDG_DATA_HOME/ai-workspace` or `~/.local/share/ai-workspace` on Linux. SQLite data remains local.
