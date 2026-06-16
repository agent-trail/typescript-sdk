import type { AdapterSourceHealth } from "../index.js";
import { inspectLocalJsonlSourceHealth } from "../shared/local-jsonl.js";
import { detectCodexSessions, newestCodexSourceVersion } from "./discovery.js";
import { type CodexPathOptions, codexSessionsDir } from "./paths.js";

export async function inspectSourceHealth(
  pathOptions: NodeJS.ProcessEnv | CodexPathOptions = process.env,
): Promise<AdapterSourceHealth> {
  const root = codexSessionsDir(pathOptions);
  return inspectLocalJsonlSourceHealth({
    adapter: "codex",
    root: root ?? null,
    scan: () => detectCodexSessions({ allCwds: true }, pathOptions),
    sourceVersion: () => newestCodexSourceVersion(pathOptions),
  });
}
