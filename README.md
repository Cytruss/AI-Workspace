# AI Workspace

AI Workspace is an OBSERVE-only Discord workspace for parallel Codex and Claude analysis of Git projects. Read the architecture decisions in [docs/decisions/README.md](docs/decisions/README.md) before operating it.

## Install and configure

Prerequisites on Windows, macOS, and Linux: Node.js 22 or later, pnpm 11, Git, a private Discord application, and separately installed and authenticated native [Codex CLI](https://developers.openai.com/codex/cli/) and [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview) CLIs. Clone the repository, then run:

```text
pnpm install --frozen-lockfile
pnpm setup
pnpm run doctor
pnpm start
```

Create a Discord application and bot in the Discord Developer Portal, invite it only to intended guilds, and provide its application ID, guild allowlist, and user allowlist during `pnpm setup`. Setup writes local configuration under the platform application-data directory and creates an ignored `.env` containing only `AI_WORKSPACE_DISCORD_TOKEN=<token>` after confirmation.

Executable resolution is portable and shell-free: an explicitly configured native executable is checked first, then direct native executables in `PATH`, then narrow documented provider locations. On Windows `.cmd` and `.bat` shims are never parsed or executed. An npm `claude.cmd` shim is diagnostic evidence only; configure or install its native package `.exe` target. Setup never mutates `PATH`.

## Discord commands

Use `/models` to inspect the configured provider-specific classes and defaults. Examples:

```text
/ask agent:both question:Summarize this project without changing files codex_model:sol claude_model:sonnet
/debate topic:Identify the highest-risk module and justify the choice project:demo codex_model:terra claude_model:opus
```

`/ask` supports Codex, Claude, or both. `/debate` uses structured initial claims, cross-examination, bounded rounds, final positions, and deterministic verdict rendering. It renders `CONSENSUS`, `DISAGREEMENT`, `REJECTED`, `UNRESOLVED`, and mechanical evidence status separately. Evidence verification establishes cited bytes and paths; it does not prove semantic truth.

Model classes are local configuration, not product availability or entitlement claims. Optional examples are Codex `sol`, `terra`, `luna` and Claude `opus`, `fable`, `sonnet`, `haiku`. Omit a provider selection to use its provider default. Each provider keeps one requested class fixed across a debate; aliases may evolve within a class, while optional exact pins may be configured. Accepted observed-model policies are literal exact IDs and literal prefixes. Unknown classes fail before process creation.

Ordinary user/project/local fallback settings are neutralized where the CLI supports it, but managed settings can outrank inline controls. Provider fallback can therefore run and incur cost before post-execution model-class rejection. Entitlement, effective managed settings, and runtime observation are not safely knowable in advance. Provider-default executions are unverified; a requested effort must be a reported allowed value or execution fails closed.

## Safety and troubleshooting

The adapters invoke direct argument arrays only, never a shell, and enforce provider capability gates, bounded context, process-tree cancellation, and Git integrity snapshots. They do not modify the selected Git project. This is not complete host read isolation: a local process may still read host-visible files outside the selected project according to operating-system permissions.

Run `pnpm run doctor` for Node, Git, database, project, executable, and capability diagnostics. `pnpm doctor` invokes pnpm's own diagnostic command on current pnpm releases. The application doctor makes no paid model call and redacts home-relative executable details in shareable output. If it reports an unresolved executable, install/authenticate the native CLI or choose an explicit native path in setup. If a configured class fails verification, inspect its accepted-observation policy and provider-managed settings; do not relabel persisted evidence, provenance, or model verdicts.

Local data lives in `%APPDATA%\\ai-workspace` on Windows, `~/Library/Application Support/ai-workspace` on macOS, and `$XDG_DATA_HOME/ai-workspace` or `~/.local/share/ai-workspace` on Linux. SQLite data remains local.
