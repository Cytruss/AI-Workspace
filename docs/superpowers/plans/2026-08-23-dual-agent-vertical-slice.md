# Dual-Agent Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Milestone 1: a locally hosted Discord bot that can run Codex, Claude, or both against an authorized Git project in enforced source-non-modifying mode; conduct structured, auditable `/debate` deliberations; persist results in SQLite; report status; and cancel active work.

**Architecture:** Implement a TypeScript modular monolith whose domain services depend on explicit ports for agents, persistence, processes, and Discord. Invoke separately installed Codex and Claude Code CLIs through the same bounded process runner while keeping provider arguments inside their adapters, as accepted in [ADR-0007](../../decisions/0007-hardened-local-agent-clis.md). Keep Discord-specific objects at the transport edge, validate source-non-modification capabilities before every run, and pass a compact persisted claim board into stateless provider calls. Use fake CLIs and transport ports for deterministic cross-platform tests.

**Tech Stack:** Node.js 22+, pnpm 11.19.0, TypeScript 5.9.3, discord.js 14.27.0, Zod 4.4.3, better-sqlite3 13.0.3, dotenv 17.4.2, Vitest 4.1.11, ESLint 10.9.0, Prettier 3.9.6, tsx 4.23.12.

**Spec:** `docs/superpowers/specs/2026-08-23-ai-workspace-design.md`

## Global Constraints

- Node.js 22 or later.
- pnpm is pinned through `packageManager` in `package.json`.
- Windows, macOS, and Linux are supported from the first public release.
- All source code, documentation, configuration keys, commands, errors, and user-facing messages are in English.
- No personal paths, Discord identifiers, or application-specific assumptions may enter the repository.
- V0.1 accepts existing Git worktrees only.
- Only `OBSERVE` is executable; write-capable modes are rejected.
- Codex and Claude Code CLIs are installed and authenticated separately by each user.
- Secrets and local project paths remain outside Git.
- Processes are spawned directly with argument arrays, never shell interpolation.
- Provider source-non-modification controls are mandatory; capability uncertainty fails closed. Complete host read isolation is not promised without a future optional OS sandbox or container.
- The repository is licensed under Apache License 2.0.
- Do not add reusable semantic decision memory, a web UI, cloud persistence, dynamic plugins, or write-capable execution in this plan. Persisted deliberation state is scoped to v0.1 auditability.

## File Map

```text
src/
├── cli/                     # setup, doctor, start and argument dispatch
├── config/                  # schema, per-user paths and config loading
├── transport/discord/       # command definitions, handlers and Discord runtime
├── orchestrator/            # ask/debate lifecycle and active-run cancellation
├── debate/                  # claim board, bounded rounds and deterministic verdicts
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
docs/decisions/              # indexed architecture decision records
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
- Produces: `AppConfig`, `ProjectConfig`, `AgentConfig`, `DebateConfig`, `getAppPaths()`, `loadConfig()`, and `saveConfig()`.

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

Add `load-config.test.ts` cases for valid JSON, duplicate project IDs, a non-absolute project root, empty Discord allowlists, invalid execution mode, a missing token environment variable, all debate defaults, and every lower/upper boundary plus one-below/one-above rejection for each debate limit.

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

export const DebateConfigSchema = z.object({
  maxRounds: z.number().int().min(1).max(5).default(3),
  maxBoardClaims: z.number().int().min(2).max(200).default(40),
  maxBoardBytes: z.number().int().min(4_096).max(262_144).default(65_536),
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
  debate: DebateConfigSchema.default({ maxRounds: 3, maxBoardClaims: 40, maxBoardBytes: 65_536 }),
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
export type DebateConfig = z.infer<typeof DebateConfigSchema>;
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

Add a Git-tracked external-symlink case on platforms where test symlink creation is permitted. Also prove that an untracked external symlink and a dependency-manager symlink layout are not recursively rejected. Add integrity tests that detect a tracked edit and an untracked file.

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

Resolve with `realpath`, reject filesystem roots and the resolved home directory, run `git -C <root> rev-parse --show-toplevel` with direct process arguments, and require the result to equal the canonical root. Enumerate symbolic links from the Git index only, resolve each tracked link against the canonical root, and reject a target outside that root. Do not recursively scan untracked files or generated dependency trees such as pnpm's `node_modules` layout.

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
- Create: `src/storage/deliberation-repository.ts`
- Create: `tests/integration/storage/database.test.ts`
- Create: `tests/integration/storage/session-repository.test.ts`
- Create: `tests/integration/storage/deliberation-repository.test.ts`

**Interfaces:**
- Consumes: canonical projects from Task 3.
- Produces: `openDatabase()`, `migrateDatabase()`, `ProjectRepository`, `SessionRepository`, and `DeliberationRepository`.

- [ ] **Step 1: Write failing migration and repository tests**

Use an in-memory database and assert foreign keys, migration idempotency, project upsert, active-project scope, session transitions, messages, agent runs, errors, and complete deliberation round trips. The deliberation tests must reconstruct every provider call's exact bounded request, response, phase, purpose, input board, output board, claim origins, evidence origins, evidence resolution, translated claim/stance evidence links, stances, final positions, and immutable verdicts without relying on message transcripts. Add tests for broken cross-session/version/run references, content-hash mismatch, duplicate provider-local claim or evidence origin within one run, cross-provider reuse of the same evidence-local ID, two exact duplicate claims from different agents merging without losing either origin, and mechanically identical evidence merging without losing either origin. Include this state test:

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
  question TEXT NOT NULL, debate_config_json TEXT, status TEXT NOT NULL,
  created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT
);
CREATE TABLE messages (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id),
  role TEXT NOT NULL, agent_id TEXT, content TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE claim_boards (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id),
  version INTEGER NOT NULL, payload_json TEXT NOT NULL, content_hash TEXT NOT NULL,
  byte_length INTEGER NOT NULL, created_at TEXT NOT NULL,
  UNIQUE (session_id, version), UNIQUE (id, session_id)
);
CREATE TABLE debate_rounds (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id),
  round_number INTEGER NOT NULL, phase TEXT NOT NULL, status TEXT NOT NULL,
  input_board_id TEXT, output_board_id TEXT,
  created_at TEXT NOT NULL, finished_at TEXT,
  UNIQUE (session_id, round_number, phase), UNIQUE (id, session_id),
  FOREIGN KEY (input_board_id, session_id) REFERENCES claim_boards(id, session_id),
  FOREIGN KEY (output_board_id, session_id) REFERENCES claim_boards(id, session_id)
);
CREATE TABLE agent_runs (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), agent_id TEXT NOT NULL,
  round_id TEXT, phase TEXT NOT NULL, purpose TEXT NOT NULL,
  input_board_id TEXT, output_board_id TEXT,
  request_json TEXT NOT NULL, response_json TEXT, status TEXT NOT NULL,
  exit_code INTEGER, duration_ms INTEGER NOT NULL, diagnostics_json TEXT NOT NULL,
  created_at TEXT NOT NULL, finished_at TEXT, UNIQUE (id, session_id),
  FOREIGN KEY (round_id, session_id) REFERENCES debate_rounds(id, session_id),
  FOREIGN KEY (input_board_id, session_id) REFERENCES claim_boards(id, session_id),
  FOREIGN KEY (output_board_id, session_id) REFERENCES claim_boards(id, session_id)
);
CREATE TABLE claims (
  board_id TEXT NOT NULL REFERENCES claim_boards(id), canonical_id TEXT NOT NULL,
  normalized_text TEXT NOT NULL, material INTEGER NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY (board_id, canonical_id)
);
CREATE TABLE claim_origins (
  id TEXT PRIMARY KEY, board_id TEXT NOT NULL, canonical_claim_id TEXT NOT NULL,
  agent_id TEXT NOT NULL, agent_run_id TEXT NOT NULL REFERENCES agent_runs(id),
  provider_local_id TEXT NOT NULL,
  FOREIGN KEY (board_id, canonical_claim_id) REFERENCES claims(board_id, canonical_id),
  UNIQUE (agent_run_id, provider_local_id)
);
CREATE TABLE evidence_references (
  board_id TEXT NOT NULL, canonical_id TEXT NOT NULL,
  tracked_path TEXT NOT NULL, line_start INTEGER, line_end INTEGER, content_hash TEXT,
  resolution TEXT NOT NULL, resolved_hash TEXT,
  PRIMARY KEY (board_id, canonical_id)
);
CREATE TABLE evidence_origins (
  id TEXT PRIMARY KEY, board_id TEXT NOT NULL, canonical_evidence_id TEXT NOT NULL,
  agent_id TEXT NOT NULL, agent_run_id TEXT NOT NULL REFERENCES agent_runs(id),
  provider_local_id TEXT NOT NULL,
  FOREIGN KEY (board_id, canonical_evidence_id) REFERENCES evidence_references(board_id, canonical_id),
  UNIQUE (agent_run_id, provider_local_id)
);
CREATE TABLE claim_evidence (
  board_id TEXT NOT NULL, canonical_claim_id TEXT NOT NULL, canonical_evidence_id TEXT NOT NULL,
  FOREIGN KEY (board_id, canonical_claim_id) REFERENCES claims(board_id, canonical_id),
  FOREIGN KEY (board_id, canonical_evidence_id) REFERENCES evidence_references(board_id, canonical_id),
  PRIMARY KEY (board_id, canonical_claim_id, canonical_evidence_id)
);
CREATE TABLE stances (
  id TEXT PRIMARY KEY, board_id TEXT NOT NULL, canonical_claim_id TEXT NOT NULL,
  round_id TEXT NOT NULL REFERENCES debate_rounds(id), agent_run_id TEXT NOT NULL REFERENCES agent_runs(id),
  agent_id TEXT NOT NULL,
  stance TEXT NOT NULL, reasoning TEXT NOT NULL,
  FOREIGN KEY (board_id, canonical_claim_id) REFERENCES claims(board_id, canonical_id),
  UNIQUE (canonical_claim_id, round_id, agent_id)
);
CREATE TABLE stance_evidence (
  stance_id TEXT NOT NULL REFERENCES stances(id),
  board_id TEXT NOT NULL, canonical_evidence_id TEXT NOT NULL,
  FOREIGN KEY (board_id, canonical_evidence_id) REFERENCES evidence_references(board_id, canonical_id),
  PRIMARY KEY (stance_id, canonical_evidence_id)
);
CREATE TABLE final_positions (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id),
  board_id TEXT NOT NULL, round_id TEXT NOT NULL,
  agent_run_id TEXT NOT NULL UNIQUE, agent_id TEXT NOT NULL,
  position_json TEXT NOT NULL, content_hash TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE (session_id, agent_id),
  FOREIGN KEY (board_id, session_id) REFERENCES claim_boards(id, session_id),
  FOREIGN KEY (round_id, session_id) REFERENCES debate_rounds(id, session_id),
  FOREIGN KEY (agent_run_id, session_id) REFERENCES agent_runs(id, session_id)
);
CREATE TABLE final_stances (
  final_position_id TEXT NOT NULL REFERENCES final_positions(id),
  board_id TEXT NOT NULL, canonical_claim_id TEXT NOT NULL, stance TEXT NOT NULL,
  FOREIGN KEY (board_id, canonical_claim_id) REFERENCES claims(board_id, canonical_id),
  PRIMARY KEY (final_position_id, canonical_claim_id)
);
CREATE TABLE verdicts (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id),
  board_id TEXT NOT NULL, canonical_claim_id TEXT NOT NULL,
  round_id TEXT REFERENCES debate_rounds(id), codex_run_id TEXT REFERENCES agent_runs(id),
  claude_run_id TEXT REFERENCES agent_runs(id), classification TEXT NOT NULL,
  evidence_support TEXT NOT NULL, verdict_json TEXT NOT NULL, content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (board_id, canonical_claim_id) REFERENCES claims(board_id, canonical_id),
  FOREIGN KEY (board_id, session_id) REFERENCES claim_boards(id, session_id),
  FOREIGN KEY (round_id, session_id) REFERENCES debate_rounds(id, session_id),
  FOREIGN KEY (codex_run_id, session_id) REFERENCES agent_runs(id, session_id),
  FOREIGN KEY (claude_run_id, session_id) REFERENCES agent_runs(id, session_id),
  UNIQUE (session_id, canonical_claim_id)
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

export class DeliberationRepository {
  createRound(input: CreateDebateRoundInput): DebateRoundRecord;
  finishRound(id: string, status: DebateRoundStatus): void;
  createClaimBoard(input: CreateClaimBoardInput): ClaimBoardRecord;
  addClaim(input: AddClaimInput): ClaimRecord;
  addClaimOrigin(input: AddClaimOriginInput): ClaimOriginRecord;
  addEvidenceReference(input: AddEvidenceReferenceInput): EvidenceReferenceRecord;
  addEvidenceOrigin(input: AddEvidenceOriginInput): EvidenceOriginRecord;
  linkClaimEvidence(input: LinkClaimEvidenceInput): void;
  addStance(input: AddStanceInput): StanceRecord;
  linkStanceEvidence(input: LinkStanceEvidenceInput): void;
  addFinalPosition(input: AddFinalPositionInput): FinalPositionRecord;
  addVerdict(input: AddVerdictInput): VerdictRecord;
  load(sessionId: string): PersistedDeliberation;
  reconstructAgentCall(runId: string): ReconstructedAgentCall;
}
```

Serialize claim-board snapshots and verdicts with canonical key ordering, enforce configured board byte/claim limits before insertion, and verify their SHA-256 content hashes on load. Guard invalid transitions and all cross-session links in one transaction; constrain stances to `ACCEPT`, `DISPUTE`, or `UNCERTAIN`, evidence resolution to `VERIFIED`, `INVALID`, or `MISSING`, and verdict classification to `CONSENSUS`, `DISAGREEMENT`, `REJECTED`, or `UNRESOLVED`. Generate opaque record IDs with `randomUUID()`; canonical claim and evidence IDs are assigned only by Task 9.

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
- Create: `src/agents/structured-response.ts`
- Create: `tests/unit/agents/agent-registry.test.ts`
- Create: `tests/unit/agents/safe-environment.test.ts`
- Create: `tests/unit/agents/help-capabilities.test.ts`
- Create: `tests/unit/agents/structured-response.test.ts`

**Interfaces:**
- Consumes: `ProcessResult` and Task 2 agent settings.
- Produces: the exact `AgentAdapter` contract from the spec, `AgentRegistry`, `buildSafeEnvironment()`, `requireHelpFlags()`, and stable normalized schemas for provider-local claims, canonical claims, evidence references and resolution, stances, rounds, final positions, and immutable verdicts.

- [ ] **Step 1: Write failing contract-service tests**

Test registry lookup, duplicate adapters, `both` ordering, unavailable adapters, safe environment preservation, secret removal, mandatory help flags, strict known-field validation, unknown-field tolerance at provider boundaries, duplicate provider-local ID rejection, and stable normalization of claim, evidence, stance, round, final-position, and verdict data:

```ts
expect(() => requireHelpFlags("Usage: tool --json", ["--json", "--read-only"]))
  .toThrow("Missing required CLI capability: --read-only");
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/unit/agents`

Expected: FAIL because shared agent modules do not exist.

- [ ] **Step 3: Define agent types exactly as the approved spec**

Create `AgentId`, `AgentCapabilities`, `AgentRequest`, `AgentResult`, and `AgentAdapter`. `AgentRequest` includes an optional explicit response schema; `AgentResult.structured` contains normalized data rather than provider-specific payloads. Add:

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

Define and export stable Zod schemas and inferred types for:

```ts
ProviderEvidenceReference = { localId: string; trackedPath: string; lineStart?: number; lineEnd?: number; contentHash?: string };
ProviderClaim = { localId: string; text: string; material: boolean; evidenceLocalIds: string[] };
ClaimOrigin = { agentId: AgentId; agentRunId: string; providerLocalId: string };
CanonicalClaim = { id: string; text: string; material: boolean; evidenceIds: string[]; origins: ClaimOrigin[] };
EvidenceOrigin = { agentId: AgentId; agentRunId: string; providerLocalId: string };
CanonicalEvidence = { id: string; status: "VERIFIED" | "INVALID" | "MISSING"; trackedPath: string; lineStart?: number; lineEnd?: number; expectedHash?: string; resolvedHash?: string; origins: EvidenceOrigin[] };
Stance = { claimId: string; value: "ACCEPT" | "DISPUTE" | "UNCERTAIN"; reasoning: string; evidenceIds: string[] };
ClaimBoard = { version: number; claims: CanonicalClaim[]; evidence: CanonicalEvidence[] };
FinalPosition = { agentId: AgentId; agentRunId: string; roundId: string; stances: Stance[] };
Verdict = Readonly<{ claimId: string; classification: "CONSENSUS" | "DISAGREEMENT" | "REJECTED" | "UNRESOLVED"; support: "VERIFIED" | "UNSUPPORTED"; finalStances: readonly [StanceRecord, StanceRecord] | readonly StanceRecord[]; evidence: readonly CanonicalEvidence[]; provenance: readonly ClaimOrigin[]; counts: Readonly<VerdictCounts> }>;
```

Provider schemas must expose provider-local claim and evidence references only. Schemas impose bounded string and array sizes, unique local IDs per response, valid local references, and deterministic ordering. Canonical IDs are not accepted from provider output. Host canonicalization translates every claim and stance reference to canonical claim and evidence IDs before persistence. Verdict schemas are deeply immutable after construction.

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

### Task 7: Hardened Codex and Claude CLI Adapters

**Files:**
- Create: `src/agents/codex-adapter.ts`
- Create: `src/agents/claude-adapter.ts`
- Create: `tests/fixtures/agent-output/codex-success.json`
- Create: `tests/fixtures/agent-output/claude-success.json`
- Create: `tests/unit/agents/codex-adapter.test.ts`
- Create: `tests/unit/agents/claude-adapter.test.ts`
- Create: `tests/integration/agents/adapter-process.test.ts`

**Interfaces:**
- Consumes: Task 5 `runProcess`, Task 6 contracts and structured schemas, `captureGitIntegrity`, and the configured Codex and Claude executable names.
- Produces: `CodexAdapter` and `ClaudeAdapter`, each implementing `AgentAdapter`.

- [ ] **Step 1: Write failing parser and argument tests**

For Codex, assert `codex exec --help` contains complete tokens for `--ephemeral`, `--ignore-user-config`, `--ignore-rules`, `--json`, `--output-schema`, `--sandbox`, and `--cd` or `-C`. Run arguments must be equivalent to `exec --ephemeral --ignore-user-config --ignore-rules --json --sandbox read-only -C <root> --output-schema <temporary-schema-path> -`. Parse the completed structured response from bounded JSONL and normalize it through Task 6 provider-local schemas.

For Claude, assert version/help probing requires compatible, parseable version output and the complete tokens `--bare`, `--tools`, `--disallowedTools`, `--permission-mode`, `--no-session-persistence`, `--print` or `-p`, `--output-format`, and `--json-schema`. Its exact safety argument subsequence is `--bare --tools "Read,Glob,Grep" --disallowedTools "mcp__*" --permission-mode plan --no-session-persistence -p --output-format json --json-schema <compact-inline-json>`. The compact schema, with a UTF-8 limit of `MAX_RESPONSE_SCHEMA_BYTES = 32_768`, is passed as one array element without a shell. Parse the top-level JSON result, validate its structured payload through Task 6 provider-local schemas, and reject `is_error: true`.

```ts
expect(parseClaudeResult('{"is_error":false,"result":"analysis"}')).toBe("analysis");
expect(parseCodexJsonl(codexFixture)).toEqual(expectedStructuredResponse);
```

- [ ] **Step 2: Run adapter tests to verify they fail**

Run: `pnpm vitest run tests/unit/agents/codex-adapter.test.ts tests/unit/agents/claude-adapter.test.ts`

Expected: FAIL because adapter modules do not exist.

- [ ] **Step 3: Implement the Codex adapter**

`probe()` runs the separately installed `<command> --version` and `<command> exec --help` with a 10-second timeout and 256 KiB output limit through `runProcess`. It fails closed on an unparseable or unsupported version or unless every required Codex token is present, including one working-directory spelling. Record the supported minimum version/range in a reviewed adapter compatibility constant and fixture. `run()` probes first, captures Git integrity, writes the response schema only after enforcing `MAX_RESPONSE_SCHEMA_BYTES = 32_768` to a private temporary directory, invokes the exact hardened argument set through `runProcess`, parses bounded JSONL, captures integrity again, and fails with `PROJECT_INTEGRITY_CHANGED` if the snapshots differ. Remove only that Codex temporary schema and directory in `finally` without following links.

Pass only `OPENAI_API_KEY`, `CODEX_HOME`, and the runtime-critical environment names from Task 6. Map process completion, failure, cancellation, timeout, output limit, and malformed structured output to normalized agent outcomes.

- [ ] **Step 4: Implement the Claude adapter**

`probe()` runs the separately installed `<command> --version` and `<command> --help` through `runProcess`, rejects unparseable or unsupported versions against a reviewed compatibility constant, and fails closed unless every mandatory safety, ambient-isolation, session, and structured-output flag is present. `run()` uses the same integrity snapshots as Codex but creates no schema file: it compacts the JSON schema, enforces the 32,768-byte UTF-8 bound, and supplies it as exactly one `--json-schema` argument. The argument builder emits `--bare`, `--tools`, `Read,Glob,Grep`, `--disallowedTools`, `mcp__*`, `--permission-mode`, `plan`, `--no-session-persistence`, `-p`, `--output-format`, `json`, `--json-schema`, and the compact schema value; the prompt travels through bounded stdin and no shell interprets either value. Pass only `ANTHROPIC_API_KEY`, `CLAUDE_CONFIG_DIR`, and runtime-critical environment names.

`--bare` disables discovered MCP servers and customizations; `--disallowedTools "mcp__*"` is required defense in depth against ambient MCP tools. Only Read, Glob, and Grep are available. Do not pass or expose Bash, Edit, Write, Notebook, `--dangerously-skip-permissions`, `--allow-dangerously-skip-permissions`, `--allowedTools`, or edit-capable permission modes.

- [ ] **Step 5: Add fake-process integration coverage**

Inject executable names, separate argument builders, and the process runner. Exercise both complete adapter lifecycles with fake Node CLIs while asserting fail-closed version/capability checks for every required flag, prompt stdin, structured schema validation, provider-local claim and evidence IDs, bounded diagnostics, output-limit termination, unchanged Git state, and complete descendant-tree cancellation. Codex tests assert the restrictive schema file path occupies the `--output-schema` value and that the one Codex temporary file is removed in `finally`. Claude tests assert the compact schema occupies exactly one inline `--json-schema` array element, no schema file is created or removed, the exact Read/Glob/Grep allowlist is present, `--bare` and explicit `mcp__*` denial are both present, and Bash/Edit/Write/Notebook plus ambient MCP tools cannot be invoked. The same integration suite must be runnable on Windows, macOS, and Linux CI.

- [ ] **Step 6: Run adapter tests and commit**

Run: `pnpm vitest run tests/unit/agents tests/integration/agents && pnpm lint && pnpm typecheck`

Expected: all adapter tests pass without requiring real agent credentials.

```bash
git add src/agents tests/fixtures/agent-output tests/unit/agents tests/integration/agents
git commit -m "feat: add hardened Codex and Claude CLI adapters"
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

### Task 9: Structured Deliberation and Deterministic Verdicts

**Files:**
- Create: `src/debate/types.ts`
- Create: `src/debate/claim-board.ts`
- Create: `src/debate/evidence-canonicalizer.ts`
- Create: `src/debate/context-builder.ts`
- Create: `src/debate/evidence-resolver.ts`
- Create: `src/debate/verdicts.ts`
- Create: `src/debate/polish-report.ts`
- Create: `src/debate/debate-service.ts`
- Create: `tests/unit/debate/claim-board.test.ts`
- Create: `tests/unit/debate/evidence-canonicalizer.test.ts`
- Create: `tests/unit/debate/context-builder.test.ts`
- Create: `tests/unit/debate/evidence-resolver.test.ts`
- Create: `tests/unit/debate/verdicts.test.ts`
- Create: `tests/unit/debate/polish-report.test.ts`
- Create: `tests/unit/debate/debate-service.test.ts`

**Interfaces:**
- Consumes: `AgentRegistry`, Task 2 `DebateConfig`, Task 6 structured schemas, `ProjectService`, `SessionRepository`, `DeliberationRepository`, `ActiveRuns`, and `ConcurrencyGate`.
- Produces: `DebateService.debate()`, persisted compact claim boards, bounded structured rounds, independent final positions, and deterministic `CONSENSUS`, `DISAGREEMENT`, `REJECTED`, or `UNRESOLVED` verdict reports.

```ts
export interface DebateInput {
  scope: { guildId: string; channelId: string; userId: string };
  interactionId: string;
  projectId?: string;
  topic: string;
}

export class DebateService {
  debate(input: DebateInput, config: DebateConfig): Promise<DebateReport>;
}
```

- [ ] **Step 1: Write failing deliberation tests**

Use schema-valid fake adapters and an in-memory database. Cover all of these cases:

- the complete ordered 3-by-3 final-stance matrix: `ACCEPT`/`ACCEPT` is `CONSENSUS`; `ACCEPT`/`DISPUTE` in either order is `DISAGREEMENT`; `DISPUTE`/`DISPUTE` is `REJECTED`; all five pairs containing `UNCERTAIN` are `UNRESOLVED`;
- zero, one, or more than two final stances, plus failed or cancelled final-position runs, are `UNRESOLVED`;
- changing any earlier-round stance does not change a verdict when final stances are unchanged;
- tracked in-root path plus matching line/hash evidence resolves `VERIFIED`; missing targets resolve `MISSING`; escaping paths, untracked paths, invalid ranges, and hash mismatches resolve `INVALID`; none of these statuses asserts semantic truth;
- `CONSENSUS` with no `VERIFIED` evidence is visibly `UNSUPPORTED`;
- one-agent failure before initial claims returns analysis rather than labeling the result a debate, while a later failure returns an auditable partial debate;
- cancellation stops pending provider calls and persists the cancelled state;
- unresolved material claims trigger additional rounds only up to the configured round cap;
- identical provider outputs produce the same monotonic canonical IDs and byte-for-byte equivalent verdict data regardless of response arrival order;
- exact duplicate normalized claims merge many-to-one while preserving both origins; provider-local ID collisions within one run fail validation;
- the same provider-local evidence ID from different agents/runs cannot collide; a duplicate within one run fails validation; mechanically identical references merge to one canonical evidence ID while preserving every origin;
- every provider-local evidence reference in claims and stances translates to a canonical `evidence-NNNN` ID, including mechanically `INVALID` or `MISSING` records retained for audit;
- the default and every boundary value from `DebateConfig` reach `DebateService`, are recorded on the session, and enforce rounds, board claim count, and serialized byte count;
- every provider call receives only the topic, rules, response schema, and a compact claim board bounded by the effective configuration, never the unconstrained transcript or a hidden resumed session;
- every persisted provider call can be reconstructed exactly from its request/response and input/output board hashes;
- the optional polisher may change summary prose, but changing a verdict, classification, stance, evidence, provenance, ID, or count fails deep comparison.

```ts
expect(report.consensus.map((item) => item.claimId)).toEqual(["claim-0001"]);
expect(report.disagreements.map((item) => item.claimId)).toEqual(["claim-0002"]);
expect(report.rounds).toHaveLength(maxRounds);
expect(fakeCalls.every((call) => call.sessionId === undefined)).toBe(true);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/unit/debate`

Expected: FAIL because deliberation modules do not exist.

- [ ] **Step 3: Implement claim-board construction and bounded context**

Normalize independently produced provider-local claims and evidence through Task 6 schemas. Reject duplicate provider-local claim or evidence IDs within one run, while treating the same local ID from different runs as unrelated. Sort normalized claims by content and deterministic provider/run/local-reference tie-breakers, then assign canonical IDs monotonically as `claim-0001`, `claim-0002`, and so on. Merge exact normalized claim duplicates while persisting every origin in `claim_origins`; providers never supply canonical IDs.

After claim canonicalization, normalize evidence mechanically and sort by the deterministic tuple `(normalized tracked path, line start, line end, expected content hash, agent ID, run ID, provider-local evidence ID)`. Assign `evidence-0001`, `evidence-0002`, and so on. Merge references whose normalized path/range/hash tuple is identical, preserve every source in `evidence_origins`, and translate all claim and stance references from their run-scoped local IDs to canonical evidence IDs. Retain `INVALID` and `MISSING` references as canonical auditable records rather than dropping them. Persist claim/evidence joins, stance/evidence joins, and a content-hashed immutable board snapshot before cross-examination. `buildDeliberationContext(config: DebateConfig, ...)` must include only material or currently unresolved entries required by the round and fail with `DEBATE_CONTEXT_LIMIT` rather than ambiguously truncate when either `maxBoardClaims` or `maxBoardBytes` would be exceeded.

- [ ] **Step 4: Implement cross-examination and bounded rounds**

Send the same explicit compact board to fresh stateless Codex and Claude calls. Require one `ACCEPT`, `DISPUTE`, or `UNCERTAIN` stance per reviewed material claim. Run another round only for material claims still disputed or uncertain and only below `config.maxRounds`. Persist each round's phase and input/output board versions plus each agent run's phase, purpose, exact bounded request/response, board links, evidence, and stance before scheduling another call.

- [ ] **Step 5: Resolve evidence mechanically**

Resolve evidence only in host code. Canonicalize and require a Git-tracked path inside the project root, validate optional line ranges, and compare optional SHA-256 content hashes. Return only `VERIFIED`, `INVALID`, or `MISSING`; document in types and rendered output that `VERIFIED` proves byte identity, not semantic truth. Persistence tests must reconstruct each call's exact input and output board from versioned payload/hash records and FKs, including canonical claim/evidence records, claim/stance evidence joins, and every claim/evidence origin.

- [ ] **Step 6: Implement final positions and deterministic verdict derivation**

Collect independent final positions in fresh stateless calls, requiring exactly one final stance per canonical material claim. Ignore all earlier stances when classifying. Apply the exhaustive pure function: `ACCEPT` + `ACCEPT` = `CONSENSUS`; `ACCEPT` + `DISPUTE` in either order = `DISAGREEMENT`; `DISPUTE` + `DISPUTE` = `REJECTED`; every pair containing `UNCERTAIN`, every missing/failed/cancelled agent, and anything other than exactly two valid final stances = `UNRESOLVED`. Mark a consensus with no `VERIFIED` evidence as `UNSUPPORTED`.

Create a deeply immutable structured verdict with canonical claim ID, classification, final stance/run/round records, resolved evidence, complete origins, support marker, and deterministic counts. Sort by canonical claim ID and persist before presentation. A model may change summary prose only; deep-compare the entire structured verdict collection before and after polishing and reject any change to verdicts, classifications, evidence/provenance, IDs, or counts.

- [ ] **Step 7: Implement degraded operation, cancellation, and persistence**

Before both initial responses exist, one-agent failure returns the successful independent analysis with `DEBATE_NOT_ESTABLISHED`. Later failure yields `partial`, retaining the claim board, completed rounds, stances, evidence, final positions, and `UNRESOLVED` verdicts for affected claims. `DebateService.debate(input, config: DebateConfig)` records the effective immutable config, registers with `ActiveRuns`, passes one abort signal through every queued/provider operation, persists terminal state exactly once, and unregisters in `finally`.

- [ ] **Step 8: Run deliberation tests and commit**

Run: `pnpm vitest run tests/unit/debate tests/integration/storage && pnpm lint && pnpm typecheck`

Expected: all deliberation and persistence tests pass with deterministic ordering and bounded context.

```bash
git add src/debate tests/unit/debate src/storage tests/integration/storage
git commit -m "feat: add structured dual-agent deliberation"
```

---

### Task 10: Discord Command Boundary and Runtime

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
- Consumes: `AskService`, `DebateService`, `AgentRegistry`, project repositories, session and deliberation repositories, and `ActiveRuns`.
- Produces: Discord commands `/projects`, `/switch`, `/ask`, `/debate`, `/status`, `/stop` and a testable interaction port.

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

Test unauthorized guild, unauthorized user, missing active project, `/switch`, each `/ask` selection, `/debate topic:<text> project:<id?>` with active and explicit projects, `/status`, cancellation ownership, one-agent debate failure, deterministic debate rendering, unsupported consensus labeling, and a result longer than Discord's message limit.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/unit/transport/discord`

Expected: FAIL because Discord modules do not exist.

- [ ] **Step 3: Define slash commands and authorization**

Build `SlashCommandBuilder` definitions with exact options:

- `/projects`
- `/switch project` required string
- `/ask agent` required choice (`codex`, `claude`, `both`) and `question` required string
- `/debate topic` required string and `project` optional registered-project string
- `/status`
- `/stop run` optional string defaulting to the requester's current run

`authorize(scope, config)` must reject DMs, guilds outside `guildIds`, and users outside `allowedUserIds` before any database access.

- [ ] **Step 4: Implement formatting and the pure command handler**

Format ask results with project, session ID, status, separate agent headings, safe diagnostics, and no raw environment values. Format debate results in separate `CONSENSUS`, `DISAGREEMENT`, `REJECTED`, and `UNRESOLVED` sections, followed by mechanically resolved evidence and provenance. Label consensus without verified evidence as `UNSUPPORTED`; do not merge or relabel verdicts in model-written prose. Use messages no longer than 1,900 characters; return a concise message plus an in-memory UTF-8 attachment for longer reports.

The handler must defer `/ask` and `/debate` immediately, pass `interactionId` into the appropriate service, then edit the reply on success or known failure. A repeated interaction returns the persisted terminal report and never starts another provider call. Other commands reply directly. Map stable domain errors to actionable English messages without stack traces.

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

### Task 11: Setup, Doctor, Startup, End-to-End Test, and Operator Documentation

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

Test exact command parsing for `setup`, `doctor`, and `start`, plus invalid commands. The vertical-slice test must create a temporary Git project and database, use fake Codex and Claude CLI processes, invoke the Discord-neutral `/ask both` and `/debate` handlers, and assert:

```ts
expect(reply.status).toBe("completed");
expect(reply.text).toContain("Codex");
expect(reply.text).toContain("Claude");
expect(sessionRepository.recent(1)).toHaveLength(1);
expect(await captureGitIntegrity(projectRoot)).toEqual(before);
```

For `/debate`, assert that both agents receive explicit claim-board context, every call is reconstructible, canonical IDs and duplicate origins are persisted, final-stances-only verdicts render in separate classification sections with mechanical evidence status, the run obeys all effective `DebateConfig` limits, and Git integrity remains unchanged. The all-success fake-provider runs must never be formatted as partial or failed.

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

`start` loads `.env`, config, paths, database, migrations, projects, repositories, adapters, registry, ask and debate services, command handler, and Discord runtime in that order. On `SIGINT` or `SIGTERM`, stop accepting interactions, call `ActiveRuns.cancelAll()`, wait up to 10 seconds, destroy the Discord client, close SQLite, and exit.

- [ ] **Step 5: Write operator and contributor documentation**

`README.md` must link `docs/decisions/README.md` and contain prerequisites for all three operating systems, clone/install commands, Discord application creation, `.env` setup, `pnpm setup`, `pnpm doctor`, `pnpm start`, `/ask` and `/debate topic:<text> project:<id?>` examples, local data locations, separate Codex and Claude CLI installation/authentication links, source-non-modification guarantees, the complete-host-read-isolation limitation, structured deliberation and deterministic-verdict guarantees, mechanical evidence limitations, and troubleshooting. `SECURITY.md` documents the allowlist, Git-tracked-only symlink rule, provider capability gate, ambient-config isolation flags, integrity backstop, host read-isolation limitation, secret handling, and vulnerability reporting. `CONTRIBUTING.md` documents pnpm, TDD, quality commands, ADR usage, English-only public artifacts, and the no-secret rule.

- [ ] **Step 6: Run the complete verification suite**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm build`

Expected: every command exits 0; the vertical-slice test proves `/ask` and `/debate`, both hardened CLI adapters, reconstructible claim-board persistence, exhaustive deterministic verdict formatting, process-tree cancellation, bounded context, and unchanged Git state without real credentials.

- [ ] **Step 7: Perform opt-in local smoke checks**

Run: `pnpm doctor`

Expected on the current machine: Git and Node pass; each CLI reports supported hardened capabilities or an actionable installation, authentication, or missing-flag diagnostic. Do not weaken tests or adapter policy to make an unavailable or unsafe local CLI appear healthy.

After the operator installs and authenticates both CLIs and configures a private Discord bot, run `pnpm start`; issue `/ask agent:both question:Summarize this project without changing files`; issue `/debate topic:Identify the highest-risk module and justify the choice`; verify all verdict classes and evidence statuses render separately; then issue a long-running request followed by `/stop`. Confirm `git status --short` is unchanged.

- [ ] **Step 8: Commit**

```bash
git add src/cli src/index.ts tests/unit/cli tests/integration/vertical-slice.test.ts README.md SECURITY.md CONTRIBUTING.md .env.example package.json
git commit -m "feat: complete dual-agent vertical slice"
```

---

## Milestone 1 Completion Gate

Before declaring the dual-agent vertical slice complete, verify all of the following:

- `pnpm install --frozen-lockfile` succeeds from a fresh clone.
- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` all exit 0.
- CI passes on Windows, macOS, and Linux.
- `pnpm setup` creates only local configuration and an ignored `.env`.
- `pnpm doctor` reports real provider capabilities and fails closed for unsupported source-non-modification modes.
- `/ask` works for Codex, Claude, and both.
- `/debate topic:<text> project:<id?>` runs independent provider-local initial claims/evidence, deterministic canonical claim and evidence IDs with complete many-to-one origins and local-to-canonical translation, shared persisted claim-board snapshots, cross-examination, configured bounded unresolved-claim rounds, independent final positions, and exhaustive final-stances-only verdict derivation.
- `DebateConfig` defaults and bounds are enforced, persisted, and threaded through every deliberation call.
- Discord renders `CONSENSUS`, `DISAGREEMENT`, `REJECTED`, `UNRESOLVED`, and mechanical evidence status separately, including `UNSUPPORTED` consensus.
- Provider calls use explicit bounded context and do not depend on hidden session history.
- One agent failure produces a partial response rather than discarding the successful result.
- SQLite reconstructs every provider request/response and contains hashed board snapshots, canonical claims and evidence, separate many-to-one claim/evidence origins, claim/stance evidence joins, mechanically resolved invalid/missing/verified references, phase-linked rounds and runs, audit stances, final positions, immutable verdicts, and bounded diagnostics.
- `/stop` terminates the complete agent process tree and records cancellation.
- Both CLI version/capability probes fail closed if any required safety, ambient-isolation, session, or structured-output flag is absent; Claude uses `--bare`, the exact Read/Glob/Grep allowlist, explicit `mcp__*` denial, plan permission mode, no session persistence, print mode, and JSON output.
- Codex alone receives a bounded restrictive schema file that is removed in `finally`; Claude receives the bounded compact schema JSON inline as one argument, and neither adapter invokes a shell.
- The selected Git project has identical pre-run and post-run integrity snapshots.
- Only Git-tracked symlinks are rejected for escaping the project root; dependency-manager symlink layouts remain valid.
- No Discord token, personal path, guild ID, user ID, or project-specific name is tracked by Git.
