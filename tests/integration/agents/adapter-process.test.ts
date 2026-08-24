import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  CLAUDE_SETTINGS,
  ClaudeAdapter,
} from "../../../src/agents/claude-adapter.js";
import { CodexAdapter } from "../../../src/agents/codex-adapter.js";
import {
  CrossExaminationPhaseResponseSchema,
  FinalPhaseResponseSchema,
  InitialPhaseResponseSchema,
} from "../../../src/agents/structured-response.js";
import {
  runProcess,
  type ProcessRequest,
} from "../../../src/platform/process-runner.js";
import type { AgentConfig } from "../../../src/config/schema.js";
import type { AgentRequest } from "../../../src/agents/types.js";

const snapshot = { porcelainV2: "", dirtyPathFingerprints: "[]" };
const codexCli = fileURLToPath(
  new URL("../../fake-agents/codex-cli.mjs", import.meta.url),
);
const claudeCli = fileURLToPath(
  new URL("../../fake-agents/claude-cli.mjs", import.meta.url),
);
const config: AgentConfig = {
  command: "configured-provider",
  timeoutMs: 1_000,
  maxOutputBytes: 4_096,
  models: {
    selections: [
      {
        class: "opus",
        cliModelId: "claude-opus",
        acceptedObservedModels: {
          exactIds: [],
          literalPrefixes: ["claude-opus-"],
        },
      },
      {
        class: "opus-effort",
        cliModelId: "claude-opus-effort",
        requestedEffort: "high",
        acceptedObservedModels: {
          exactIds: [],
          literalPrefixes: ["claude-opus-"],
        },
      },
    ],
  },
};

function fixtureRunner(script: string, calls: ProcessRequest[]) {
  return (request: ProcessRequest) => {
    calls.push(request);
    return runProcess({
      ...request,
      command: process.execPath,
      args: [script, ...request.args],
    });
  };
}
function request(
  prompt: string,
  maxOutputBytes = 4_096,
  responseSchema: AgentRequest["responseSchema"] = InitialPhaseResponseSchema,
) {
  return {
    runId: "run-1",
    projectRoot: process.cwd(),
    mode: "observe" as const,
    prompt,
    timeoutMs: 500,
    maxOutputBytes,
    responseSchema,
  };
}

describe("hardened adapter lifecycle with fake Node providers", () => {
  test("Codex uses a real bounded process with private schema transport and inert stdin", async () => {
    const calls: ProcessRequest[] = [];
    const adapter = new CodexAdapter(config, {
      runProcess: fixtureRunner(codexCli, calls),
      captureGitIntegrity: () => Promise.resolve(snapshot),
    });
    const result = await adapter.run(
      request("inert $(value)"),
      new AbortController().signal,
    );
    const invoke = calls.at(-1);
    const path = invoke?.args[invoke.args.indexOf("--output-schema") + 1];
    expect(result).toMatchObject({
      status: "completed",
      structured: { phase: "initial" },
    });
    expect(invoke?.stdin).toBe("inert $(value)");
    expect(invoke?.args).toEqual(
      expect.arrayContaining([
        "exec",
        "--ephemeral",
        "--ignore-user-config",
        "--ignore-rules",
        "--json",
        "--sandbox",
        "read-only",
        "-C",
        process.cwd(),
        "--output-schema",
      ]),
    );
    await expect(access(path ?? "")).rejects.toThrow();
  });

  test("Claude uses real bounded process with exact isolation settings and inline schema", async () => {
    const calls: ProcessRequest[] = [];
    const adapter = new ClaudeAdapter(config, {
      runProcess: fixtureRunner(claudeCli, calls),
      captureGitIntegrity: () => Promise.resolve(snapshot),
    });
    const result = await adapter.run(
      request("review"),
      new AbortController().signal,
    );
    const invoke = calls.at(-1);
    const settings = invoke?.args.indexOf("--settings") ?? -1;
    const schema = invoke?.args.indexOf("--json-schema") ?? -1;
    expect(result).toMatchObject({
      status: "completed",
      modelExecution: { observedModelIds: ["claude-opus-4-20250514"] },
    });
    expect(invoke?.args[settings + 1]).toBe(CLAUDE_SETTINGS);
    expect(invoke?.args).toEqual(
      expect.arrayContaining([
        "--bare",
        "--tools",
        "Read,Glob,Grep",
        "--disallowedTools",
        "mcp__*",
        "--permission-mode",
        "plan",
        "--no-session-persistence",
        "-p",
        "--output-format",
        "json",
      ]),
    );
    expect(invoke?.args[schema + 1]).toContain('"phase"');
    expect(invoke?.args).not.toEqual(
      expect.arrayContaining(["Bash", "Edit", "Write", "Notebook"]),
    );
  });

  test.each([
    ["Codex", codexCli, CodexAdapter],
    ["Claude", claudeCli, ClaudeAdapter],
  ] as const)(
    "%s maps real output limit and cancellation",
    async (_name, script, Adapter) => {
      const calls: ProcessRequest[] = [];
      const adapter = new Adapter(config, {
        runProcess: fixtureRunner(script, calls),
        captureGitIntegrity: () => Promise.resolve(snapshot),
      });
      await expect(
        adapter.run(request("OVERSIZE", 128), new AbortController().signal),
      ).resolves.toMatchObject({ status: "failed" });
      const controller = new AbortController();
      const running = adapter.run(request("HANG"), controller.signal);
      setTimeout(() => {
        controller.abort();
      }, 50);
      await expect(running).resolves.toMatchObject({ status: "cancelled" });
    },
  );

  test.each([
    ["initial", InitialPhaseResponseSchema],
    ["cross-examination", CrossExaminationPhaseResponseSchema],
    ["final", FinalPhaseResponseSchema],
  ] as const)(
    "both real providers validate the transported %s schema",
    async (phase, responseSchema) => {
      for (const [Adapter, script] of [
        [CodexAdapter, codexCli],
        [ClaudeAdapter, claudeCli],
      ] as const) {
        const adapter = new Adapter(config, {
          runProcess: fixtureRunner(script, []),
          captureGitIntegrity: () => Promise.resolve(snapshot),
        });
        await expect(
          adapter.run(
            request("phase", 4_096, responseSchema),
            new AbortController().signal,
          ),
        ).resolves.toMatchObject({
          status: "completed",
          structured: { phase },
        });
      }
    },
  );

  test("real provider calls pass selected model and effort as inert direct arguments", async () => {
    const codexCalls: ProcessRequest[] = [];
    const claudeCalls: ProcessRequest[] = [];
    const withoutEffort = { class: "opus", cliModelId: "claude-opus" };
    const withEffort = {
      class: "opus-effort",
      cliModelId: "claude-opus-effort",
      requestedEffort: "high",
    };
    await new CodexAdapter(config, {
      runProcess: fixtureRunner(codexCli, codexCalls),
      captureGitIntegrity: () => Promise.resolve(snapshot),
    }).run(
      { ...request("model"), modelSelection: withEffort },
      new AbortController().signal,
    );
    await new ClaudeAdapter(config, {
      runProcess: fixtureRunner(claudeCli, claudeCalls),
      captureGitIntegrity: () => Promise.resolve(snapshot),
    }).run(
      { ...request("model"), modelSelection: withoutEffort },
      new AbortController().signal,
    );
    expect(codexCalls.at(-1)?.args).toEqual(
      expect.arrayContaining([
        "--model",
        "claude-opus-effort",
        "--config",
        'model_reasoning_effort="high"',
      ]),
    );
    expect(claudeCalls.at(-1)?.args).toEqual(
      expect.arrayContaining(["--model", "claude-opus"]),
    );
    expect(claudeCalls.at(-1)?.args).not.toContain("--effort");
  });

  test("Claude retains observation and integrity rejection diagnostics after real execution", async () => {
    const selected = {
      ...request("NO_OBSERVATION"),
      modelSelection: { class: "opus", cliModelId: "claude-opus" },
    };
    const missing = new ClaudeAdapter(config, {
      runProcess: fixtureRunner(claudeCli, []),
      captureGitIntegrity: () => Promise.resolve(snapshot),
    });
    const missingResult = await missing.run(
      selected,
      new AbortController().signal,
    );
    expect(missingResult.status).toBe("failed");
    expect(missingResult.diagnostics).toContain(
      "MODEL_OBSERVATION_UNAVAILABLE",
    );
    const cross = new ClaudeAdapter(config, {
      runProcess: fixtureRunner(claudeCli, []),
      captureGitIntegrity: () => Promise.resolve(snapshot),
    });
    const crossResult = await cross.run(
      { ...selected, prompt: "CROSS_CLASS" },
      new AbortController().signal,
    );
    expect(crossResult.status).toBe("failed");
    expect(crossResult.diagnostics).toContain("MODEL_CLASS_CHANGED");
    let calls = 0;
    const changed = new ClaudeAdapter(config, {
      runProcess: fixtureRunner(claudeCli, []),
      captureGitIntegrity: () =>
        Promise.resolve(
          calls++ === 0 ? snapshot : { ...snapshot, porcelainV2: "changed" },
        ),
    });
    const changedResult = await changed.run(
      { ...selected, prompt: "review" },
      new AbortController().signal,
    );
    expect(changedResult.status).toBe("failed");
    expect(changedResult.diagnostics).toContain("PROJECT_INTEGRITY_CHANGED");
  });
});
