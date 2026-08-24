export class AgentCapabilityError extends Error {
  readonly code = "AGENT_CAPABILITY_UNSUPPORTED";

  constructor(missing: readonly string[]) {
    const first = missing[0] ?? "unknown";
    super(
      missing.length === 1
        ? `Missing required CLI capability: ${first}`
        : `Missing required CLI capabilities: ${missing.join(", ")}`,
    );
    this.name = "AgentCapabilityError";
  }
}

export function requireHelpFlags(help: string, flags: readonly string[]): void {
  const missing = flags.filter((flag) => {
    const escaped = flag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return !new RegExp(`(?:^|[^-A-Za-z0-9_])${escaped}(?![-A-Za-z0-9_])`).test(
      help,
    );
  });
  if (missing.length > 0) throw new AgentCapabilityError(missing);
}
