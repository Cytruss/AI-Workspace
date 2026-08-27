import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  CLAUDE_SETTINGS,
  ClaudeAdapter,
  buildClaudeArguments,
  parseClaudeResult,
} from "../../../src/agents/claude-adapter.js";

const fixture = fileURLToPath(
  new URL("../../fixtures/agent-output/claude-success.json", import.meta.url),
);

describe("Claude adapter arguments and JSON parser", () => {
  const schema = '{"type":"object","properties":{"phase":{"const":"initial"}}}';
  const safety = [
    "--bare",
    "--settings",
    CLAUDE_SETTINGS,
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
    "--json-schema",
    schema,
  ];

  test.each([
    ["provider default", undefined, safety],
    [
      "explicit model",
      { class: "opus", cliModelId: "claude-opus" },
      [...safety, "--model", "claude-opus"],
    ],
    [
      "explicit model with effort",
      { class: "opus", cliModelId: "claude;$(inert)", requestedEffort: "high" },
      [...safety, "--model", "claude;$(inert)", "--effort", "high"],
    ],
  ])("builds exact hardened arguments for %s", (_name, selection, expected) => {
    expect(buildClaudeArguments({ schema, modelSelection: selection })).toEqual(
      expected,
    );
  });

  test("extracts the successful result", async () => {
    const output = await readFile(fixture, "utf8");
    expect(parseClaudeResult(output)).toBe(
      '{"phase":"initial","claims":[],"evidence":[]}',
    );
  });

  test("rejects a classifier refusal", () => {
    expect(() =>
      parseClaudeResult(
        '{"is_error":false,"result":"analysis","subtype":"error_during_execution"}',
      ),
    ).toThrow();
  });

  test("fails closed when the required hardening flags are absent", async () => {
    const adapter = new ClaudeAdapter(
      {
        command: "claude",
        models: { selections: [] },
        timeoutMs: 1_000,
        maxOutputBytes: 1_024,
      },
      {
        runProcess: () =>
          Promise.resolve({
            exitCode: 0,
            signal: null,
            stdout: "2.1.233",
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

  test("rejects a patch-only version below the compatibility floor", async () => {
    const outputs = [
      "2.0.999",
      "--bare --settings --tools --disallowedTools --permission-mode --no-session-persistence -p --output-format --json-schema --model --effort modelUsage",
    ];
    const adapter = new ClaudeAdapter(
      {
        command: "claude",
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

  test("accepts help that documents flags but not the modelUsage response field", async () => {
    const outputs = [
      "2.1.233 (Claude Code)",
      [
        "Usage: claude [options] [command] [prompt]",
        "  --bare",
        "  --settings <json>",
        "  --tools <tools>",
        "  --disallowedTools <tools>",
        "  --permission-mode <mode>",
        "  --no-session-persistence",
        "  -p, --print",
        "  --output-format <format>",
        "  --json-schema <schema>",
        "  --model <model>",
        "  --effort <effort>",
      ].join("\n"),
    ];
    const adapter = new ClaudeAdapter(
      {
        command: "claude",
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

    await expect(adapter.probe()).resolves.toMatchObject({
      available: true,
      observedModelReporting: { supported: true, source: "modelUsage" },
    });
  });

  test("rejects an unconfigured structural selection before probing", async () => {
    let calls = 0;
    const adapter = new ClaudeAdapter(
      {
        command: "claude",
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
});
