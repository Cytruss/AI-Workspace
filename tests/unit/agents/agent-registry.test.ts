import { describe, expect, test, vi } from "vitest";
import type {
  AgentAdapter,
  AgentCapabilities,
} from "../../../src/agents/types.js";
import {
  AgentBoundaryError,
  AgentRegistry,
  normalizeModelExecution,
  resolveModelSelection,
  validateModelCapabilities,
} from "../../../src/agents/agent-registry.js";
import { ModelExecutionSchema } from "../../../src/agents/structured-response.js";

const capabilities = (
  overrides: Partial<AgentCapabilities> = {},
): AgentCapabilities => ({
  available: true,
  nonInteractive: true,
  structuredOutput: true,
  readOnlyEnforcement: true,
  modelOption: { supported: true, flag: "--model" },
  effortOption: { supported: true, flag: "--effort", allowedValues: ["high"] },
  observedModelReporting: { supported: false },
  diagnostics: [],
  ...overrides,
});

const adapter = (id: string, available = true): AgentAdapter => ({
  id,
  probe: vi.fn().mockResolvedValue(capabilities({ available })),
  run: vi.fn(),
});

describe("AgentRegistry", () => {
  test("looks up adapters and selects both in stable built-in order", async () => {
    const claude = adapter("claude");
    const codex = adapter("codex");
    const registry = new AgentRegistry([claude, codex]);
    expect(registry.get("codex")).toBe(codex);
    expect(registry.select("both")).toEqual([codex, claude]);
    const probes = await registry.probeAll();
    expect(probes.claude?.available).toBe(true);
    expect(probes.codex?.available).toBe(true);
  });

  test("rejects duplicate and unavailable adapter lookups", () => {
    const codex = adapter("codex");
    expect(() => new AgentRegistry([codex, codex])).toThrow(
      "Duplicate agent adapter: codex",
    );
    expect(() => new AgentRegistry([]).get("claude")).toThrow(
      "Agent adapter unavailable: claude",
    );
  });
});

describe("model selection boundary", () => {
  const models = {
    defaultModel: "sol",
    selections: [
      {
        class: "sol",
        cliModelId: "gpt-sol",
        requestedEffort: "high",
        acceptedObservedModels: { exactIds: ["gpt-sol"], literalPrefixes: [] },
      },
      {
        class: "terra",
        cliModelId: "provider:id;still-one-value",
        acceptedObservedModels: {
          exactIds: [],
          literalPrefixes: ["gpt-terra-"],
        },
      },
    ],
  } as const;

  test("resolves provider default omission, configured default, and explicit classes", () => {
    expect(
      resolveModelSelection({ selections: [] }, undefined),
    ).toBeUndefined();
    expect(resolveModelSelection(models, undefined)).toEqual({
      class: "sol",
      cliModelId: "gpt-sol",
      requestedEffort: "high",
    });
    expect(resolveModelSelection(models, "terra")).toEqual({
      class: "terra",
      cliModelId: "provider:id;still-one-value",
    });
    expect(Object.isFrozen(resolveModelSelection(models, "terra"))).toBe(true);
  });

  test("rejects an unknown class before downstream argument or process work", () => {
    const argumentBuilder = vi.fn();
    const spawn = vi.fn();
    expect(() => {
      const selection = resolveModelSelection(models, "deep");
      argumentBuilder(selection);
      spawn();
    }).toThrow(expect.objectContaining({ code: "AGENT_MODEL_UNSUPPORTED" }));
    expect(argumentBuilder).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  test("fails closed for unknown or disallowed requested effort", () => {
    const selection = resolveModelSelection(models, "sol");
    expect(() => {
      validateModelCapabilities(
        capabilities({ effortOption: { supported: true, flag: "--effort" } }),
        selection,
      );
    }).toThrow(expect.objectContaining({ code: "AGENT_EFFORT_UNSUPPORTED" }));
    expect(() => {
      validateModelCapabilities(
        capabilities({
          effortOption: {
            supported: true,
            flag: "--effort",
            allowedValues: ["low"],
          },
        }),
        selection,
      );
    }).toThrow(expect.objectContaining({ code: "AGENT_EFFORT_UNSUPPORTED" }));
    expect(() => {
      validateModelCapabilities(capabilities(), selection);
    }).not.toThrow();
  });

  test("fails closed for an unbounded or ambiguous effort-value contract", () => {
    const selection = resolveModelSelection(models, "sol");
    for (const allowedValues of [
      ["high", "high"],
      ["high", ""],
      ["high", "x".repeat(33)],
      ["high", ...Array.from({ length: 25 }, (_, index) => String(index))],
    ]) {
      expect(() => {
        validateModelCapabilities(
          capabilities({
            effortOption: { supported: true, flag: "--effort", allowedValues },
          }),
          selection,
        );
      }).toThrow(expect.objectContaining({ code: "AGENT_EFFORT_UNSUPPORTED" }));
    }
  });

  test("allows omitted effort with unknown values but requires model support", () => {
    const selection = resolveModelSelection(models, "terra");
    expect(() => {
      validateModelCapabilities(
        capabilities({ effortOption: { supported: false } }),
        selection,
      );
    }).not.toThrow();
    expect(() => {
      validateModelCapabilities(
        capabilities({ modelOption: { supported: false } }),
        selection,
      );
    }).toThrow(expect.objectContaining({ code: "AGENT_MODEL_UNSUPPORTED" }));
  });

  test("normalizes bounded observations without inventing observed effort", () => {
    const execution = normalizeModelExecution(
      resolveModelSelection(models, "sol"),
      [" model-z ", "model-a", "model-z"],
      "verified",
    );
    expect(execution).toEqual({
      requestedClass: "sol",
      requestedCliModelId: "gpt-sol",
      requestedEffort: "high",
      observedModelIds: ["model-a", "model-z"],
      verification: "verified",
    });
    expect(execution).not.toHaveProperty("observedEffort");
    expect(ModelExecutionSchema.parse(execution)).toEqual(execution);
    expect(() =>
      normalizeModelExecution(
        undefined,
        Array.from({ length: 26 }, (_, index) => `m${String(index)}`),
        "unverified",
      ),
    ).toThrow(
      expect.objectContaining({ code: "AGENT_MODEL_OBSERVATIONS_INVALID" }),
    );
    expect(() =>
      normalizeModelExecution(undefined, ["provider-default"], "verified"),
    ).toThrow(
      expect.objectContaining({ code: "AGENT_MODEL_OBSERVATIONS_INVALID" }),
    );
    expect(AgentBoundaryError).toBeTypeOf("function");
  });
});
