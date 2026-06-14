import { lstat, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { type CatalogDb, initializeCatalog, upsertTrailObject } from "@agent-trail/catalog";
import { writerStrictObjectIndexPolicy } from "./object-index-policy.js";
import { objectsDir, resolveStoreRoot } from "./paths.js";

const OBJECT_NAME = /^([0-9a-f]{64})\.trail\.jsonl$/;

/**
 * Options for indexing existing content-addressed objects into a catalog.
 *
 * @public
 */
export type IndexExistingObjectsOptions = {
  storeRoot?: string;
  catalogDb: CatalogDb;
};

/**
 * Result of indexing existing object files into a catalog.
 *
 * @public
 */
export type IndexExistingObjectsResult = {
  entries: number;
};

/**
 * Scan on-disk object files and upsert matching object rows into the catalog.
 *
 * @public
 */
export async function indexExistingObjects(
  opts: IndexExistingObjectsOptions,
): Promise<IndexExistingObjectsResult> {
  const storeRoot = resolveStoreRoot(opts.storeRoot);
  const dir = objectsDir(storeRoot);
  await initializeCatalog(opts.catalogDb);
  const names = await objectNames(dir);
  let entries = 0;

  for (const name of names) {
    const entry = await indexObjectEntry(dir, name);
    if (entry === undefined) continue;
    await upsertTrailObject(opts.catalogDb, entry);
    entries += 1;
  }

  return { entries };
}

async function objectNames(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function indexObjectEntry(
  dir: string,
  name: string,
): Promise<Parameters<typeof upsertTrailObject>[1] | undefined> {
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

  const info = await lstat(path);
  return {
    content_hash: filenameHash,
    kind: row.kind,
    object_path: path,
    source_path: null,
    session_uid: row.session_uid,
    registered_at: info.mtime.toISOString(),
  };
}

async function readObjectFile(path: string): Promise<string | undefined> {
  try {
    const info = await lstat(path);
    if (!info.isFile()) return undefined;
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
