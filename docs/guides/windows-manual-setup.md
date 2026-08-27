# Manual Windows setup

This is the no-automation route for a first-time Windows operator. Complete each numbered step yourself. Keep all identifiers and credentials private; use the placeholders in this guide in notes, screenshots, and support requests.

The repository [README](../../README.md) remains the authoritative safety runbook. In particular, this application asks external provider CLIs to examine projects; it does not promise complete host read isolation or a no-cost test.

## 1. Install Node.js 22

1. Download and install the current Node.js 22 release from the official [Node.js download page](https://nodejs.org/en/download).
2. Close every open PowerShell window, open a new one, and run:

   ```powershell
   node --version
   ```

Expected result: the version starts with `v22`.

## 2. Install Git and pnpm

1. In PowerShell, install Git with Windows Package Manager:

   ```powershell
   winget install --id Git.Git -e
   ```

   If Windows asks for permission, review the prompt and approve only if you intend to install Git. Windows Package Manager is documented by [Microsoft](https://learn.microsoft.com/windows/package-manager/winget/).

2. Open a new PowerShell window and confirm Git is available:

   ```powershell
   git --version
   ```

3. Enable Node's package-manager helper and activate this repository's pnpm version:

   ```powershell
   corepack enable
   corepack prepare pnpm@11.19.0 --activate
   pnpm --version
   ```

Expected result: Git prints a version, and pnpm prints a version beginning with `11`.

## 3. Clone and install AI Workspace

1. Choose a working folder that you control. Do not use a folder that contains a project you do not want provider CLIs to inspect.
2. Replace the placeholders below with the repository URL and a local folder name that your team supplied:

   ```powershell
   git clone <REPOSITORY_URL> <AI_WORKSPACE_FOLDER>
   Set-Location <AI_WORKSPACE_FOLDER>
   pnpm install --frozen-lockfile
   ```

Expected result: installation finishes without changing any project that you later register with the bot.

## 4. Create a private Discord application

1. Open the official [Discord Developer Portal](https://discord.com/developers/applications), select **New Application**, and give it a private working name.
2. On **General Information**, copy the Application ID only for the local setup prompt. In notes, use `<DISCORD_APPLICATION_ID>` instead of a real value.
3. Open **Bot**, create or confirm the bot user, and disable **Public Bot**. Do not enable privileged gateway intents.
4. Open **Installation**. Configure a **Guild Install** with exactly the `bot` and `applications.commands` scopes. Install it only into a private guild you control; do not publish the install link.
5. In the intended Discord channel, grant the bot only **View Channel**, **Send Messages**, and **Attach Files**. Grant the human operator—not the bot—**Use Application Commands**. Do not grant Administrator or broader server permissions merely to make setup easier.

Expected result: the bot is private, can work only in the intended channel, and a permitted human can use its slash commands.

## 5. Collect the required Discord IDs

1. In the Discord desktop client, open **User Settings** > **Advanced** and turn on **Developer Mode**. Discord documents this desktop flow in its [Developer Mode guide](https://support.discord.com/hc/en-us/articles/206346498-Where-can-I-find-my-User-Server-Message-ID).
2. Right-click the private server icon and select **Copy Server ID**. This is the guild ID.
3. Right-click your own user profile in that server and select **Copy User ID**. This is the authorized user ID.
4. Use the Application ID from the Developer Portal, rather than an ID copied from a message.

Expected result: you have an application ID, one private guild ID, and one authorized user ID available only for the local setup prompt.

## 6. Install and sign in to Codex separately

1. Follow the official [Codex CLI Windows instructions](https://developers.openai.com/codex/cli/). This app does not sign in to Codex for you.
2. In PowerShell, check the installed command, then run it once and complete its own sign-in flow:

   ```powershell
   codex --version
   codex
   ```

3. Find the native executable that setup must use:

   ```powershell
   where.exe codex
   ```

Expected result: Codex has its own completed sign-in session and you can identify a real `codex.exe`. A `codex.cmd` or `codex.bat` result is a shell wrapper, not an acceptable setup value.

## 7. Install and sign in to Claude separately

1. Follow the official [Claude Code Windows guide](https://code.claude.com/docs/en/getting-started). Its documented Windows package-manager command is:

   ```powershell
   winget install Anthropic.ClaudeCode
   ```

2. Check the installed command, then run it once and complete Claude Code's own sign-in flow:

   ```powershell
   claude --version
   claude
   ```

3. Find the native executable:

   ```powershell
   where.exe claude
   ```

Expected result: Claude has a separate completed sign-in session and you can identify a real `claude.exe`. Do not enter a `.cmd` or `.bat` wrapper in setup, rename a wrapper, or bypass the native-executable check.

## 8. Run the manual setup prompt

1. Return to the AI Workspace working folder and run:

   ```powershell
   pnpm setup
   ```

2. Enter the Discord application ID, private guild ID, and authorized user ID only when the local prompt asks. Register each intended project with a lowercase ID, a descriptive name, and its absolute root. Register only a project you are willing to expose to the provider CLIs.
3. For each provider, enter the verified native `.exe` path or let setup discover one, then inspect and explicitly confirm any path before it is saved.
4. Leave Codex model-class and default-model entries blank. The current Codex probe cannot report observed model IDs, so a configured Codex model class makes doctor unhealthy. For Claude, use only a supported local choice or leave model selections blank for the provider default.
5. Paste the private Discord bot credential only into its hidden setup prompt. Never place it in a command, source file, screenshot, ticket, or chat. Review every answer before confirming the local configuration write.

Expected result: local configuration and the ignored credential file are created, and no credential or real identifier is added to the repository.

## 9. Run doctor and interpret its limits

1. Run:

   ```powershell
   pnpm run doctor
   ```

2. If it reports an unresolved executable, a failed version probe, or a `.cmd`/`.bat` shim, return to the provider installation and supply a verified native `.exe`.
3. If it reports an unsupported model, effort, or observation policy, correct the local choice. For Codex, leave model choices blank; for Claude, use a supported choice or provider default.

Expected result: doctor checks Node, Git, local data, registered projects, executable resolution, and provider capability prerequisites. It runs only `--version` and `--help` probes; it is **not** proof of provider sign-in, account entitlement, or real-request readiness, and it makes no paid model call.

## 10. Start the private bot

1. After accepting the possibility of provider charges, start the bot:

   ```powershell
   pnpm start
   ```

2. In the authorized private Discord channel, run `/projects`, then select a registered project with `/switch project:<YOUR_PROJECT_ID>`.

Expected result: the bot logs in to the private guild and confirms the active project for your guild, channel, and user.

## 11. Make the first read-only request

1. Send this slash command in the authorized channel:

   ```text
   /ask agent:both question:Summarize the top-level project structure without changing files.
   ```

2. Review the result in Discord. It may be completed, partial, failed, or cancelled.

Expected result: this is the first deliberate check of provider sign-in, entitlement, and real-request readiness. It is read-only with respect to the selected Git project, but it can call providers and may consume paid usage.

## 12. Check cancellation and Git integrity

1. Before a cancellation exercise, record the current state:

   ```powershell
   git status --short
   ```

2. Begin a deliberately long read-only request, then send `/stop` in the same channel. Use `/status` to confirm the persisted cancellation.
3. Run `git status --short` again and compare it with the state from before the request.

Expected result: the run is marked cancelled, and Git status is unchanged. This is a useful integrity check, not proof of complete host read isolation and not a free provider test.

## 13. Resolve a Windows C++ build failure

If dependency installation or a quality command reports that it cannot build the native database dependency, first make sure you are using Node.js 22. If a source build is still required, install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the [Desktop development with C++ workload](https://learn.microsoft.com/en-us/visualstudio/install/workload-component-id-vs-build-tools?view=vs-2022), then retry the command.

Expected result: the required Windows C++ compiler tools are available. Do not change package or CI configuration merely to bypass the build failure.

## 14. Optional onboarding route

If you prefer a local walkthrough after reading this guide, return to the project folder and run:

```powershell
pnpm onboarding
```

Choose **Guided** to keep all machine changes manual, or **Semi-automatic** only when you consent to each proposed local action. It is optional; this guide remains the route for controlling every step yourself.

Expected result: you can choose a local Guided or consented Semi-automatic walkthrough without replacing the safety boundaries above.
