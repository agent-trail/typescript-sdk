import type { AdapterSourceHealth } from "../index.js";
import { opencodeDataDir, opencodeDbPath, opencodeStorageDir } from "./paths.js";
import { dirExists, discoveredSummaries, pathExists } from "./storage/index.js";

export async function inspectSourceHealth(
  env: NodeJS.ProcessEnv = process.env,
): Promise<AdapterSourceHealth> {
  const dataDir = opencodeDataDir(env);
  const storageDir = opencodeStorageDir(env);
  const dbPath = opencodeDbPath(env);
  const storagePresent = await dirExists(storageDir);
  const dbPresent = await pathExists(dbPath);
  const present = storagePresent || dbPresent;
  const summaries = present ? await discoveredSummaries({ allCwds: true }, { env }) : [];
  const sessionCount = summaries.length;
  const versions = new Set(
    summaries
      .map((session) => session.version)
      .filter((version): version is string => version !== undefined),
  );
  const [sourceVersion] = versions;
  return {
    adapter: "opencode",
    path: dataDir ?? dbPath ?? null,
    present,
    readable: present,
    sessionCount,
    sourceVersion: versions.size === 1 ? (sourceVersion ?? null) : null,
    warnings: [],
  };
}
