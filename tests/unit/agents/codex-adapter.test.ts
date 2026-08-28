import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  CodexAdapter,
  buildCodexArguments,
  parseCodexJsonl,
} from "../../../src/agents/codex-adapter.js";

const fixture = fileURLToPath(
  new URL("../../fixtures/agent-output/codex-success.json", import.meta.url),
);

describe("Codex adapter arguments and JSONL parser", () => {
  test.each([
    [
      "provider default",
      undefined,
      [
        "exec",
        "--ephemeral",
        "--ignore-user-config",
        "--ignore-rules",
        "--json",
        "--sandbox",
        "read-only",
        "--config",
        'approval_policy="never"',
        "-C",
        "C:/project",
        "--output-schema",
        "C:/private/schema.json",
        "-",
      ],
    ],
    [
      "explicit model",
      { class: "sol", cliModelId: "gpt-sol" },
      [
        "exec",
        "--ephemeral",
        "--ignore-user-config",
        "--ignore-rules",
        "--json",
        "--sandbox",
        "read-only",
        "--config",
        'approval_policy="never"',
        "-C",
        "C:/project",
        "--output-schema",
        "C:/private/schema.json",
        "--model",
        "gpt-sol",
        "-",
      ],
    ],
    [
      "explicit model with effort",
      { class: "sol", cliModelId: "gpt;$(inert)", requestedEffort: "high" },
      [
        "exec",
        "--ephemeral",
        "--ignore-user-config",
        "--ignore-rules",
        "--json",
        "--sandbox",
        "read-only",
        "--config",
        'approval_policy="never"',
        "-C",
        "C:/project",
        "--output-schema",
        "C:/private/schema.json",
        "--model",
        "gpt;$(inert)",
        "--config",
        'model_reasoning_effort="high"',
        "-",
      ],
    ],
  ])("builds exact hardened arguments for %s", (_name, selection, expected) => {
    expect(
      buildCodexArguments({
        projectRoot: "C:/project",
        schemaPath: "C:/private/schema.json",
        modelSelection: selection,
      }),
    ).toEqual(expected);
  });

  test("extracts the completed structured JSON response from JSONL", async () => {
    const output = await readFile(fixture, "utf8");
    expect(parseCodexJsonl(output)).toEqual({
      phase: "initial",
      claims: [],
      evidence: [],
    });
  });

  test.each([
    [
      "missing turn completion",
      '{"type":"item.completed","item":{"type":"agent_message","text":"{}"}}',
    ],
    [
      "non-agent item",
      '{"type":"item.completed","item":{"type":"tool_call","text":"{}"}}\n{"type":"turn.completed"}',
    ],
  ])("rejects JSONL with %s", (_name, output) => {
    expect(() => parseCodexJsonl(output)).toThrow();
  });

  test("rejects turn completion that precedes the agent message", () => {
    expect(() =>
      parseCodexJsonl(
        '{"type":"turn.completed"}\n{"type":"item.completed","item":{"type":"agent_message","text":"{}"}}',
      ),
    ).toThrow();
  });

  test("rejects an agent message after turn completion", () => {
    const event = (selected: string) =>
      JSON.stringify({
        type: "item.completed",
        item: { type: "agent_message", text: JSON.stringify({ selected }) },
      });
    expect(() =>
      parseCodexJsonl(
        [event("A"), '{"type":"turn.completed"}', event("B")].join("\n"),
      ),
    ).toThrow();
  });

  test("rejects an unconfigured structural selection before probing", async () => {
    let calls = 0;
    const adapter = new CodexAdapter(
      {
        command: "codex",
        models: { selections: [] },
        timeoutMs: 1_000,
        maxOutputBytes: 1_024,
      },
      {
        runProcess: () => {
          calls += 1;
          return Promise.resolve({
            exitCode: 0,
            signal: null,
            stdout: "",
            stderr: "",
            durationMs: 1,
            termination: "exit",
          });
        },
      },
    );
    await expect(
      adapter.run(
        {
          runId: "r",
          projectRoot: process.cwd(),
          mode: "observe",
          prompt: "x",
          timeoutMs: 100,
          maxOutputBytes: 1_024,
          modelSelection: { class: "unknown", cliModelId: "opaque" },
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "AGENT_MODEL_UNSUPPORTED" });
    expect(calls).toBe(0);
  });

  test("rejects a patch-only version below the compatibility floor", async () => {
    const outputs = [
      "0.75.999",
      "--ephemeral --ignore-user-config --ignore-rules --json --output-schema --model --config -C",
    ];
    const adapter = new CodexAdapter(
      {
        command: "codex",
        models: { selections: [] },
        timeoutMs: 1_000,
        maxOutputBytes: 1_024,
      },
      {
        runProcess: () =>
          Promise.resolve({
            exitCode: 0,
            signal: null,
            stdout: outputs.shift() ?? "",
            stderr: "",
            durationMs: 1,
            termination: "exit",
          }),
      },
    );
    await expect(adapter.probe()).resolves.toMatchObject({ available: false });
  });

  test("fails closed when the required hardening flags are absent", async () => {
    const adapter = new CodexAdapter(
      {
        command: "codex",
        models: { selections: [] },
        timeoutMs: 1_000,
        maxOutputBytes: 1_024,
      },
      {
        runProcess: () =>
          Promise.resolve({
            exitCode: 0,
            signal: null,
            stdout: "0.76.0",
            stderr: "",
            durationMs: 1,
            termination: "exit",
          }),
      },
    );
    await expect(adapter.probe()).resolves.toMatchObject({
      available: false,
      diagnostics: [expect.stringContaining("Missing required")],
    });
  });
});
