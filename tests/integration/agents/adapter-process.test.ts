import { describe, expect, test } from "vitest";
import { ClaudeAdapter } from "../../../src/agents/claude-adapter.js";
import { CodexAdapter } from "../../../src/agents/codex-adapter.js";
import { InitialPhaseResponseSchema } from "../../../src/agents/structured-response.js";
import type { ProcessRequest } from "../../../src/platform/process-runner.js";
import type { AgentConfig } from "../../../src/config/schema.js";

const snapshot = { porcelainV2: "", dirtyPathFingerprints: "[]" };
const config: AgentConfig = {
  command: "fake-agent",
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
    ],
  },
};
const codexHelp =
  "--ephemeral --ignore-user-config --ignore-rules --json --output-schema --sandbox --model --config -C model_reasoning_effort=low|high";
const claudeHelp =
  "--bare --settings --tools --disallowedTools --permission-mode --no-session-persistence -p --output-format --json-schema --model --effort modelUsage --effort values: low|high";

describe("hardened adapter lifecycle", () => {
  test("Codex transports the schema by one temporary file and removes it after a bounded run", async () => {
    const calls: ProcessRequest[] = [];
    const adapter = new CodexAdapter(config, {
      runProcess: (request) => {
        calls.push(request);
        const stdout =
          request.args[0] === "--version"
            ? "0.76.0"
            : request.args.includes("--help")
              ? codexHelp
              : '{"item":{"text":"{\\"phase\\":\\"initial\\",\\"claims\\":[],\\"evidence\\":[]}"}}\n';
        return Promise.resolve({
          exitCode: 0,
          signal: null,
          stdout,
          stderr: "",
          durationMs: 1,
          termination: "exit",
        });
      },
      captureGitIntegrity: () => Promise.resolve(snapshot),
    });
    const result = await adapter.run(
      {
        runId: "run-1",
        projectRoot: process.cwd(),
        mode: "observe",
        prompt: "inert $(value)",
        timeoutMs: 500,
        maxOutputBytes: 512,
        responseSchema: InitialPhaseResponseSchema,
      },
      new AbortController().signal,
    );
    const invocation = calls.at(-1);
    expect(result).toMatchObject({
      status: "completed",
      modelExecution: { verification: "unverified" },
    });
    expect(invocation?.stdin).toBe("inert $(value)");
    expect(invocation?.args).toContain("--output-schema");
    expect(invocation?.args).not.toContain("--model");
  });

  test("Claude verifies a same-class observed alias and rejects managed cross-class fallback after execution", async () => {
    let runCount = 0;
    const adapter = new ClaudeAdapter(config, {
      runProcess: (request) => {
        if (request.args[0] === "--version")
          return Promise.resolve({
            exitCode: 0,
            signal: null,
            stdout: "2.1.233",
            stderr: "",
            durationMs: 1,
            termination: "exit",
          });
        if (request.args[0] === "--help")
          return Promise.resolve({
            exitCode: 0,
            signal: null,
            stdout: claudeHelp,
            stderr: "",
            durationMs: 1,
            termination: "exit",
          });
        runCount += 1;
        return Promise.resolve({
          exitCode: 0,
          signal: null,
          stdout: JSON.stringify({
            is_error: false,
            result: '{"phase":"initial","claims":[],"evidence":[]}',
            modelUsage: {
              [runCount === 1 ? "claude-opus-4-20250514" : "claude-sonnet-4"]: {
                input_tokens: 1,
                output_tokens: 1,
              },
            },
          }),
          stderr: "",
          durationMs: 1,
          termination: "exit",
        });
      },
      captureGitIntegrity: () => Promise.resolve(snapshot),
    });
    const request = {
      runId: "run-1",
      projectRoot: process.cwd(),
      mode: "observe" as const,
      prompt: "review",
      timeoutMs: 500,
      maxOutputBytes: 512,
      responseSchema: InitialPhaseResponseSchema,
      modelSelection: { class: "opus", cliModelId: "claude-opus" },
    };
    await expect(
      adapter.run(request, new AbortController().signal),
    ).resolves.toMatchObject({
      status: "completed",
      modelExecution: {
        verification: "verified",
        observedModelIds: ["claude-opus-4-20250514"],
      },
    });
    const rejected = await adapter.run(request, new AbortController().signal);
    expect(rejected.status).toBe("failed");
    expect(rejected.diagnostics).toContain("MODEL_CLASS_CHANGED");
    expect(rejected.modelExecution.observedModelIds).toEqual([
      "claude-sonnet-4",
    ]);
  });
});
