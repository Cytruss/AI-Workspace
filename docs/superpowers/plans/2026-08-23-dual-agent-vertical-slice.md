# Dual-Agent Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Milestone 1: a locally hosted Discord bot that can run Codex, Claude, or both against an authorized Git project in enforced read-only mode, persist results in SQLite, report status, and cancel active work.

**Architecture:** Implement a TypeScript modular monolith whose domain services depend on explicit ports for agents, persistence, processes, and Discord. Keep CLI-specific arguments inside adapters, keep Discord-specific objects at the transport edge, and validate read-only capabilities before every run. Use fake agent processes and transport ports for deterministic cross-platform tests.

**Tech Stack:** Node.js 22+, pnpm 11.19.0, TypeScript 5.9.3, @openai/codex-sdk 0.149.0, discord.js 14.27.0, Zod 4.4.3, better-sqlite3 13.0.3, dotenv 17.4.2, Vitest 4.1.11, ESLint 10.9.0, Prettier 3.9.6, tsx 4.23.12.

**Spec:** `docs/superpowers/specs/2026-08-23-ai-workspace-design.md`

## Global Constraints

- Node.js 22 or later.
- pnpm is pinned through `packageManager` in `package.json`.
- Windows, macOS, and Linux are supported from the first public release.
- All source code, documentation, configuration keys, commands, errors, and user-facing messages are in English.
- No personal paths, Discord identifiers, or application-specific assumptions may enter the repository.
- V0.1 accepts existing Git worktrees only.
- Only `OBSERVE` is executable; write-capable modes are rejected.
- Agent CLIs are installed and authenticated separately by each user.
- Secrets and local project paths remain outside Git.
- Processes are spawned directly with argument arrays, never shell interpolation.
- Native read-only enforcement is mandatory; capability uncertainty fails closed.
- The repository is licensed under Apache License 2.0.
- Do not add debate rounds, structured decision memory, a web UI, cloud persistence, dynamic plugins, or write-capable execution in this plan.

## File Map

```text
src/
├── cli/                     # setup, doctor, start and argument dispatch
├── config/                  # schema, per-user paths and config loading
├── transport/discord/       # command definitions, handlers and Discord runtime
├── orchestrator/            # ask lifecycle and active-run cancellation
├── agents/                  # contracts, registry, Codex and Claude adapters
├── permissions/             # canonical Git-root validation and integrity checks
├── projects/                # configured and active project services
├── storage/                 # SQLite connection, migration and repositories
├── platform/                # bounded child-process runner and tree termination
└── index.ts                 # executable entry point
tests/
├── unit/                    # pure module behavior
├── integration/             # filesystem, SQLite and process boundaries
├── fixtures/agent-output/   # stable Codex and Claude output samples
└── fake-agents/             # cross-platform Node child-process fixtures
```

---

### Task 1: Repository Foundation and Quality Gates

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.json`
- Create: `eslint.config.mjs`
- Create: `vitest.config.ts`
- Create: `.editorconfig`
- Create: `.prettierignore`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `LICENSE`
- Create: `src/build-info.ts`
- Create: `tests/unit/build-info.test.ts`
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: none.
- Produces: `getBuildInfo(): { name: "ai-workspace"; version: string; node: string }`, repository scripts, and the CI contract used by every later task.

- [ ] **Step 1: Create the package manifest and tool configuration**

Create `package.json` with exact runtime and development dependencies:

```json
{
  "name": "ai-workspace",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "license": "Apache-2.0",
  "engines": { "node": ">=22" },
  "packageManager": "pnpm@11.19.0",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint .",
    "format:check": "prettier --check .",
    "format": "prettier --write .",
    "setup": "tsx src/index.ts setup",
    "doctor": "tsx src/index.ts doctor",
    "start": "tsx src/index.ts start"
  },
  "dependencies": {
    "@openai/codex-sdk": "0.149.0",
    "better-sqlite3": "13.0.3",
    "discord.js": "14.27.0",
    "dotenv": "17.4.2",
    "zod": "4.4.3"
  },
  "devDependencies": {
    "@eslint/js": "10.0.1",
    "@types/better-sqlite3": "9.6.0",
    "@types/node": "22",
    "eslint": "10.9.0",
    "prettier": "3.9.6",
    "tsx": "4.23.12",
    "typescript": "5.9.3",
    "typescript-eslint": "8.67.0",
    "vitest": "4.1.11"
  }
}
```

Create `pnpm-workspace.yaml` with this narrow lifecycle-build allowlist:

```yaml
allowBuilds:
  better-sqlite3: true
  esbuild: true
```

Set `tsconfig.json` to `module` and `moduleResolution` `NodeNext`, `target` `ES2023`, `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`, `rootDir: "."`, and `outDir: "dist"`. Configure ESLint with `@eslint/js` recommended and `typescript-eslint` strict type-checked rules. Configure Vitest to include `tests/**/*.test.ts`, use the Node environment, and clear mocks.

- [ ] **Step 2: Install dependencies and generate the lockfile**

Run: `pnpm install`

Expected: `pnpm-lock.yaml` is created and installation exits 0 on the current platform.

- [ ] **Step 3: Write the failing build-info test**

```ts
import { describe, expect, it } from "vitest";
import { getBuildInfo } from "../../src/build-info.js";

describe("getBuildInfo", () => {
  it("returns portable runtime metadata", () => {
    expect(getBuildInfo()).toEqual({
      name: "ai-workspace",
      version: "0.1.0",
      node: process.version,
    });
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm vitest run tests/unit/build-info.test.ts`

Expected: FAIL because `src/build-info.ts` does not exist.

- [ ] **Step 5: Implement build metadata**

```ts
export function getBuildInfo() {
  return {
    name: "ai-workspace" as const,
    version: "0.1.0",
    node: process.version,
  };
}
```

Add the unmodified Apache License 2.0 text to `LICENSE`. Ignore `node_modules/`, `dist/`, `.env`, `*.sqlite`, `*.sqlite-shm`, `*.sqlite-wal`, coverage output, logs, and OS/editor artifacts. Put empty `AI_WORKSPACE_DISCORD_TOKEN=` in `.env.example`.

- [ ] **Step 6: Add the cross-platform CI workflow**

Create `.github/workflows/ci.yml` with a matrix of `ubuntu-latest`, `windows-latest`, and `macos-latest`, Node 22, pnpm caching, `pnpm install --frozen-lockfile`, `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`.

- [ ] **Step 7: Run all foundation checks**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm build`

Expected: all commands exit 0 and the build-info test reports 1 passing test.

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml tsconfig.json eslint.config.mjs vitest.config.ts .editorconfig .prettierignore .gitignore .env.example LICENSE src/build-info.ts tests/unit/build-info.test.ts .github/workflows/ci.yml
git commit -m "chore: initialize TypeScript project"
```

---

### Task 2: Portable Configuration and Application Paths

**Files:**
- Create: `src/config/schema.ts`
- Create: `src/config/app-paths.ts`
- Create: `src/config/load-config.ts`
- Create: `tests/unit/config/app-paths.test.ts`
- Create: `tests/unit/config/load-config.test.ts`

**Interfaces:**
- Consumes: Node filesystem and environment APIs.
- Produces: `AppConfig`, `ProjectConfig`, `AgentConfig`, `getAppPaths()`, `loadConfig()`, and `saveConfig()`.

- [ ] **Step 1: Write failing path and schema tests**

```ts
import { describe, expect, it } from "vitest";
import { getAppPaths } from "../../../src/config/app-paths.js";

describe("getAppPaths", () => {
  it("uses XDG data on Linux", () => {
    const paths = getAppPaths("linux", { XDG_DATA_HOME: "/data" });
    expect(paths.dataDir).toBe("/data/ai-workspace");
  });

  it("uses APPDATA on Windows", () => {
    const paths = getAppPaths("win32", { APPDATA: "C:\\AppData" });
    expect(paths.dataDir).toBe("C:\\AppData\\ai-workspace");
  });
});
```

Add `load-config.test.ts` cases for valid JSON, duplicate project IDs, a non-absolute project root, empty Discord allowlists, invalid execution mode, and a missing token environment variable.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/unit/config`

Expected: FAIL because configuration modules do not exist.

- [ ] **Step 3: Define the exact configuration schema**

```ts
import { z } from "zod";

export const ProjectConfigSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
  name: z.string().min(1).max(100),
  root: z.string().min(1),
});

export const AgentConfigSchema = z.object({
  command: z.string().min(1),
  timeoutMs: z.number().int().min(1_000).max(3_600_000).default(300_000),
  maxOutputBytes: z.number().int().min(1_024).max(10_485_760).default(1_048_576),
});

export const AppConfigSchema = z.object({
  version: z.literal(1),
  mode: z.literal("observe"),
  discord: z.object({
    applicationId: z.string().min(1),
    guildIds: z.array(z.string().min(1)).min(1),
    allowedUserIds: z.array(z.string().min(1)).min(1),
    tokenEnv: z.literal("AI_WORKSPACE_DISCORD_TOKEN"),
  }),
  projects: z.array(ProjectConfigSchema).min(1),
  agents: z.object({
    codex: AgentConfigSchema.default({ command: "codex", timeoutMs: 300_000, maxOutputBytes: 1_048_576 }),
    claude: AgentConfigSchema.default({ command: "claude", timeoutMs: 300_000, maxOutputBytes: 1_048_576 }),
  }),
  concurrency: z.number().int().min(1).max(8).default(2),
  logging: z.object({
    level: z.enum(["error", "warn", "info", "debug"]).default("info"),
  }).default({ level: "info" }),
  retention: z.object({
    mode: z.literal("manual").default("manual"),
  }).default({ mode: "manual" }),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;
export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
```

After parsing, refine that project IDs are unique and every root is absolute using `node:path.isAbsolute`.

- [ ] **Step 4: Implement portable paths and config I/O**

```ts
export interface AppPaths {
  dataDir: string;
  configFile: string;
  databaseFile: string;
  logDir: string;
}

export function getAppPaths(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): AppPaths;

export async function loadConfig(configFile: string, env?: NodeJS.ProcessEnv): Promise<AppConfig>;
export async function saveConfig(configFile: string, config: AppConfig): Promise<void>;
```

Use `%APPDATA%` on Windows, `$XDG_DATA_HOME` or `~/.local/share` on Linux, and `~/Library/Application Support` on macOS. Create directories with mode `0o700` where supported. Write configuration atomically to a sibling temporary file, rename it, and set mode `0o600` where supported. `loadConfig` must verify that `config.discord.tokenEnv` exists and is non-empty in the supplied environment without returning the token in `AppConfig`.

- [ ] **Step 5: Run configuration tests and quality checks**

Run: `pnpm vitest run tests/unit/config && pnpm lint && pnpm typecheck`

Expected: all configuration tests pass; lint and type checking exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/config tests/unit/config
git commit -m "feat: add portable configuration"
```

---

### Task 3: Authorized Git Project Registry and Integrity Guard

**Files:**
- Create: `src/permissions/project-root.ts`
- Create: `src/permissions/git-integrity.ts`
- Create: `src/projects/project-service.ts`
- Create: `tests/integration/permissions/project-root.test.ts`
- Create: `tests/integration/permissions/git-integrity.test.ts`
- Create: `tests/unit/projects/project-service.test.ts`

**Interfaces:**
- Consumes: `ProjectConfig` from Task 2.
- Produces: `validateProjectRoot()`, `captureGitIntegrity()`, `assertGitIntegrityUnchanged()`, and `ProjectService`.

- [ ] **Step 1: Write failing project validation tests**

Create temporary Git repositories and assert these cases:

```ts
await expect(validateProjectRoot(repoPath)).resolves.toMatchObject({
  root: await realpath(repoPath),
  gitTopLevel: await realpath(repoPath),
});
await expect(validateProjectRoot(os.homedir())).rejects.toThrow("Project root cannot be the user home directory");
await expect(validateProjectRoot(nonGitPath)).rejects.toThrow("Project root must be a Git worktree");
```

Add an external-symlink case on platforms where test symlink creation is permitted. Add integrity tests that detect a tracked edit and an untracked file.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/integration/permissions tests/unit/projects`

Expected: FAIL because permission and project modules do not exist.

- [ ] **Step 3: Implement canonical project validation**

```ts
export interface ValidatedProjectRoot {
  root: string;
  gitTopLevel: string;
}

export async function validateProjectRoot(root: string): Promise<ValidatedProjectRoot>;
```

Resolve with `realpath`, reject filesystem roots and the resolved home directory, run `git -C <root> rev-parse --show-toplevel` with direct process arguments, require the result to equal the canonical root, and recursively inspect symbolic links while skipping `.git` internals. Reject any symlink target outside the canonical root.

- [ ] **Step 4: Implement the integrity snapshot**

```ts
export interface GitIntegritySnapshot {
  porcelainV2: string;
}

export async function captureGitIntegrity(root: string): Promise<GitIntegritySnapshot>;

export function assertGitIntegrityUnchanged(
  before: GitIntegritySnapshot,
  after: GitIntegritySnapshot,
): void;
```

Capture `git status --porcelain=v2 --untracked-files=all` before and after every agent run. Preserve a user's pre-existing dirty state by comparing exact normalized output; do not require a clean repository and never revert changes.

- [ ] **Step 5: Implement `ProjectService`**

```ts
export interface RegisteredProject {
  id: string;
  name: string;
  root: string;
}

export class ProjectService {
  static async create(configs: ProjectConfig[]): Promise<ProjectService>;
  list(): readonly RegisteredProject[];
  get(projectId: string): RegisteredProject;
}
```

Validate every configured project during `create`. Return immutable copies and use stable error codes `PROJECT_NOT_FOUND`, `PROJECT_ROOT_INVALID`, and `PROJECT_EXTERNAL_SYMLINK`.

- [ ] **Step 6: Run tests and commit**

Run: `pnpm vitest run tests/integration/permissions tests/unit/projects && pnpm lint && pnpm typecheck`

Expected: all tests pass.

```bash
git add src/permissions src/projects tests/integration/permissions tests/unit/projects
git commit -m "feat: enforce authorized Git projects"
```

---

### Task 4: SQLite Persistence and Session State

**Files:**
- Create: `src/storage/database.ts`
- Create: `src/storage/migrations.ts`
- Create: `src/storage/session-repository.ts`
- Create: `src/storage/project-repository.ts`
- Create: `tests/integration/storage/database.test.ts`
- Create: `tests/integration/storage/session-repository.test.ts`

**Interfaces:**
- Consumes: canonical projects from Task 3.
- Produces: `openDatabase()`, `migrateDatabase()`, `ProjectRepository`, and `SessionRepository`.

- [ ] **Step 1: Write failing migration and repository tests**

Use an in-memory database and assert foreign keys, migration idempotency, project upsert, active-project scope, session transitions, messages, agent runs, and errors. Include this state test:

```ts
const session = sessions.create({
  interactionId: "interaction-1",
  command: "ask",
  projectId: "demo",
  guildId: "g1",
  channelId: "c1",
  userId: "u1",
  question: "Explain the project",
});
sessions.markRunning(session.id);
sessions.markCompleted(session.id);
expect(sessions.get(session.id).status).toBe("completed");
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/integration/storage`

Expected: FAIL because storage modules do not exist.

- [ ] **Step 3: Implement database opening and the initial migration**

`openDatabase(filename)` must enable `foreign_keys`, `journal_mode = WAL` for file databases, and a 5-second busy timeout. `migrateDatabase` runs this schema transactionally:

```sql
CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, root TEXT NOT NULL UNIQUE);
CREATE TABLE active_projects (
  guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, user_id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id),
  PRIMARY KEY (guild_id, channel_id, user_id)
);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY, interaction_id TEXT NOT NULL UNIQUE,
  command TEXT NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id),
  guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, user_id TEXT NOT NULL,
  question TEXT NOT NULL, status TEXT NOT NULL,
  created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT
);
CREATE TABLE messages (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id),
  role TEXT NOT NULL, agent_id TEXT, content TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE agent_runs (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), agent_id TEXT NOT NULL,
  status TEXT NOT NULL, exit_code INTEGER, duration_ms INTEGER NOT NULL,
  diagnostics_json TEXT NOT NULL, created_at TEXT NOT NULL, finished_at TEXT
);
CREATE TABLE errors (
  id TEXT PRIMARY KEY, session_id TEXT REFERENCES sessions(id),
  code TEXT NOT NULL, message TEXT NOT NULL, context_json TEXT NOT NULL, created_at TEXT NOT NULL
);
```

- [ ] **Step 4: Implement repository methods and transitions**

```ts
export type SessionStatus = "queued" | "running" | "completed" | "partial" | "failed" | "cancelled";

export class ProjectRepository {
  upsert(project: RegisteredProject): void;
  setActive(scope: { guildId: string; channelId: string; userId: string }, projectId: string): void;
  getActive(scope: { guildId: string; channelId: string; userId: string }): RegisteredProject | undefined;
}

export class SessionRepository {
  create(input: CreateSessionInput): SessionRecord;
  findByInteractionId(interactionId: string): SessionRecord | undefined;
  markRunning(id: string): void;
  markCompleted(id: string): void;
  markPartial(id: string): void;
  markFailed(id: string): void;
  markCancelled(id: string): void;
  addMessage(input: AddMessageInput): void;
  createAgentRun(input: CreateAgentRunInput): void;
  finishAgentRun(input: FinishAgentRunInput): void;
  addError(input: AddErrorInput): void;
  get(id: string): SessionRecord;
  recent(limit: number): SessionRecord[];
}
```

Guard invalid transitions in one transaction and generate IDs with `randomUUID()`.

- [ ] **Step 5: Run tests and commit**

Run: `pnpm vitest run tests/integration/storage && pnpm lint && pnpm typecheck`

Expected: all storage tests pass.

```bash
git add src/storage tests/integration/storage
git commit -m "feat: persist projects and agent sessions"
```

---

### Task 5: Bounded Cross-Platform Process Runner

**Files:**
- Create: `src/platform/process-runner.ts`
- Create: `src/platform/terminate-process-tree.ts`
- Create: `tests/fake-agents/runner.mjs`
- Create: `tests/fake-agents/grandchild.mjs`
- Create: `tests/integration/platform/process-runner.test.ts`

**Interfaces:**
- Consumes: direct executable paths, argument arrays, `AbortSignal`, and bounded execution options.
- Produces: `runProcess(request): Promise<ProcessResult>` and `terminateProcessTree(pid, graceMs)`.

- [ ] **Step 1: Create the fake process and failing integration tests**

`runner.mjs` accepts modes `success`, `stderr`, `fail`, `hang`, `oversize`, and `spawn-child`. It reads stdin, emits deterministic JSON, and records termination to a file path supplied only by the test.

```ts
await expect(runProcess({
  command: process.execPath,
  args: [fakeAgent, "success"],
  cwd: repoPath,
  stdin: "hello",
  env: process.env,
  timeoutMs: 1_000,
  maxOutputBytes: 4_096,
  signal: new AbortController().signal,
})).resolves.toMatchObject({ exitCode: 0, stdout: expect.stringContaining("hello") });
```

Add cases for non-zero exit, timeout, explicit cancellation, oversized output, stderr capture, and child-tree termination.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/integration/platform/process-runner.test.ts`

Expected: FAIL because the process runner does not exist.

- [ ] **Step 3: Implement bounded process execution**

```ts
export interface ProcessRequest {
  command: string;
  args: string[];
  cwd: string;
  stdin?: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  maxOutputBytes: number;
  signal: AbortSignal;
}

export interface ProcessResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  termination: "exit" | "cancelled" | "timed_out" | "output_limit";
}

export async function runProcess(request: ProcessRequest): Promise<ProcessResult>;
```

Use `spawn(command, args, { shell: false, windowsHide: true, detached: process.platform !== "win32" })`. Consume stdout and stderr incrementally, enforce a combined byte limit, write stdin then close it, and settle exactly once. A spawn error becomes a typed `PROCESS_START_FAILED` error.

- [ ] **Step 4: Implement process-tree termination**

On Windows, spawn `taskkill` directly with `[/pid, String(pid), /t]`, wait the grace period, then retry with `/f`. On POSIX, signal the negative process-group ID with `SIGTERM`, wait the grace period, then use `SIGKILL`. Treat an already-exited process as success.

- [ ] **Step 5: Run process tests and commit**

Run: `pnpm vitest run tests/integration/platform/process-runner.test.ts && pnpm lint && pnpm typecheck`

Expected: all process modes pass on the current OS; CI proves all three platforms.

```bash
git add src/platform tests/fake-agents tests/integration/platform
git commit -m "feat: add cancellable process runner"
```

---

### Task 6: Agent Contracts, Registry, and Safe Environment

**Files:**
- Create: `src/agents/types.ts`
- Create: `src/agents/agent-registry.ts`
- Create: `src/agents/safe-environment.ts`
- Create: `src/agents/help-capabilities.ts`
- Create: `tests/unit/agents/agent-registry.test.ts`
- Create: `tests/unit/agents/safe-environment.test.ts`
- Create: `tests/unit/agents/help-capabilities.test.ts`

**Interfaces:**
- Consumes: `ProcessResult` and Task 2 agent settings.
- Produces: the exact `AgentAdapter` contract from the spec, `AgentRegistry`, `buildSafeEnvironment()`, and `requireHelpFlags()`.

- [ ] **Step 1: Write failing contract-service tests**

Test registry lookup, duplicate adapters, `both` ordering, unavailable adapters, safe environment preservation, secret removal, and mandatory help flags:

```ts
expect(() => requireHelpFlags("Usage: tool --json", ["--json", "--read-only"]))
  .toThrow("Missing required CLI capability: --read-only");
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/unit/agents`

Expected: FAIL because shared agent modules do not exist.

- [ ] **Step 3: Define agent types exactly as the approved spec**

Create `AgentId`, `AgentCapabilities`, `AgentRequest`, `AgentResult`, and `AgentAdapter`. Add:

```ts
export type BuiltInAgentId = "codex" | "claude";
export type AgentSelection = BuiltInAgentId | "both";

export class AgentRegistry {
  constructor(adapters: readonly AgentAdapter[]);
  get(id: AgentId): AgentAdapter;
  select(selection: AgentSelection): readonly AgentAdapter[];
  probeAll(): Promise<Record<string, AgentCapabilities>>;
}
```

- [ ] **Step 4: Implement safe environment construction**

```ts
export function buildSafeEnvironment(
  source: NodeJS.ProcessEnv,
  extraAllowedNames: readonly string[],
): NodeJS.ProcessEnv;
```

Preserve only runtime-critical platform variables (`PATH`, `PATHEXT`, `SystemRoot`, `ComSpec`, `HOME`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `TMP`, `TEMP`, `TMPDIR`, `LANG`, `LC_ALL`) plus adapter-specific auth/config names. Never pass `AI_WORKSPACE_DISCORD_TOKEN`. Match names case-insensitively on Windows.

- [ ] **Step 5: Implement help capability validation and run tests**

`requireHelpFlags(help, flags)` must match complete flag tokens, return normally only when all are present, and throw `AGENT_CAPABILITY_UNSUPPORTED` listing missing flags.

Run: `pnpm vitest run tests/unit/agents && pnpm lint && pnpm typecheck`

Expected: all agent-core tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/agents tests/unit/agents
git commit -m "feat: define agent adapter boundary"
```

---

### Task 7: Codex and Claude Read-Only Adapters

**Files:**
- Create: `src/agents/codex-adapter.ts`
- Create: `src/agents/claude-adapter.ts`
- Create: `tests/fixtures/agent-output/codex-success.jsonl`
- Create: `tests/fixtures/agent-output/claude-success.json`
- Create: `tests/unit/agents/codex-adapter.test.ts`
- Create: `tests/unit/agents/claude-adapter.test.ts`
- Create: `tests/integration/agents/adapter-process.test.ts`

**Interfaces:**
- Consumes: Task 5 `runProcess`, Task 6 contracts, `captureGitIntegrity`, and configured executable names.
- Produces: `CodexAdapter` and `ClaudeAdapter`, each implementing `AgentAdapter`.

- [ ] **Step 1: Write failing parser and argument tests**

For Codex, assert help probing requires `exec`, `--json`, `--sandbox`, and `--cd` or `-C`; run arguments must include `exec --json --sandbox read-only -C <root> -`. Parse the last completed agent-message item from JSONL.

For Claude, assert help probing requires `--print`, `--output-format`, `--permission-mode`, and `--no-session-persistence`; run arguments must include `-p --output-format json --permission-mode plan --no-session-persistence`. Parse the top-level `result` string and reject `is_error: true`.

```ts
expect(parseClaudeResult('{"is_error":false,"result":"analysis"}')).toBe("analysis");
expect(parseCodexJsonl(codexFixture)).toBe("analysis");
```

- [ ] **Step 2: Run adapter tests to verify they fail**

Run: `pnpm vitest run tests/unit/agents/codex-adapter.test.ts tests/unit/agents/claude-adapter.test.ts`

Expected: FAIL because adapter modules do not exist.

- [ ] **Step 3: Implement the Codex adapter**

`probe()` runs `<command> exec --help` with a 10-second timeout and a 256 KiB output limit, validates the required flags, and returns diagnostics without throwing. `run()` probes first, captures Git integrity, runs Codex with prompt stdin, parses JSONL, captures integrity again, and fails with `PROJECT_INTEGRITY_CHANGED` if the snapshots differ.

Allow only `OPENAI_API_KEY`, `CODEX_HOME`, and the runtime-critical environment names from Task 6. Map process outcomes to `completed`, `failed`, `cancelled`, or `timed_out`.

- [ ] **Step 4: Implement the Claude adapter**

`probe()` runs `<command> --help`, validates mandatory flags, and optionally runs `<command> auth status` only when the help output lists that command. `run()` uses the same integrity sequence as Codex and passes only `ANTHROPIC_API_KEY`, `CLAUDE_CONFIG_DIR`, and runtime-critical environment names.

Do not pass `--dangerously-skip-permissions`, `--allow-dangerously-skip-permissions`, `--allowedTools`, or edit-capable permission modes.

- [ ] **Step 5: Add fake-process integration coverage**

Inject executable, argument builder, and process runner dependencies so the integration test can run the Node fake agent while asserting the real adapter lifecycle: capability check, prompt stdin, parsed response, bounded diagnostics, and unchanged Git state.

- [ ] **Step 6: Run adapter tests and commit**

Run: `pnpm vitest run tests/unit/agents tests/integration/agents && pnpm lint && pnpm typecheck`

Expected: all adapter tests pass without requiring real agent credentials.

```bash
git add src/agents tests/fixtures/agent-output tests/unit/agents tests/integration/agents
git commit -m "feat: add read-only Codex and Claude adapters"
```

---

### Task 8: Ask Orchestrator and Active-Run Cancellation

**Files:**
- Create: `src/orchestrator/types.ts`
- Create: `src/orchestrator/active-runs.ts`
- Create: `src/orchestrator/concurrency-gate.ts`
- Create: `src/orchestrator/ask-service.ts`
- Create: `tests/unit/orchestrator/active-runs.test.ts`
- Create: `tests/unit/orchestrator/concurrency-gate.test.ts`
- Create: `tests/unit/orchestrator/ask-service.test.ts`

**Interfaces:**
- Consumes: `AgentRegistry`, `ProjectService`, `ProjectRepository`, and `SessionRepository`.
- Produces: `AskService.ask()`, `ActiveRuns.cancel()`, `ConcurrencyGate.run()`, normalized ask reports, and persisted lifecycle transitions.

- [ ] **Step 1: Write failing orchestration tests**

Use in-memory fake adapters and a temporary SQLite database. Test one agent, both agents in parallel, one-of-two failure, both failure, cancellation, unavailable adapter, configured concurrency, duplicate interaction delivery, and persistence ordering.

```ts
const report = await service.ask({
  scope: { guildId: "g", channelId: "c", userId: "u" },
  interactionId: "interaction-1",
  projectId: "demo",
  selection: "both",
  question: "Explain authentication",
});
expect(report.results.map((result) => result.agentId)).toEqual(["codex", "claude"]);
expect(report.status).toBe("completed");
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/unit/orchestrator`

Expected: FAIL because orchestration modules do not exist.

- [ ] **Step 3: Implement active-run tracking**

```ts
export class ActiveRuns {
  register(runId: string, ownerUserId: string, controller: AbortController): void;
  unregister(runId: string): void;
  cancel(runId: string, requesterUserId: string): boolean;
  cancelAll(): void;
  list(): readonly { runId: string; ownerUserId: string }[];
}
```

Reject duplicate IDs, make cancellation idempotent, and enforce owner authorization before aborting.

- [ ] **Step 4: Implement the concurrency gate**

```ts
export class ConcurrencyGate {
  constructor(limit: number);
  run<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T>;
}
```

Start at most `limit` agent processes at once. Queue excess work in FIFO order, remove a queued operation immediately when its signal aborts, and always release the slot in `finally`.

- [ ] **Step 5: Implement `AskService`**

```ts
export interface AskInput {
  scope: { guildId: string; channelId: string; userId: string };
  interactionId: string;
  projectId?: string;
  selection: AgentSelection;
  question: string;
}

export interface AskReport {
  sessionId: string;
  status: "completed" | "partial" | "failed" | "cancelled";
  project: RegisteredProject;
  results: AgentResult[];
}

export class AskService {
  ask(input: AskInput): Promise<AskReport>;
}
```

Before creating work, query the repository by `interactionId`. Return its persisted terminal report when already completed, or raise `INTERACTION_IN_PROGRESS` while it is active. Resolve the explicit project or scoped active project, persist the user message before starting agents, run each selected adapter through `ConcurrencyGate`, combine `both` with `Promise.allSettled`, preserve deterministic Codex-then-Claude output ordering, persist every run and agent response, and unregister the controller in `finally`. One success plus one failure is `partial`; two failures are `failed`; an authorized abort is `cancelled`.

- [ ] **Step 6: Run orchestration tests and commit**

Run: `pnpm vitest run tests/unit/orchestrator && pnpm lint && pnpm typecheck`

Expected: all orchestration tests pass.

```bash
git add src/orchestrator tests/unit/orchestrator
git commit -m "feat: orchestrate dual-agent questions"
```

---

### Task 9: Discord Command Boundary and Runtime

**Files:**
- Create: `src/transport/discord/commands.ts`
- Create: `src/transport/discord/authorization.ts`
- Create: `src/transport/discord/response-format.ts`
- Create: `src/transport/discord/command-handler.ts`
- Create: `src/transport/discord/discord-runtime.ts`
- Create: `tests/unit/transport/discord/authorization.test.ts`
- Create: `tests/unit/transport/discord/response-format.test.ts`
- Create: `tests/unit/transport/discord/command-handler.test.ts`

**Interfaces:**
- Consumes: `AskService`, `AgentRegistry`, project repositories, session repositories, and `ActiveRuns`.
- Produces: Discord commands `/projects`, `/switch`, `/ask`, `/status`, `/stop` and a testable interaction port.

- [ ] **Step 1: Write failing authorization and handler tests**

Define a framework-neutral port and fake it in tests:

```ts
export interface InteractionPort {
  interactionId: string;
  commandName: string;
  guildId?: string;
  channelId: string;
  userId: string;
  getString(name: string, required?: boolean): string | undefined;
  deferReply(): Promise<void>;
  reply(content: DiscordPayload): Promise<void>;
  editReply(content: DiscordPayload): Promise<void>;
}
```

Test unauthorized guild, unauthorized user, missing active project, `/switch`, each `/ask` selection, `/status`, cancellation ownership, and a result longer than Discord's message limit.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/unit/transport/discord`

Expected: FAIL because Discord modules do not exist.

- [ ] **Step 3: Define slash commands and authorization**

Build `SlashCommandBuilder` definitions with exact options:

- `/projects`
- `/switch project` required string
- `/ask agent` required choice (`codex`, `claude`, `both`) and `question` required string
- `/status`
- `/stop run` optional string defaulting to the requester's current run

`authorize(scope, config)` must reject DMs, guilds outside `guildIds`, and users outside `allowedUserIds` before any database access.

- [ ] **Step 4: Implement formatting and the pure command handler**

Format ask results with project, session ID, status, separate agent headings, safe diagnostics, and no raw environment values. Use messages no longer than 1,900 characters; return a concise message plus an in-memory UTF-8 attachment for longer reports.

The handler must defer `/ask` immediately, pass `interactionId` into `AskService`, then edit the reply on success or known failure. A repeated interaction returns the persisted terminal report and never starts another agent process. Other commands reply directly. Map stable domain errors to actionable English messages without stack traces.

- [ ] **Step 5: Implement the Discord runtime adapter**

Create a `Client` with only required guild intents, register guild-scoped commands during startup, adapt `ChatInputCommandInteraction` to `InteractionPort`, and call the pure handler. The Discord token is read immediately before `client.login` from the configured environment name and is never passed to domain services.

- [ ] **Step 6: Run transport tests and commit**

Run: `pnpm vitest run tests/unit/transport/discord && pnpm lint && pnpm typecheck`

Expected: all Discord boundary tests pass without network access.

```bash
git add src/transport tests/unit/transport
git commit -m "feat: expose agent questions through Discord"
```

---

### Task 10: Setup, Doctor, Startup, End-to-End Test, and Operator Documentation

**Files:**
- Create: `src/cli/setup.ts`
- Create: `src/cli/doctor.ts`
- Create: `src/cli/start.ts`
- Create: `src/cli/parse-command.ts`
- Create: `src/index.ts`
- Create: `tests/unit/cli/parse-command.test.ts`
- Create: `tests/integration/vertical-slice.test.ts`
- Create: `README.md`
- Create: `SECURITY.md`
- Create: `CONTRIBUTING.md`
- Modify: `.env.example`
- Modify: `package.json`

**Interfaces:**
- Consumes: every Milestone 1 module.
- Produces: `pnpm setup`, `pnpm doctor`, `pnpm start`, graceful shutdown, and the documented public installation path.

- [ ] **Step 1: Write failing CLI and vertical-slice tests**

Test exact command parsing for `setup`, `doctor`, and `start`, plus invalid commands. The vertical-slice test must create a temporary Git project and database, use fake Codex and Claude process commands, invoke the Discord-neutral `/ask both` handler, and assert:

```ts
expect(reply.status).toBe("completed");
expect(reply.text).toContain("Codex");
expect(reply.text).toContain("Claude");
expect(sessionRepository.recent(1)).toHaveLength(1);
expect(await captureGitIntegrity(projectRoot)).toEqual(before);
```

The all-success fake-agent run must never be formatted as partial or failed.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/unit/cli tests/integration/vertical-slice.test.ts`

Expected: FAIL because CLI composition does not exist.

- [ ] **Step 3: Implement command parsing and guided setup**

```ts
export type CliCommand = { name: "setup" } | { name: "doctor" } | { name: "start" };
export function parseCommand(argv: readonly string[]): CliCommand;
```

Use `node:readline/promises` in `setup` to collect Discord application ID, guild IDs, authorized user IDs, and one or more project ID/name/root triples. Validate each project with Task 3 before saving. Create `.env` only after explicit confirmation, write only `AI_WORKSPACE_DISCORD_TOKEN=<entered value>`, set restrictive permissions where supported, and never echo the token.

- [ ] **Step 4: Implement doctor and startup composition**

`doctor` prints OS, Node, Git, config path, database writability, each project validation result, and each agent's capability diagnostics. It redacts home-relative details from shareable output unless `--verbose` is introduced in a separate design.

`start` loads `.env`, config, paths, database, migrations, projects, repositories, adapters, registry, orchestrator, command handler, and Discord runtime in that order. On `SIGINT` or `SIGTERM`, stop accepting interactions, call `ActiveRuns.cancelAll()`, wait up to 10 seconds, destroy the Discord client, close SQLite, and exit.

- [ ] **Step 5: Write operator and contributor documentation**

`README.md` must contain prerequisites for all three operating systems, clone/install commands, Discord application creation, `.env` setup, `pnpm setup`, `pnpm doctor`, `pnpm start`, command examples, local data locations, agent installation links, read-only guarantees, known limitations, and troubleshooting. `SECURITY.md` documents the allowlist, symlink rule, CLI capability gate, integrity backstop, secret handling, and vulnerability reporting. `CONTRIBUTING.md` documents pnpm, TDD, quality commands, English-only public artifacts, and the no-secret rule.

- [ ] **Step 6: Run the complete verification suite**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm build`

Expected: every command exits 0; the vertical-slice test proves both adapters, persistence, formatting, cancellation infrastructure, and unchanged Git state without real credentials.

- [ ] **Step 7: Perform opt-in local smoke checks**

Run: `pnpm doctor`

Expected on the current machine: Git and Node pass; Codex reports either supported capabilities or an actionable executable-access diagnostic; Claude reports not installed until the operator installs it. Do not weaken tests or adapter policy to make an unavailable local CLI appear healthy.

After the operator installs and authenticates both CLIs and configures a private Discord bot, run `pnpm start`, issue `/ask agent:both question:Summarize this project without changing files`, verify both responses arrive, then issue a long-running request followed by `/stop`. Confirm `git status --short` is unchanged.

- [ ] **Step 8: Commit**

```bash
git add src/cli src/index.ts tests/unit/cli tests/integration/vertical-slice.test.ts README.md SECURITY.md CONTRIBUTING.md .env.example package.json
git commit -m "feat: complete dual-agent vertical slice"
```

---

## Milestone 1 Completion Gate

Before starting the separate debate-engine plan, verify all of the following:

- `pnpm install --frozen-lockfile` succeeds from a fresh clone.
- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` all exit 0.
- CI passes on Windows, macOS, and Linux.
- `pnpm setup` creates only local configuration and an ignored `.env`.
- `pnpm doctor` reports real CLI capabilities and fails closed for unsupported read-only modes.
- `/ask` works for Codex, Claude, and both.
- One agent failure produces a partial response rather than discarding the successful result.
- SQLite contains the session, user message, agent runs, agent responses, and bounded diagnostics.
- `/stop` terminates the complete agent process tree and records cancellation.
- The selected Git project has identical pre-run and post-run integrity snapshots.
- No Discord token, personal path, guild ID, user ID, or project-specific name is tracked by Git.
