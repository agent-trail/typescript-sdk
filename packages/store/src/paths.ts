import { join } from "node:path";

const DEFAULT_RELATIVE = ".local/share/trail";
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Resolve the local Agent Trail store root for a call.
 *
 * @public
 */
export function resolveStoreRoot(override?: string): string {
  if (override !== undefined && override !== "") {
    return override;
  }
  const envOverride = process.env.AGENT_TRAIL_HOME;
  if (envOverride !== undefined && envOverride !== "") {
    return envOverride;
  }
  const home = process.env.HOME;
  if (home === undefined || home === "") {
    throw new Error(
      "Cannot resolve store root: pass opts.storeRoot, set AGENT_TRAIL_HOME, or set HOME.",
    );
  }
  return join(home, DEFAULT_RELATIVE);
}

/**
 * @internal
 */
export function objectsDir(storeRoot: string): string {
  return join(storeRoot, "objects", "sha256");
}

/**
 * Return the content-addressed object path for a SHA-256 trail hash.
 *
 * @public
 */
export function objectPath(storeRoot: string, contentHash: string): string {
  if (!SHA256_HEX_PATTERN.test(contentHash)) {
    throw new Error(`Invalid trail object content hash: ${contentHash}`);
  }
  return join(objectsDir(storeRoot), `${contentHash}.trail.jsonl`);
}
