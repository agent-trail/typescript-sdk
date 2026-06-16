import { join } from "node:path";
import { envValue, type PathPlatform, userDataDir } from "../shared/platform-paths.js";

export function opencodeDataDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: PathPlatform = process.platform,
): string | undefined {
  const override = envValue(env, "OPENCODE_DATA_DIR");
  if (override !== undefined) {
    return override;
  }
  return userDataDir("opencode", env, platform);
}

export function opencodeDbPath(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const override = envValue(env, "OPENCODE_DB");
  if (override !== undefined) {
    return override;
  }
  const dir = opencodeDataDir(env);
  return dir === undefined ? undefined : join(dir, "opencode.db");
}

export function opencodeStorageDir(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const dir = opencodeDataDir(env);
  return dir === undefined ? undefined : join(dir, "storage");
}
