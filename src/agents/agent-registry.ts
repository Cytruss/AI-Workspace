import type { ModelSelection } from "../config/schema.js";
import type {
  AgentAdapter,
  AgentCapabilities,
  AgentId,
  AgentSelection,
  ModelExecution,
  ResolvedModelSelection,
} from "./types.js";

interface ModelSettings {
  readonly defaultModel?: string | undefined;
  readonly selections: readonly Readonly<
    Pick<ModelSelection, "class" | "cliModelId" | "requestedEffort">
  >[];
}

export class AgentBoundaryError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AgentBoundaryError";
  }
}

export function resolveModelSelection(
  settings: ModelSettings,
  requestedClass: string | undefined,
): ResolvedModelSelection | undefined {
  const selectedClass = requestedClass ?? settings.defaultModel;
  if (selectedClass === undefined) return undefined;
  const configured = settings.selections.find(
    (selection) => selection.class === selectedClass,
  );
  if (configured === undefined) {
    throw new AgentBoundaryError(
      "AGENT_MODEL_UNSUPPORTED",
      `Unsupported agent model class: ${selectedClass}`,
    );
  }
  return Object.freeze({
    class: configured.class,
    cliModelId: configured.cliModelId,
    ...(configured.requestedEffort === undefined
      ? {}
      : { requestedEffort: configured.requestedEffort }),
  });
}

export function validateModelCapabilities(
  capabilities: AgentCapabilities,
  selection: ResolvedModelSelection | undefined,
): void {
  if (selection === undefined) return;
  if (!capabilities.modelOption.supported) {
    throw new AgentBoundaryError(
      "AGENT_MODEL_UNSUPPORTED",
      "The agent does not support an explicit model selection",
    );
  }
  if (selection.requestedEffort === undefined) return;
  const allowed = capabilities.effortOption.allowedValues;
  if (
    !capabilities.effortOption.supported ||
    allowed === undefined ||
    allowed.length > 25 ||
    new Set(allowed).size !== allowed.length ||
    allowed.some((value) => value.length === 0 || value.length > 32) ||
    !allowed.includes(selection.requestedEffort)
  ) {
    throw new AgentBoundaryError(
      "AGENT_EFFORT_UNSUPPORTED",
      `Unsupported agent effort: ${selection.requestedEffort}`,
    );
  }
}

export function normalizeModelExecution(
  selection: ResolvedModelSelection | undefined,
  observations: readonly string[],
  verification: ModelExecution["verification"],
): ModelExecution {
  if (selection === undefined && verification === "verified") {
    throw new AgentBoundaryError(
      "AGENT_MODEL_OBSERVATIONS_INVALID",
      "Provider-default model execution cannot be verified",
    );
  }
  const normalized = [
    ...new Set(observations.map((value) => value.trim())),
  ].sort();
  if (
    normalized.length > 25 ||
    normalized.some(
      (value) => value.length === 0 || Buffer.byteLength(value, "utf8") > 200,
    )
  ) {
    throw new AgentBoundaryError(
      "AGENT_MODEL_OBSERVATIONS_INVALID",
      "Agent model observations exceed the supported bounds",
    );
  }
  return Object.freeze({
    ...(selection === undefined
      ? {}
      : {
          requestedClass: selection.class,
          requestedCliModelId: selection.cliModelId,
          ...(selection.requestedEffort === undefined
            ? {}
            : { requestedEffort: selection.requestedEffort }),
        }),
    observedModelIds: Object.freeze(normalized),
    verification,
  });
}

export class AgentRegistry {
  private readonly adapters = new Map<AgentId, AgentAdapter>();

  constructor(adapters: readonly AgentAdapter[]) {
    for (const adapter of adapters) {
      if (this.adapters.has(adapter.id)) {
        throw new Error(`Duplicate agent adapter: ${adapter.id}`);
      }
      this.adapters.set(adapter.id, adapter);
    }
  }

  get(id: AgentId): AgentAdapter {
    const adapter = this.adapters.get(id);
    if (adapter === undefined) {
      throw new Error(`Agent adapter unavailable: ${id}`);
    }
    return adapter;
  }

  select(selection: AgentSelection): readonly AgentAdapter[] {
    if (selection === "both") {
      return Object.freeze([this.get("codex"), this.get("claude")]);
    }
    return Object.freeze([this.get(selection)]);
  }

  async probeAll(): Promise<Record<string, AgentCapabilities>> {
    const entries = await Promise.all(
      [...this.adapters.entries()]
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(async ([id, adapter]) => [id, await adapter.probe()] as const),
    );
    return Object.fromEntries(entries);
  }
}
