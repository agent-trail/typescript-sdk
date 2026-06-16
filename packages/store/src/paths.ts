import { join } from "node:path";
import { envValue, userDataDir } from "./platform-paths.js";

const STORE_APP_NAME = "trail";
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Options for resolving the local Agent Trail store root.
 *
 * @public
 */
export type StoreRootOptions = {
  /** Explicit store root for this call. */
  storeRoot?: string | undefined;
  /** Environment used to resolve env overrides and platform defaults. */
  env?: NodeJS.ProcessEnv | undefined;
  /** Platform used for default path selection. Defaults to `process.platform`. */
  platform?: NodeJS.Platform | undefined;
};

/**
 * Resolve the local Agent Trail store root for a call.
 *
 * @public
 */
export function resolveStoreRoot(override?: string): string;
/**
 * Resolve the local Agent Trail store root for a call.
 *
 * @public
 */
export function resolveStoreRoot(options?: StoreRootOptions): string;
export function resolveStoreRoot(input?: string | StoreRootOptions): string {
  if (typeof input === "string") {
    if (input !== "") return input;
  } else if (input?.storeRoot !== undefined && input.storeRoot !== "") {
    return input.storeRoot;
  }

  const env =
    typeof input === "object" && input !== null ? (input.env ?? process.env) : process.env;
  const platform =
    typeof input === "object" && input !== null
      ? (input.platform ?? process.platform)
      : process.platform;
  const envOverride = envValue(env, "AGENT_TRAIL_HOME");
  if (envOverride !== undefined) {
    return envOverride;
  }
  const defaultRoot = userDataDir(STORE_APP_NAME, env, platform);
  if (defaultRoot === undefined) {
    throw new Error(
      "Cannot resolve store root: pass opts.storeRoot, set AGENT_TRAIL_HOME, or configure a home/data directory.",
    );
  }
  return defaultRoot;
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
