const RUNTIME_NAMES = [
  "PATH",
  "PATHEXT",
  "SystemRoot",
  "ComSpec",
  "HOME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "TMP",
  "TEMP",
  "TMPDIR",
  "LANG",
  "LC_ALL",
] as const;

export function buildSafeEnvironment(
  source: NodeJS.ProcessEnv,
  extraAllowedNames: readonly string[],
): NodeJS.ProcessEnv {
  const normalize =
    process.platform === "win32"
      ? (name: string): string => name.toUpperCase()
      : (name: string): string => name;
  const allowed = new Set(
    [...RUNTIME_NAMES, ...extraAllowedNames].map(normalize),
  );
  const forbidden = normalize("AI_WORKSPACE_DISCORD_TOKEN");
  const result: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(source)) {
    const normalizedName = normalize(name);
    if (
      value !== undefined &&
      normalizedName !== forbidden &&
      allowed.has(normalizedName)
    ) {
      result[process.platform === "win32" ? normalizedName : name] = value;
    }
  }
  return result;
}
