import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  CLAUDE_SETTINGS,
  ClaudeAdapter,
  buildClaudeArguments,
  buildClaudeReviewArguments,
  parseClaudeResult,
} from "../../../src/agents/claude-adapter.js";
import { SiteReviewAgentResponseSchema } from "../../../src/site-review/structured-response.js";

const fixture = fileURLToPath(
  new URL("../../fixtures/agent-output/claude-success.json", import.meta.url),
);

async function withClaudeCredential<T>(run: () => Promise<T>): Promise<T> {
  const sourceDirectory = await mkdtemp(join(tmpdir(), "claude-test-home-"));
  const previousDirectory = process.env.CLAUDE_CONFIG_DIR;
  await writeFile(
    join(sourceDirectory, ".credentials.json"),
    "credential",
    "utf8",
  );
  process.env.CLAUDE_CONFIG_DIR = sourceDirectory;
  try {
    return await run();
  } finally {
    if (previousDirectory === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = previousDirectory;
    await rm(sourceDirectory, { recursive: true, force: true });
  }
}

describe("Claude adapter arguments and JSON parser", () => {
  const schema = '{"type":"object","properties":{"phase":{"const":"initial"}}}';
  const safety = [
    "--safe-mode",
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

  test("builds a strict generated-MCP review invocation", () => {
    expect(
      buildClaudeReviewArguments({
        schema,
        mcpConfig: '{"mcpServers":{}}',
        allowedMcpTools: "mcp__review_browser__list_pages",
      }),
    ).toEqual([
      "--bare",
      "--strict-mcp-config",
      "--mcp-config",
      '{"mcpServers":{}}',
      "--tools",
      "",
      "--allowedTools",
      "mcp__review_browser__list_pages",
      "--permission-mode",
      "plan",
      "--no-session-persistence",
      "-p",
      "--output-format",
      "json",
      "--json-schema",
      schema,
    ]);
  });

  test("runs a website review with a strict generated MCP configuration", async () => {
    await withClaudeCredential(async () => {
      const calls: { args: string[]; env: NodeJS.ProcessEnv }[] = [];
      const adapter = new ClaudeAdapter(
        {
          command: "claude",
          models: { selections: [] },
          timeoutMs: 1_000,
          maxOutputBytes: 1_024,
        },
        {
          runProcess: (request) => {
            calls.push({ args: request.args, env: request.env });
            const stdout =
              calls.length === 1
                ? "2.1.233"
                : calls.length === 2
                  ? "--safe-mode --settings --tools --disallowedTools --permission-mode --no-session-persistence -p --output-format --json-schema --model --effort"
                  : '{"result":"{\\"phase\\":\\"site-review\\",\\"summary\\":\\"ok\\",\\"observations\\":[],\\"findings\\":[],\\"uncertainties\\":[],\\"recommendations\\":[]}","modelUsage":{}}';
            return Promise.resolve({
              exitCode: 0,
              signal: null,
              stdout,
              stderr: "",
              durationMs: 1,
              termination: "exit" as const,
            });
          },
        },
      );
      await expect(
        adapter.runReview(
          {
            workingDirectory: process.cwd(),
            prompt: "review",
            responseSchema: SiteReviewAgentResponseSchema,
            browser: {
              gateway: { command: "node", args: ["gateway.js"] },
              toolNames: ["list_pages"] as never,
            },
          },
          new AbortController().signal,
        ),
      ).resolves.toMatchObject({ status: "completed" });
      expect(calls[2]?.args).toContain("--strict-mcp-config");
      expect(calls[2]?.env.CLAUDE_CONFIG_DIR).toBeDefined();
    });
  });

  test("copies the Claude credential into the isolated review home", async () => {
    const sourceDirectory = await mkdtemp(
      join(tmpdir(), "claude-source-home-"),
    );
    const previousDirectory = process.env.CLAUDE_CONFIG_DIR;
    await writeFile(
      join(sourceDirectory, ".credentials.json"),
      "credential",
      "utf8",
    );
    process.env.CLAUDE_CONFIG_DIR = sourceDirectory;
    let copiedCredential: string | undefined;
    try {
      const calls: { args: string[]; env: NodeJS.ProcessEnv }[] = [];
      const adapter = new ClaudeAdapter(
        {
          command: "claude",
          models: { selections: [] },
          timeoutMs: 1_000,
          maxOutputBytes: 1_024,
        },
        {
          runProcess: async (request) => {
            calls.push({ args: request.args, env: request.env });
            if (calls.length === 3)
              copiedCredential = await readFile(
                join(
                  request.env.CLAUDE_CONFIG_DIR as string,
                  ".credentials.json",
                ),
                "utf8",
              );
            const stdout =
              calls.length === 1
                ? "2.1.233"
                : calls.length === 2
                  ? "--safe-mode --settings --tools --disallowedTools --permission-mode --no-session-persistence -p --output-format --json-schema --model --effort"
                  : '{"result":"{\\"phase\\":\\"site-review\\",\\"summary\\":\\"ok\\",\\"observations\\":[],\\"findings\\":[],\\"uncertainties\\":[],\\"recommendations\\":[]}","modelUsage":{}}';
            return {
              exitCode: 0,
              signal: null,
              stdout,
              stderr: "",
              durationMs: 1,
              termination: "exit" as const,
            };
          },
        },
      );
      await expect(
        adapter.runReview(
          {
            workingDirectory: process.cwd(),
            prompt: "review",
            responseSchema: SiteReviewAgentResponseSchema,
            browser: {
              gateway: { command: "node", args: ["gateway.js"] },
              toolNames: ["list_pages"] as never,
            },
          },
          new AbortController().signal,
        ),
      ).resolves.toMatchObject({ status: "completed" });
      expect(copiedCredential).toBe("credential");
    } finally {
      if (previousDirectory === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = previousDirectory;
      await rm(sourceDirectory, { recursive: true, force: true });
    }
  });

  test("reports unavailable Claude credentials without leaking their path", async () => {
    const sourceDirectory = await mkdtemp(join(tmpdir(), "claude-empty-home-"));
    const previousDirectory = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = sourceDirectory;
    try {
      const output = [
        "2.1.233",
        "--safe-mode --settings --tools --disallowedTools --permission-mode --no-session-persistence -p --output-format --json-schema --model --effort",
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
              stdout: output.shift() ?? "",
              stderr: "",
              durationMs: 1,
              termination: "exit" as const,
            }),
        },
      );
      await expect(
        adapter.runReview(
          {
            workingDirectory: process.cwd(),
            prompt: "review",
            responseSchema: SiteReviewAgentResponseSchema,
            browser: {
              gateway: { command: "node", args: ["gateway.js"] },
              toolNames: ["list_pages"] as never,
            },
          },
          new AbortController().signal,
        ),
      ).resolves.toEqual({
        status: "failed",
        diagnostics: ["REVIEW_AUTH_UNAVAILABLE"],
      });
    } finally {
      if (previousDirectory === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = previousDirectory;
      await rm(sourceDirectory, { recursive: true, force: true });
    }
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
      "--safe-mode --settings --tools --disallowedTools --permission-mode --no-session-persistence -p --output-format --json-schema --model --effort modelUsage",
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
        "  --safe-mode",
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
