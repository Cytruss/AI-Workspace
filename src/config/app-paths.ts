import { posix, win32 } from "node:path";

export interface AppPaths {
  dataDir: string;
  configFile: string;
  databaseFile: string;
  logDir: string;
  artifactDir: string;
}

function requiredEnvironmentPath(
  env: NodeJS.ProcessEnv,
  name: "APPDATA" | "HOME",
): string {
  const value = env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required to resolve application paths`);
  }
  return value;
}

export function getAppPaths(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): AppPaths {
  const pathApi = platform === "win32" ? win32 : posix;
  let baseDirectory: string;

  if (platform === "win32") {
    baseDirectory = requiredEnvironmentPath(env, "APPDATA");
  } else if (platform === "darwin") {
    baseDirectory = posix.join(
      requiredEnvironmentPath(env, "HOME"),
      "Library",
      "Application Support",
    );
  } else if (platform === "linux") {
    baseDirectory =
      env.XDG_DATA_HOME ||
      posix.join(requiredEnvironmentPath(env, "HOME"), ".local", "share");
  } else {
    throw new Error(`Unsupported platform: ${platform}`);
  }

  const dataDir = pathApi.join(baseDirectory, "ai-workspace");
  return {
    dataDir,
    configFile: pathApi.join(dataDir, "config.json"),
    databaseFile: pathApi.join(dataDir, "ai-workspace.sqlite"),
    logDir: pathApi.join(dataDir, "logs"),
    artifactDir: pathApi.join(dataDir, "artifacts"),
  };
}
