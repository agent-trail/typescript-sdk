import path from "node:path";

export type PathPlatform = NodeJS.Platform;

export function envValue(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key];
  return value === undefined || value.length === 0 ? undefined : value;
}

export function userDataDir(
  appName: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: PathPlatform = process.platform,
): string | undefined {
  const join = platform === "win32" ? path.win32.join : path.posix.join;
  const drive = envValue(env, "HOMEDRIVE");
  const homePath = envValue(env, "HOMEPATH");
  const home =
    envValue(env, "HOME") ??
    envValue(env, "USERPROFILE") ??
    (platform === "win32" && drive !== undefined && homePath !== undefined
      ? `${drive}${homePath}`
      : undefined);

  if (platform === "win32") {
    const localAppData = envValue(env, "LOCALAPPDATA");
    if (localAppData !== undefined) return join(localAppData, appName);
    const appData = envValue(env, "APPDATA");
    if (appData !== undefined) return join(appData, appName);
    return home === undefined ? undefined : join(home, "AppData", "Local", appName);
  }

  const xdgDataHome = envValue(env, "XDG_DATA_HOME");
  if (xdgDataHome !== undefined) return join(xdgDataHome, appName);
  return home === undefined ? undefined : join(home, ".local", "share", appName);
}
