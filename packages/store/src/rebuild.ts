import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { emptyIndex, withIndexLock, writeIndex } from "./index-file.js";
import { writerStrictObjectIndexPolicy } from "./object-index-policy.js";
import { objectsDir, resolveStoreRoot } from "./paths.js";

const OBJECT_NAME = /^([0-9a-f]{64})\.trail\.jsonl$/;

/**
 * @public
 */
export type RebuildIndexOptions = {
  storeRoot?: string;
};

/**
 * @public
 */
export type RebuildIndexResult = {
  entries: number;
};

/**
 * @public
 */
export async function rebuildIndex(opts: RebuildIndexOptions = {}): Promise<RebuildIndexResult> {
  const storeRoot = resolveStoreRoot(opts.storeRoot);
  const dir = objectsDir(storeRoot);
  const index = emptyIndex();
  const names = await objectNames(dir);

  for (const name of names) {
    const entry = await rebuildObjectEntry(dir, name);
    if (entry === undefined) continue;
    index.entries[entry.contentHash] = entry.indexEntry;
  }

  await withIndexLock(storeRoot, () => writeIndex(storeRoot, index));
  return { entries: Object.keys(index.entries).length };
}

async function objectNames(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function rebuildObjectEntry(
  dir: string,
  name: string,
): Promise<
  | {
      contentHash: string;
      indexEntry: ReturnType<typeof emptyIndex>["entries"][string];
    }
  | undefined
> {
  const match = OBJECT_NAME.exec(name);
  if (match === null) return undefined;
  const filenameHash = match[1] as string;
  const path = join(dir, name);

  const raw = await readObjectFile(path);
  if (raw === undefined) return undefined;

  const eligible = await writerStrictObjectIndexPolicy(raw);
  const row =
    eligible.status === "valid"
      ? eligible.policy.rows.find((candidate) => candidate.contentHash === filenameHash)
      : undefined;
  if (row === undefined) return undefined;

  const info = await stat(path);
  return {
    contentHash: filenameHash,
    indexEntry: {
      registered_at: info.mtime.toISOString(),
      source_path: null,
      session_uid: row.session_uid,
      kind: row.kind,
    },
  };
}

async function readObjectFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
