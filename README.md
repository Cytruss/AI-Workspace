# AI Workspace

AI Workspace is an **OBSERVE-only** Discord workspace for parallel Codex and Claude analysis of Git projects. Read the architecture decisions in [docs/decisions/README.md](docs/decisions/README.md) before operating it.

This is a private-operator guide, written for a first-time Windows operator. It explains what you set up outside the repository, what stays on your machine, and what this application does **not** guarantee.

## Safety boundary

AI Workspace does not modify the selected Git project. It invokes provider CLIs with direct argument arrays, enforces capability checks and Git-integrity snapshots, and supports process-tree cancellation. It is not complete host read isolation: a local provider process can still read files visible to it under operating-system permissions.

Use a private bot, authorized private guilds, authorized operator accounts, and only projects that you intend to expose to the two provider CLIs. Do not paste, log, screenshot, commit, or share credentials. The Discord credential is removed from the environment passed to provider child processes; provider login credentials remain with their respective CLIs.

This guide does not promise a free test. A provider execution can consume paid usage. It also does not prove account entitlement, effective managed provider settings, semantic truth of cited evidence, or that a provider fallback will never occur. Managed settings can outrank inline controls; a fallback can incur cost before an observed model-class mismatch is rejected. Provider-default executions are unverified, and an unsupported requested effort fails closed.

## What you need before setup

On Windows, use Node.js 22, pnpm 11, and Git. Node 22 is the CI-tested application runtime and the preferred first-install path. Clone this repository into a working folder, open PowerShell in that folder, then install its dependencies:

```powershell
pnpm install --frozen-lockfile
```

### Recommended Windows setup: run `pnpm onboarding`

**New to AI Workspace on Windows? Start with the local onboarding walkthrough.** From the repository folder, run:

```powershell
pnpm onboarding
```

It checks the local prerequisites, explains what it finds, and leads you through the safest next step. Choose **Guided** when you want to make every machine change yourself. **Semi-automatic** is available only on Windows and asks for separate consent before every allowed prerequisite action; it never runs a shell command or silently installs software. In either mode, setup shows a redacted review of your configuration before it writes local files.

If you prefer to control every step manually instead, follow the [manual Windows setup guide](docs/guides/windows-manual-setup.md).

You also need:

- A Discord account that can install a bot into a private server you control.
- A private Discord server (a guild) and an operator account you will authorize.
- A separately installed and authenticated native Codex CLI and Claude Code CLI.
- At least one existing local Git project that you are willing to let the provider CLIs analyze.

### What is external and what is stored locally

| Item                                                                                                                  | Where it belongs                                  | Notes                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Discord application, bot, guild, and bot installation                                                                 | Discord                                           | Create these in the Discord Developer Portal; keep the bot private.                                                            |
| Codex and Claude accounts and their login sessions                                                                    | Each provider CLI                                 | AI Workspace does not store either provider's login credential.                                                                |
| Discord application ID, guild allowlist, authorized-user allowlist, project list, executable paths, and model choices | Local application-data directory                  | This is local configuration and local SQLite data, not repository configuration.                                               |
| Discord bot token                                                                                                     | Ignored `.env` in the AI Workspace working folder | Setup writes it only under `AI_WORKSPACE_DISCORD_TOKEN`; never copy the value into this README, source control, chat, or logs. |
| Application configuration and SQLite records                                                                          | `%APPDATA%\ai-workspace` on Windows               | On macOS and Linux, see the platform notes below.                                                                              |

The repository ignores `.env`, SQLite files, logs, build output, and dependency folders. Ignoring a file is not a reason to share its contents: keep credentials out of shell history, screenshots, issue reports, and diagnostic uploads.

## 1. Create a private Discord bot

Use the official [Discord Developer Portal](https://discord.com/developers/applications) and Discord's [bot quickstart](https://docs.discord.com/developers/quick-start/getting-started) as the source of truth for portal changes.

1. In the Developer Portal, select **New Application** (or **Create App**), give it a private working name, and select **Create**.
2. On **General Information**, copy the **Application ID**. Keep it private; use only a placeholder such as `<DISCORD_APPLICATION_ID>` in notes or tickets.
3. Open the application's **Bot** page. Create or confirm the bot user, then ensure **Public Bot** is disabled. A non-public bot can be added only by its owner. Do not enable privileged gateway intents: this application uses only the standard guild intent.
4. Still on **Bot**, use the portal control for the bot token only when you are ready to run local setup. Treat the token like a password. Do not put a value in source control, a command line, a screenshot, or a support request.
5. Open **Installation**. Because this is a private bot, set **Install Link** (sometimes labelled **Default Authorization Link**) to **None**, then save. Discord rejects a private app with a default authorization link; **None** is the intended private-app setting. It also hides **Default Install Settings**, so do not switch the app to public just to expose those controls. See Discord's [install-link reference](https://docs.discord.com/developers/resources/application#install-links) for the distinction between a default link and a manually created OAuth2 invitation.
6. Create a **guild-only** invitation instead. If your portal still offers **OAuth2** > **URL Generator**, select exactly `bot` and `applications.commands`. Otherwise, replace the two placeholders in this private, single-guild URL and open it yourself:

   ```text
   https://discord.com/oauth2/authorize?client_id=<DISCORD_APPLICATION_ID>&scope=bot%20applications.commands&permissions=35840&integration_type=0&guild_id=<GUILD_ID>&disable_guild_select=true
   ```

   `permissions=35840` requests only **View Channel**, **Send Messages**, and **Attach Files**. `integration_type=0` is Guild Install; `guild_id` plus `disable_guild_select=true` keeps the dialog pointed at that one private server. A non-public bot can be added only by its owner, who must also have permission to add apps to the selected server.

7. After the bot is present in the server, restrict it to the intended channel with that channel's permission overrides. Give the authorized human operator role or user—not the bot—**Use Application Commands** (sometimes labelled **Use Slash Commands**). AI Workspace does not subscribe to general message-content events; it receives its slash-command interactions. It does not need administrator, member, role-management, voice, or privileged-intent permissions.
8. Complete the invite only for the private server you control. Do not publish the manual URL or install the bot into a shared or public guild.

### Collect the three identifiers without publishing them

AI Workspace needs an application ID, one or more guild IDs, and one or more authorized user IDs. Discord's official [Developer Mode guide](https://support.discord.com/hc/en-us/articles/206346498-Where-can-I-find-my-User-Server-Message-ID) describes the current desktop flow.

1. In the Discord desktop client, select the gear next to your name to open **User Settings**.
2. Select **Advanced**, then turn on **Developer Mode**.
3. Right-click the private server icon and select **Copy Server ID**. This is a guild ID.
4. Right-click your own user profile in that server and select **Copy User ID**. This is the user ID that can operate the bot.
5. Copy the application ID from the portal's **General Information** page, not from a Discord message.

Keep each ID in your local setup prompt only. The application uses guild and user allowlists; it also limits each active project selection to the invoking guild, channel, and user.

## 2. Install and authenticate the provider CLIs

Do this before `pnpm setup`, outside an AI Workspace request. The setup program requires a directly executable native program, not a shell wrapper.

### Codex CLI

1. Follow the official [Codex CLI installation guide](https://developers.openai.com/codex/cli/) and choose its current Windows installation option.
2. In a terminal, run `codex --version`. Then run `codex` once and complete the browser sign-in flow offered by the CLI. This authenticates Codex itself; do not give its login credential to AI Workspace.
3. Identify the actual native executable that the CLI installation provides. On Windows, AI Workspace will accept a direct `.exe` only. It will reject a `codex.cmd` or `codex.bat` wrapper even if that wrapper works interactively in PowerShell.

### Claude Code

1. Follow the official [Claude Code Windows setup guide](https://code.claude.com/docs/en/getting-started). Its documented Windows package-manager option is `winget install Anthropic.ClaudeCode`.
2. Run `claude --version`, then run `claude` once and complete its sign-in flow. The credential remains with Claude Code.
3. Locate the native `claude.exe` for setup. Do not configure `claude.cmd` or `claude.bat`; an npm shim is diagnostic evidence only and AI Workspace will not parse or run it.

If `where.exe codex` or `where.exe claude` shows only `.cmd` or `.bat` results, stop there. Install or locate the provider's native `.exe`; do not bypass the check by editing `PATH`, renaming a shim, or entering a wrapper path. During setup, AI Workspace directly probes the executable with `--version` and asks before saving a portable path.

## 3. Run `pnpm setup` field by field

From the AI Workspace working folder, run:

```powershell
pnpm setup
```

Use placeholders in notes and screenshots. Never replace the placeholders below with real values outside the private prompt.

| Setup prompt                                                     | Enter                                                                  | Why it is needed                                                                                                                                                           |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Discord application ID:`                                        | `<DISCORD_APPLICATION_ID>`                                             | Identifies the Discord application when registering guild commands.                                                                                                        |
| `Discord guild IDs (comma-separated):`                           | `<GUILD_ID>[,<ANOTHER_GUILD_ID>]`                                      | Private-guild allowlist; at least one is required.                                                                                                                         |
| `Authorized user IDs (comma-separated):`                         | `<OPERATOR_USER_ID>[,<ANOTHER_OPERATOR_USER_ID>]`                      | Operator allowlist; at least one is required.                                                                                                                              |
| `Project id\|name\|absolute-root (blank to finish):`             | `project-one\|My project\|<ABSOLUTE_PROJECT_ROOT>`                     | Registers a project. The ID must be lowercase letters, digits, and hyphens; the root must be absolute. Enter each project on its own prompt, then submit a blank response. |
| `codex native executable path (optional):`                       | `<ABSOLUTE_PATH_TO_CODEX_EXE>` or blank                                | A blank asks setup to find a verified native executable. A supplied path must be a regular native executable.                                                              |
| `Save this portable native executable path for codex? (yes/no):` | `yes` after inspecting the reported `.exe`                             | Setup will not save an executable path without this confirmation.                                                                                                          |
| Codex model-class prompt                                         | Blank                                                                  | Leave this blank. The current Codex probe cannot report observed model IDs, so any configured Codex model class makes doctor unhealthy.                                    |
| `codex default model class (blank for provider default):`        | Blank                                                                  | Leave this blank too. Only provider-default Codex execution can pass the currently documented preflight.                                                                   |
| Claude prompts                                                   | Use the corresponding `.exe`, model entries, and default-class choices | The same native-executable and optional-model rules apply.                                                                                                                 |
| `Discord token:`                                                 | Paste the private bot token only into this hidden prompt               | It is written only to the ignored `.env` file as `AI_WORKSPACE_DISCORD_TOKEN`. Do not type it as a command argument.                                                       |
| `Create local configuration and .env now? (yes/no):`             | `yes` only after reviewing every answer                                | Writes local configuration and creates `.env`; if `.env` already exists, resolve that deliberately instead of overwriting it.                                              |

Model classes such as `sol`, `terra`, `luna`, `opus`, `fable`, `sonnet`, and `haiku` are optional local names, not claims that your account can use those models. For Codex, leave every model entry and its default blank: its current probe has no observed-model reporting, so any non-empty configured selection intentionally fails doctor. For Claude, an exact observed-model ID or literal prefix is required for a configured class. Provider-default execution is unverified.

## 4. Check the local machine with `pnpm run doctor`

Run this before starting the bot:

```powershell
pnpm run doctor
```

Doctor reports Node, then checks Git, the local database, each registered project, native executable resolution, and the providers' safety/model/effort/observation capabilities. Its provider probes execute only `--version` and `--help`; it makes no paid model call and cannot establish sign-in, account entitlement, or real-request readiness.

| Doctor outcome                                                                         | Action                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Both providers are available and no mandatory contract failure is reported             | Continue to `pnpm start`; the executable and capability preflight passed, but this is not an authentication or real-provider smoke test.                                                                                                                      |
| Native executable unresolved, version probe fails, or a `.cmd`/`.bat` shim is reported | Install or configure the provider's native `.exe`, then rerun setup or correct local configuration.                                                                                                                                                           |
| Executable or capability probe fails                                                   | Correct the native executable or supported non-interactive/read-only/structured-output configuration, then rerun doctor. Doctor cannot diagnose sign-in; verify authentication, entitlement, and real-request readiness only with an opt-in provider request. |
| Project is invalid                                                                     | Correct the registered absolute root and rerun setup.                                                                                                                                                                                                         |
| Config or database is unavailable                                                      | Check the local application-data directory and the ignored `.env`; do not post their contents.                                                                                                                                                                |
| A configured model class, effort, or observed-model policy is unsupported              | For Codex, leave all model selections and its default blank; only provider defaults can pass this preflight. For Claude, correct the local policy or use the provider default. Do not relabel persisted evidence or a verdict.                                |

Doctor's shareable output redacts home-relative executable details, but still review it before sharing. It warns when managed provider settings may override inline controls and when a fallback might incur cost before a model-class mismatch is rejected.

## 5. First private session

Only after you deliberately accept the provider-cost boundary, start the bot from the AI Workspace working folder. An opt-in provider request below—not doctor—is the first check of provider authentication, entitlement, and real-request readiness:

```powershell
pnpm start
```

The process registers these slash commands in every configured private guild, then logs in as the bot. Open the intended channel in an authorized guild while signed in as an authorized user. Start with `/projects`, then `/switch`, before making your first provider request. Every command below is read-only with respect to the selected Git project, but `/ask` and `/debate` can call providers and may incur cost. The examples use placeholders such as `<SESSION_ID>`; your bot returns real IDs and report text.

### Choose a model before you ask or debate

Use `/models` to see the local model classes that setup made available. Discord shows those classes as pickers—not as free-form model-ID fields—on the relevant command:

- `/ask` has `codex_model` and `claude_model`; choose the field for the provider you asked, or choose both when `agent:both`.
- `/debate` has the same two optional pickers because it always uses both providers.
- Select only a class displayed by `/models`. The selection is frozen in the resulting report along with its verification status.
- With the current supported Windows setup, leave `codex_model` blank. Codex model IDs cannot yet be observed by the preflight, so configured Codex classes intentionally make doctor unhealthy. Use the provider default for Codex.
- If `/models` lists a configured Claude class such as `sonnet`, you can choose it for an individual request. If it is not listed, leave the field blank for the provider default or rerun setup to change the local policy. A provider default is not model-verified or an entitlement guarantee.

For example, choose `claude_model:sonnet` in Discord's command picker for a Claude-only request:

```text
/ask agent:claude question:Summarize the top-level project structure without changing files. claude_model:sonnet
```

Or keep Codex on its provider default while selecting Claude for a debate:

```text
/debate topic:Which module deserves the next read-only review, and why? claude_model:sonnet
```

### Commands and example replies

#### `/projects` — find your registered project ID

```text
/projects

Example reply
project-one: My project
```

If setup did not register a project, the reply is `No projects are registered.`

#### `/models` — see the choices that Discord can offer

```text
/models

Example reply
Configured model classes
Codex: provider default (no configured class)
Claude: sonnet (default)
Observation policy: exact IDs and literal prefixes are accepted.
Observed-model verification is not entitlement verification.
```

This is a local policy summary, not proof that an account can use a model.

#### `/switch` — select the project for this channel and user

```text
/switch project:project-one

Example reply
Active project switched to project-one.
```

Run this before `/ask` unless you have already selected a project in this guild, channel, and user scope.

#### `/ask` — request one read-only analysis

```text
/ask agent:both question:Summarize the top-level project structure without changing files. claude_model:sonnet

Example reply
Project: project-one
Session: <SESSION_ID>
Status: completed

## Codex
Status: completed
Requested class: provider default
Observed model IDs: none
Verification: unverified
Verification marker: unverified
Provider-default execution was successful but cannot be model-verified.

## Claude
Status: completed
Requested class: sonnet
Requested CLI model ID: <CONFIGURED_CLAUDE_MODEL_ID>
Observed model IDs: <OBSERVED_MODEL_ID>
Verification: verified
```

The report can instead be `partial`, `failed`, or `cancelled`; use `/status` for its persisted record. Long reports are attached as a text file.

#### `/debate` — ask both providers to deliberate

```text
/debate topic:Which module deserves the next read-only review, and why? claude_model:sonnet

Example reply
Project: project-one
Session: <SESSION_ID>
Status: completed
Classification: CONSENSUS
Frozen provider selections:
Codex: provider default
Claude: sonnet

## CONSENSUS
<CLAIM_ID>: <CLAIM_TEXT>
Verdict: CONSENSUS; evidence: SUPPORTED
```

The full report also contains `DISAGREEMENT`, `REJECTED`, and `UNRESOLVED` sections, the two independent analyses, and mechanically resolved evidence/provenance. Evidence status verifies cited bytes and paths; it does not prove semantic truth. Add `project:project-one` only when you want to debate a registered project other than the active one.

#### `/status` — check active and recent work

```text
/status

Example reply
# Active sessions
None

# Recent sessions
Project: project-one
Session: <SESSION_ID>
Status: completed

## Claude
Status: completed
Requested class: sonnet
Observed model IDs: <OBSERVED_MODEL_ID>
Verification: verified
```

#### `/stop` — cancel an active request you own

```text
/stop

Example reply
Stopping run <RUN_ID>.
```

Use `/stop run:<RUN_ID>` to target a specific current run. If no matching run belongs to you, the reply is `No matching active run is available to stop.`

After the first request, inspect the selected project yourself with `git status --short`. For a cancellation exercise, begin a deliberately long **read-only** request, send `/stop`, confirm the cancellation in `/status`, and verify that Git status is unchanged. Do not treat this as proof of complete host isolation or a no-cost test.

## Troubleshooting

| Symptom                                                                                  | Likely cause                                                                                                                                | Safe next step                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Setup rejects a command ending in `.cmd` or `.bat`                                       | The application intentionally refuses Windows shims.                                                                                        | Locate or install the provider's native `.exe`; do not rename or wrap the shim.                                                                                                                                                                                                                                                                                                                                                                                          |
| Setup cannot find a provider executable                                                  | The CLI is not installed or no native executable is available.                                                                              | Complete the provider's official installation, verify `--version`, then enter the native path in setup. Sign-in is verified only by an opt-in provider request.                                                                                                                                                                                                                                                                                                          |
| The bot is online but commands do not appear                                             | The bot may not be installed into the selected guild, its application ID/guild allowlist may be wrong, or channel permissions may block it. | Check the Developer Portal **Installation** settings and private-guild install. In the intended channel, grant the bot View Channel, Send Messages, and Attach Files; grant the authorized human operator Use Application Commands.                                                                                                                                                                                                                                      |
| A command says the server or user is not authorized                                      | The guild ID or user ID was not included at setup.                                                                                          | Recopy the ID with Developer Mode and rerun setup; do not send the ID in public support channels.                                                                                                                                                                                                                                                                                                                                                                        |
| `/ask` says no active project is selected                                                | `/switch` has not been run for this guild/channel/user.                                                                                     | Run `/projects`, then `/switch project:<YOUR_PROJECT_ID>`.                                                                                                                                                                                                                                                                                                                                                                                                               |
| Doctor says a model or effort contract is unavailable                                    | A configured selection does not match provider capabilities or observed-model policy.                                                       | For Codex, leave every model selection and its default blank. For Claude, use an allowed configured class or leave its selections blank for the provider default; do not weaken persisted evidence.                                                                                                                                                                                                                                                                      |
| A provider result is partial, failed, or cancelled                                       | A provider, authentication, network, timeout, safety contract, or cancellation interrupted work.                                            | Use `/status` for the persisted record, fix the reported local condition, then issue a new read-only request.                                                                                                                                                                                                                                                                                                                                                            |
| Installation or a quality command cannot build the native database dependency on Windows | A later Node major may require a native source build.                                                                                       | Use Node.js 22 first: it is the CI-tested application runtime and preferred first-install path. If a source build is still required, install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the [Desktop development with C++](https://learn.microsoft.com/en-us/visualstudio/install/workload-component-id-vs-build-tools?view=vs-2022) workload. Do not change package or CI configuration merely to bypass the failure. |

## macOS and Linux notes

The operator flow is the same: use a private Discord app, authenticate each provider separately, run `pnpm setup`, then doctor before start. On macOS and Linux, configure a directly executable native file without the Windows `.exe` suffix; shell wrappers are still unsuitable for this application's direct-process model.

- Codex's official CLI page provides the current macOS/Linux installer and sign-in flow.
- Claude Code's official guide provides its current native installer for macOS, Linux, and WSL, plus package-manager alternatives.
- Local application data is `~/Library/Application Support/ai-workspace` on macOS and `$XDG_DATA_HOME/ai-workspace` (or `~/.local/share/ai-workspace`) on Linux. The Discord token remains in ignored `.env` in the AI Workspace working folder.
- On Unix-like systems setup attempts restrictive local file permissions where the platform supports them. This is a local handling measure, not a promise that credentials cannot be copied or exposed elsewhere.
