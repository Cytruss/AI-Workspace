# AI Workspace Design

## Summary

AI Workspace is a local, multi-project orchestration service for software-development agents. Its first interface is a Discord bot, and its first two agent integrations are OpenAI Codex CLI and Claude Code. The system removes the need to copy responses manually between agents by coordinating independent analysis, cross-review, bounded debate, and synthesis.

The project is generic and public. All source code, documentation, configuration keys, commands, errors, and user-facing messages are in English. No personal paths, Discord identifiers, or application-specific assumptions are committed to the repository.

## Goals

- Run Codex and Claude Code locally against an explicitly selected Git project.
- Let users query either agent, both agents independently, or a bounded debate between them.
- Keep orchestration, project data, transcripts, and operational logs on the user's machine.
- Protect projects with a fail-closed read-only mode in the first release.
- Support Windows, macOS, and Linux from the first public release.
- Make installation practical through `git clone`, dependency installation, and a guided setup command.
- Keep agent integrations replaceable through a stable adapter contract.
- Provide useful partial results and diagnostic errors when one agent is unavailable or fails.

## Non-goals for the Initial Release

- Editing project files, applying patches, committing, or pushing.
- A web interface or hosted backend.
- Cloud persistence, PostgreSQL, embeddings, or a vector database.
- User accounts, billing, or multi-tenant hosting.
- Arbitrary dynamic plugins or a separately published package for every module.
- Automatic installation or authentication of third-party agent CLIs.
- Open-ended autonomous loops.

## Supported Environment

- Node.js 22 or later.
- pnpm managed through the version pinned in `package.json`.
- Git projects on Windows, macOS, and Linux.
- A locally installed and authenticated Codex CLI, Claude Code, or both.
- A Discord application and bot token supplied by the operator.

Users install and authenticate agent CLIs separately. The setup command detects executables, versions, authentication state where a stable diagnostic is available, and automation capabilities. A missing agent does not prevent the other adapter from working, but commands that require both agents report a clear capability error.

## Architecture

AI Workspace is a modular monolith. It is deployed as one Node.js process but divided into modules with explicit interfaces:

- `cli`: guided setup, environment diagnostics, migrations, and local startup.
- `config`: portable configuration loading, validation, defaults, and per-user paths.
- `transport/discord`: slash-command registration, authorization, progress updates, pagination, and result formatting.
- `orchestrator`: session lifecycle, scheduling, concurrency, timeouts, cancellation, and result coordination.
- `debate`: independent analysis, cross-review, disagreement detection, bounded rounds, and synthesis.
- `agents`: the shared adapter contract, capability probing, and Codex/Claude implementations.
- `permissions`: project allowlisting, canonical path validation, execution-mode policy, and integrity checks.
- `projects`: project registration and active-project selection.
- `storage`: SQLite migrations and repositories.
- `platform`: child-process spawning, streamed output, signal handling, and operating-system-specific process-tree termination.

Module dependencies point inward toward domain contracts. Discord, SQLite, and CLI process details do not leak into the debate engine or orchestration rules.

## Agent Adapter Contract

The orchestrator depends on a normalized contract rather than CLI-specific flags:

```ts
type AgentId = "codex" | "claude" | string;

interface AgentCapabilities {
  available: boolean;
  version?: string;
  authenticated?: boolean;
  nonInteractive: boolean;
  structuredOutput: boolean;
  readOnlyEnforcement: boolean;
  diagnostics: string[];
}

interface AgentRequest {
  runId: string;
  projectRoot: string;
  mode: "observe";
  prompt: string;
  timeoutMs: number;
  maxOutputBytes: number;
}

interface AgentResult {
  agentId: AgentId;
  status: "completed" | "failed" | "cancelled" | "timed_out";
  response?: string;
  structured?: unknown;
  exitCode?: number;
  durationMs: number;
  diagnostics: string[];
}

interface AgentAdapter {
  readonly id: AgentId;
  probe(): Promise<AgentCapabilities>;
  run(request: AgentRequest, signal: AbortSignal): Promise<AgentResult>;
}
```

Each adapter owns executable discovery, arguments, output parsing, and CLI-specific permission settings. Setup records detected capabilities, but every run validates critical read-only capabilities again so an upgraded or replaced binary cannot silently weaken policy.

Claude Code provides non-interactive print mode, JSON or streaming JSON output, tool restrictions, and a plan permission mode. The Codex adapter uses its documented non-interactive execution interface, but it probes the installed binary rather than assuming flags from a particular release. AI Workspace refuses an `OBSERVE` run when an adapter cannot establish a supported read-only configuration.

## Configuration and Local Data

The setup command creates a validated JSON configuration in the operating system's per-user application-data directory. The location follows platform conventions rather than repository-relative or hardcoded home paths. The configuration contains:

- Discord guild and authorized user identifiers.
- Registered project IDs, display names, and absolute roots.
- Available agent adapters and optional executable overrides.
- Default agent, synthesizer, round limit, timeouts, output limits, and concurrency.
- Logging level and local data-retention settings.

Secrets are loaded from the process environment or an untracked local `.env` file. The repository contains `.env.example` with example variable names and empty values only. Secrets are never persisted in SQLite or included in logs, prompts, diagnostics, or Discord output.

The project registry is configuration, not application logic. V0.1 accepts existing Git worktrees only. Each root is canonicalized and stored explicitly; directory discovery never scans a user's home directory.

Active-project selection is scoped by Discord guild, channel, and user. One user's `/switch` command cannot change another user's context.

## Discord Commands

V0.1 exposes this minimal command set:

- `/projects`: list configured projects and adapter availability.
- `/switch project:<id>`: select the active project for the invoking user and channel.
- `/ask agent:<codex|claude|both> question:<text>`: run one or two independent analyses.
- `/debate topic:<text>`: run a bounded Codex/Claude debate and synthesis.
- `/status`: show active and recent runs without exposing prompts or secrets to unauthorized users.
- `/stop run:<id|current>`: cancel an authorized active run.

Discord interaction acknowledgements are sent before the platform deadline. Long results are split into readable messages or attached as a text file while retaining a concise summary in the channel.

## Request Flow

1. Discord authenticates the interaction; AI Workspace verifies guild, user, command, and project authorization.
2. The project service resolves the user's active project and validates its canonical root.
3. The orchestrator creates a persisted session and run records.
4. The context builder creates a minimal prompt from project metadata, the current request, and the current debate state. V0.1 does not retrieve semantic memory.
5. The permission service checks the requested mode and adapter capabilities.
6. The adapter spawns the agent directly with an argument array and a restricted environment.
7. The process runner streams bounded stdout and stderr, applies the timeout, and listens for cancellation.
8. The adapter normalizes the response. Persistence records the outcome before Discord formatting begins.
9. The formatter returns the response, partial result, or actionable diagnostic.

Agent-to-agent communication always passes through the orchestrator. Agents never invoke each other directly.

## Debate Protocol

The default is two discussion rounds followed by synthesis. The maximum is configurable but always finite.

### Round 1: Independent analysis

Codex and Claude receive the same project, question, evidence rules, and output schema concurrently. Neither receives the other's response. Each response separates verified facts, inferences, assumptions, risks, and a recommendation.

### Round 2: Cross-review

Each agent receives the other agent's normalized response. It must verify challengeable claims against the project where possible, identify the strongest counterargument, acknowledge points that are correct, and list unresolved disagreements.

### Optional final discussion round

An additional round runs only when synthesis criteria identify a material unresolved disagreement and the configured round limit permits it. The prompt contains only disputed points and relevant evidence, not the entire transcript.

### Synthesis

A configurable synthesizer receives the normalized round outputs and produces:

- consensus,
- disagreements,
- verified evidence,
- assumptions and unknowns,
- risks,
- proposed experiments,
- recommendation and confidence.

The synthesizer defaults to the configured preferred agent and falls back to the other available adapter. The report identifies which agent performed synthesis. If one agent fails before completing the first round, the system does not label the result a debate; it returns the successful analysis with a failure diagnostic. Later-round failure produces a clearly marked partial debate.

## Security Model

The initial release exposes only `OBSERVE`. Future mode names may be documented, but `PROPOSE`, `IMPLEMENT`, and `EXECUTE` are rejected by configuration validation and command routing until separately designed and implemented.

`OBSERVE` uses layered controls:

- Canonical project roots must match an explicit allowlist entry.
- Project roots must be Git worktrees and cannot be a filesystem root or user home directory.
- Symlinks resolving outside the project root are rejected during project registration.
- Processes are spawned directly without shell interpolation.
- Adapter-native read-only or plan controls are mandatory and capability-probed.
- Optional CLI plugins, hooks, and external tool integrations are disabled where the CLI provides a supported mechanism.
- The child receives only required environment variables. Known secret values are redacted from all captured output.
- Network behavior remains controlled by the agent CLI and user authentication; AI Workspace does not add network tools.
- A pre-run and post-run Git integrity check detects tracked changes and new untracked files. Any difference marks the run as a security failure and is never cleaned up automatically.
- `git push`, commits, and destructive Git commands are never issued by AI Workspace.

The integrity check is a detective backstop, not a substitute for native read-only enforcement. If native enforcement is unavailable, the run is refused.

Discord commands are restricted to configured guilds and user IDs. Authorization is checked for every interaction, including `/status` and `/stop`.

## Process Lifecycle and Cancellation

Every agent run has an `AbortController`, deadline, output-byte budget, and persisted state. Cancellation is idempotent.

The platform module terminates the entire process tree, not only the immediate CLI process. It uses Windows-specific process-tree handling on Windows and process groups plus escalating signals on macOS and Linux. Graceful termination is attempted first; forced termination follows after a short configurable grace period.

Output is consumed incrementally to prevent pipe deadlocks. When the byte limit is reached, the runner terminates the process, stores a bounded diagnostic, and marks the run failed. Startup errors, authentication failures, malformed structured output, non-zero exits, timeouts, cancellations, and unexpected termination use distinct error codes.

The top-level process handles `SIGINT` and platform shutdown events by stopping new work, cancelling active runs, closing SQLite, and exiting with a bounded shutdown timeout.

## Persistence

SQLite is stored in the per-user application-data directory and migrated transactionally at startup. V0.1 uses these logical tables:

- `projects`: registered project identity and canonical root metadata.
- `active_projects`: project selection scoped to guild, channel, and user.
- `sessions`: command type, project, requester, lifecycle, and timestamps.
- `messages`: normalized user, agent, and synthesis messages.
- `agent_runs`: adapter, round, status, duration, exit metadata, and bounded diagnostics.
- `debate_rounds`: ordering, participants, and completion state.
- `errors`: stable error code, safe message, context, and timestamp.

Foreign keys are enabled. Session creation and state transitions are transactional. Raw secrets and unrestricted environment dumps are never stored. Conversation data remains local until the operator deletes the application-data directory; automated retention controls are deferred until usage patterns are known.

Facts, hypotheses, experiments, decisions, rejected ideas, constraints, and agent mistakes are a later milestone. They are deliberately excluded from the initial schema so the state model can be based on real transcripts rather than speculative fields.

## Error Handling and Degraded Operation

- `/ask` for an unavailable agent returns setup instructions without creating a child process.
- `/ask both` runs available adapters independently and returns a successful response even when the other adapter fails.
- `/debate` requires both adapters at the start and reports a partial debate if failure occurs after useful work exists.
- Discord delivery failures do not discard persisted results; `/status` can locate the completed session.
- SQLite migration or corruption errors prevent startup rather than running without persistence.
- Unknown output fields are tolerated; missing required result data produces a parser error with bounded raw diagnostics.
- Repeated Discord interactions with the same interaction ID are idempotent.

## Testing Strategy

Vitest is used for unit and integration tests. Fake Node-based agent executables simulate successful structured output, streaming output, malformed data, authentication failures, non-zero exits, hangs, oversized output, ignored termination signals, and spawned child processes.

Unit tests cover configuration, authorization, path validation, debate state transitions, synthesis inputs, error mapping, formatting, and redaction. Integration tests cover SQLite migrations and repositories, process execution, cancellation, timeouts, output limits, and both adapters' parsers. Discord tests use a transport boundary rather than a live server.

CI runs on Windows, macOS, and Linux using the supported Node version. Tests requiring real accounts are opt-in smoke tests and never run in public CI. Release checks include formatting, linting, type checking, unit tests, integration tests, secret scanning, and a clean install from a fresh clone.

## Delivery Milestones

### Milestone 1: Dual-agent vertical slice

- Repository foundation, configuration, setup, and doctor commands.
- Project registry and Discord authorization.
- Codex and Claude capability probes and adapters.
- `/ask` for either or both agents.
- SQLite history, status reporting, timeouts, and `/stop`.

### Milestone 2: Agent conversation

- Debate state machine and independent first round.
- Cross-review, bounded optional final round, and synthesis.
- `/debate` reporting, partial-result behavior, and persistence.

### Milestone 3: Public hardening

- Full Windows/macOS/Linux CI coverage.
- Installation, Discord setup, security, privacy, troubleshooting, and contribution documentation.
- Fresh-machine smoke checklist and first public release.

Each milestone ends with runnable software and independently reviewable tests.

## Licensing

The repository is licensed under Apache License 2.0. This permits private, commercial, and open-source use while providing an explicit patent license for relevant contributor claims and retaining attribution and change-notice requirements.

## External References

- [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)
- [Claude Code CLI reference](https://code.claude.com/docs/en/cli-usage)
- [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0.html)

## Success Criteria

The initial public release is successful when a new user can clone the repository on Windows, macOS, or Linux; run the guided setup; register an authorized Git project; connect a private Discord bot; verify both installed agents; use each agent through `/ask`; run a bounded `/debate`; inspect persisted local history; and cancel an active run without project modifications or leaked secrets.
