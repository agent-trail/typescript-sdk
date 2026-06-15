import type { AdapterSourceHealth } from "../index.js";
import { inspectLocalJsonlSourceHealth } from "../shared/local-jsonl.js";
import { detectCodexSessions, newestCodexSourceVersion } from "./discovery.js";
import { codexSessionsDir } from "./paths.js";

export async function inspectSourceHealth(
  env: NodeJS.ProcessEnv = process.env,
): Promise<AdapterSourceHealth> {
  const root = codexSessionsDir(env);
  return inspectLocalJsonlSourceHealth({
    adapter: "codex",
    root: root ?? null,
    scan: () => detectCodexSessions({ allCwds: true }, env),
    sourceVersion: () => newestCodexSourceVersion(env),
  });
}
