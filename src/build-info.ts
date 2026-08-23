export function getBuildInfo() {
  return {
    name: "ai-workspace" as const,
    version: "0.1.0",
    node: process.version,
  };
}
