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
  const tokens = new Set(help.match(/-{1,2}[A-Za-z0-9][A-Za-z0-9-]*/g) ?? []);
  const missing = flags.filter((flag) => !tokens.has(flag));
  if (missing.length > 0) throw new AgentCapabilityError(missing);
}
