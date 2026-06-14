import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import lockfile from "proper-lockfile";
import { indexDir, indexFilePath } from "./paths.js";

const LOCK_ANCHOR = ".lockanchor";

const INDEX_VERSION = 1;
const CONTENT_HASH = /^[0-9a-f]{64}$/;

/**
 * @public
 */
export type IndexEntryKind = "session" | "trail";

/**
 * @public
 */
export type IndexEntry = {
  registered_at: string;
  /**
   * Absolute path of the file that was registered. `null` when the entry was
   * produced by `rebuildIndex`, which can verify hashes from on-disk objects
   * but cannot recover provenance. Consumers should treat `null` as "unknown
   * source" and rely on `content_hash` for identity.
   */
  source_path: string | null;
  /**
   * `header.session_uid` from the registered trail (spec §9.5). `null` when
   * the source header lacks the field (v0.1 single-segment trails). Used by
   * `trail load` to detect multi-segment continuations and reconcile.
   */
  session_uid?: string | null;
  /**
   * Discriminator for multi-session files (spec §9.6). `"session"` rows
   * (default for back-compat) are keyed by a session-level `content_hash` and
   * may be extracted as standalone single-session trails. `"trail"` rows are
   * keyed by the file-level (envelope) `content_hash` and represent the whole
   * multi-session file. Multiple `"session"` rows + at most one `"trail"` row
   * may share the same `source_path`.
   */
  kind?: IndexEntryKind;
};

/**
 * @public
 */
export type IndexFile = {
  version: 1;
  entries: Record<string, IndexEntry>;
};

/**
 * @public
 */
export class IndexCorruptError extends Error {
  readonly path: string;
  constructor(path: string, cause: unknown) {
    super(
      `index/objects.json at ${path} is malformed JSON: ${cause instanceof Error ? cause.message : String(cause)}. Delete the file and run rebuildIndex to recover.`,
    );
    this.name = "IndexCorruptError";
    this.path = path;
    if (cause instanceof Error) this.cause = cause;
  }
}

/**
 * @public
 */
export class IndexVersionError extends Error {
  readonly foundVersion: unknown;
  constructor(foundVersion: unknown) {
    super(
      `index/objects.json has unsupported version ${JSON.stringify(foundVersion)}; this binary understands version ${INDEX_VERSION}. Delete the file and run rebuildIndex, or upgrade the binary.`,
    );
    this.name = "IndexVersionError";
    this.foundVersion = foundVersion;
  }
}

/**
 * Read the on-disk index. Returns an empty index when the file does not exist
 * (first run). Throws `IndexVersionError` when the file's `version` differs
 * from `INDEX_VERSION` — silently dropping a newer-version index would lose
 * data, so failure is loud. Callers can recover by deleting the file and
 * running `rebuildIndex`.
 *
 * @public
 */
export async function readIndex(storeRoot: string): Promise<IndexFile> {
  const path = indexFilePath(storeRoot);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return emptyIndex();
    }
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new IndexCorruptError(path, error);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new IndexCorruptError(path, new Error("index must be a plain object"));
  }
  const index = parsed as Partial<IndexFile>;
  if (index.version !== INDEX_VERSION) {
    throw new IndexVersionError(index.version);
  }
  if (typeof index.entries !== "object" || index.entries === null || Array.isArray(index.entries)) {
    throw new IndexCorruptError(
      path,
      new Error("`entries` must be a plain object keyed by content_hash"),
    );
  }
  for (const contentHash of Object.keys(index.entries)) {
    if (!CONTENT_HASH.test(contentHash)) {
      throw new IndexCorruptError(
        path,
        new Error(`invalid content_hash index key ${JSON.stringify(contentHash)}`),
      );
    }
  }
  return index as IndexFile;
}

/**
 * @public
 */
export async function writeIndex(storeRoot: string, index: IndexFile): Promise<void> {
  const target = indexFilePath(storeRoot);
  await mkdir(indexDir(storeRoot), { recursive: true });
  // Per-write unique suffix: `withIndexLock` serializes registerTrail callers,
  // but rebuildIndex and any other future writer must not collide on a shared
  // `.tmp` path either. UUID-suffixed temp + atomic rename keeps writers safe
  // even when they bypass the lock.
  const tmp = `${target}.${randomUUID()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(index, null, 2)}\n`, "utf8");
  await rename(tmp, target);
}

/**
 * @public
 */
export async function upsertIndexEntry(
  storeRoot: string,
  contentHash: string,
  entry: IndexEntry,
): Promise<void> {
  await withIndexLock(storeRoot, async () => {
    const index = await readIndex(storeRoot);
    index.entries[contentHash] = entry;
    await writeIndex(storeRoot, index);
  });
}

/**
 * Serialize index read-modify-write across processes via proper-lockfile.
 * Locks a sentinel file inside `index/` so the lock survives the index
 * file being deleted or rewritten. Without serialization, two concurrent
 * `registerTrail` calls would both read the same old index and one would
 * overwrite the other's entry (last writer wins).
 *
 * @public
 */
export async function withIndexLock<T>(storeRoot: string, fn: () => Promise<T>): Promise<T> {
  const dir = indexDir(storeRoot);
  await mkdir(dir, { recursive: true });
  const anchor = join(dir, LOCK_ANCHOR);
  await writeFile(anchor, "", { flag: "a" });
  const release = await lockfile.lock(anchor, {
    realpath: false,
    retries: { retries: 100, minTimeout: 5, maxTimeout: 100 },
    stale: 10_000,
  });
  try {
    return await fn();
  } finally {
    await release();
  }
}

/**
 * @public
 */
export function emptyIndex(): IndexFile {
  return { version: INDEX_VERSION, entries: {} };
}

/**
 * Return all index entries whose `session_uid` matches the given value.
 * Used by `trail load` to detect multi-segment continuations of a session
 * already in the store (spec §9.5 reconciliation).
 *
 * @public
 */
export async function findEntriesBySessionUid(
  storeRoot: string,
  sessionUid: string,
): Promise<Array<{ contentHash: string; entry: IndexEntry }>> {
  const index = await readIndex(storeRoot);
  const matches: Array<{ contentHash: string; entry: IndexEntry }> = [];
  for (const [contentHash, entry] of Object.entries(index.entries)) {
    if (entry.session_uid === sessionUid) {
      matches.push({ contentHash, entry });
    }
  }
  return matches;
}
