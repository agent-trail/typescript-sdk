import path from "node:path";

export type PathPlatform = NodeJS.Platform;

export function joinPlatform(platform: PathPlatform, ...parts: string[]): string {
  return platform === "win32" ? path.win32.join(...parts) : path.posix.join(...parts);
}

export function envValue(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key];
  return value === undefined || value.length === 0 ? undefined : value;
}

export function homeDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: PathPlatform = process.platform,
): string | undefined {
  const home = envValue(env, "HOME") ?? envValue(env, "USERPROFILE");
  if (home !== undefined) return home;
  if (platform !== "win32") return undefined;
  const drive = envValue(env, "HOMEDRIVE");
  const pathPart = envValue(env, "HOMEPATH");
  return drive !== undefined && pathPart !== undefined ? `${drive}${pathPart}` : undefined;
}

export function userDataDir(
  appName: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: PathPlatform = process.platform,
): string | undefined {
  if (platform === "win32") {
    const localAppData = envValue(env, "LOCALAPPDATA");
    if (localAppData !== undefined) return joinPlatform(platform, localAppData, appName);
    const appData = envValue(env, "APPDATA");
    if (appData !== undefined) return joinPlatform(platform, appData, appName);
    const home = homeDir(env, platform);
    return home === undefined
      ? undefined
      : joinPlatform(platform, home, "AppData", "Local", appName);
  }

  const xdgDataHome = envValue(env, "XDG_DATA_HOME");
  if (xdgDataHome !== undefined) return joinPlatform(platform, xdgDataHome, appName);
  const home = homeDir(env, platform);
  return home === undefined ? undefined : joinPlatform(platform, home, ".local", "share", appName);
}
