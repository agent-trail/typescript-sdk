import { join } from "node:path";

export function opencodeDataDir(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.OPENCODE_DATA_DIR !== undefined && env.OPENCODE_DATA_DIR.length > 0) {
    return env.OPENCODE_DATA_DIR;
  }
  const xdgDataHome = env.XDG_DATA_HOME;
  if (xdgDataHome !== undefined && xdgDataHome.length > 0) {
    return join(xdgDataHome, "opencode");
  }
  const home = env.HOME ?? env.USERPROFILE;
  if (home === undefined || home.length === 0) return undefined;
  return join(home, ".local", "share", "opencode");
}

export function opencodeDbPath(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.OPENCODE_DB !== undefined && env.OPENCODE_DB.length > 0) {
    return env.OPENCODE_DB;
  }
  const dir = opencodeDataDir(env);
  return dir === undefined ? undefined : join(dir, "opencode.db");
}

export function opencodeStorageDir(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const dir = opencodeDataDir(env);
  return dir === undefined ? undefined : join(dir, "storage");
}
