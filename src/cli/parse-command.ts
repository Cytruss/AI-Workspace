export type CliCommand =
  { name: "setup" } | { name: "doctor" } | { name: "start" };

const usage = "Usage: ai-workspace <setup|doctor|start>";

export function parseCommand(argv: readonly string[]): CliCommand {
  if (argv.length !== 1) throw new Error(usage);
  const name = argv[0];
  if (name === "setup" || name === "doctor" || name === "start") {
    return { name };
  }
  throw new Error(usage);
}
