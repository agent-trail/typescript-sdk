import { lstat, readdir, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative } from "node:path";
import type { AdapterSourceHealth, SessionRef } from "../index.js";
import { DISCOVERY_CONCURRENCY_LIMIT, mapConcurrent } from "./concurrency.js";
import { readJsonlHeadObjects } from "./jsonl-head.js";

const HEAD_SCAN_BYTES = 16_384;

export type LocalJsonlAdapterOptions = {
  adapter: string;
  idFromPath?: (path: string) => string;
  cwdFromRecord?: (record: Record<string, unknown>) => string | undefined;
  versionFromRecord?: (record: Record<string, unknown>) => string | undefined;
  headScanBytes?: number;
};

export type LocalJsonlProjectsRootOptions = LocalJsonlAdapterOptions & {
  allCwds?: boolean | undefined;
  cwd?: string | undefined;
  projectDirForCwd: (cwd: string) => string;
};

export type LocalJsonlHealthOptions = {
  adapter: string;
  root: string | null;
  scan: () => Promise<SessionRef[]>;
  sourceVersion: () => Promise<string | null>;
};

export async function scanLocalJsonlProjectDir(
  dir: string,
  options: LocalJsonlAdapterOptions,
): Promise<SessionRef[]> {
  if (!(await dirExists(dir))) return [];
  const files = await listSafeJsonlFiles(dir);

  return mapConcurrent(files, DISCOVERY_CONCURRENCY_LIMIT, (file) =>
    buildLocalJsonlSessionRef(file, options),
  );
}

export async function scanLocalJsonlProjectsRoot(
  root: string,
  options: LocalJsonlProjectsRootOptions,
): Promise<SessionRef[]> {
  if (options.allCwds === true) {
    if (!(await dirExists(root))) return [];
    const entries = await readdir(root, { withFileTypes: true });
    const dirs = entries.filter((entry) => entry.isDirectory());
    const refs = await mapConcurrent(dirs, DISCOVERY_CONCURRENCY_LIMIT, (entry) =>
      scanLocalJsonlProjectDir(join(root, entry.name), options),
    );
    return refs.flat();
  }

  return scanLocalJsonlProjectDir(options.projectDirForCwd(options.cwd ?? process.cwd()), options);
}

export async function newestLocalJsonlSourceVersion(
  dir: string,
  options: LocalJsonlAdapterOptions,
): Promise<string | null> {
  const files = await jsonlFilesWithMtime(dir);
  files.sort((a, b) => b.mtime - a.mtime);
  for (const file of files) {
    const version = await versionFromHead(file.path, options);
    if (version !== undefined) return version;
  }
  return null;
}

export async function inspectLocalJsonlSourceHealth(
  options: LocalJsonlHealthOptions,
): Promise<AdapterSourceHealth> {
  if (options.root === null) {
    return missingHealth(options.adapter, null, "home directory not found");
  }

  const rootStat = await stat(options.root).catch(() => undefined);
  if (rootStat === undefined || !rootStat.isDirectory()) {
    return missingHealth(options.adapter, options.root, "source path not found");
  }

  const readable = await readdir(options.root, { withFileTypes: true }).catch(
    (error: unknown) => error,
  );
  if (!Array.isArray(readable)) {
    const message = readable instanceof Error ? readable.message : String(readable);
    return {
      adapter: options.adapter,
      path: options.root,
      present: true,
      readable: false,
      sessionCount: 0,
      sourceVersion: null,
      warnings: [`source path unreadable: ${message}`],
    };
  }

  const warnings: string[] = [];
  const sessions = await options.scan().catch((error: unknown) => {
    warnings.push(`session scan failed: ${errorMessage(error)}`);
    return [];
  });
  const sourceVersion = await options.sourceVersion().catch((error: unknown) => {
    warnings.push(`source version check failed: ${errorMessage(error)}`);
    return null;
  });

  return {
    adapter: options.adapter,
    path: options.root,
    present: true,
    readable: true,
    sessionCount: sessions.length,
    sourceVersion,
    warnings,
  };
}

async function buildLocalJsonlSessionRef(
  path: string,
  options: LocalJsonlAdapterOptions,
): Promise<SessionRef> {
  const ref: SessionRef = {
    id: options.idFromPath?.(path) ?? basename(path, ".jsonl"),
    adapter: options.adapter,
    path,
  };
  const fileStat = await stat(path).catch(() => undefined);
  if (fileStat !== undefined) ref.modifiedAt = new Date(fileStat.mtimeMs).toISOString();
  const cwd = await cwdFromHead(path, options).catch(() => undefined);
  if (cwd !== undefined) ref.cwd = cwd;
  return ref;
}

async function cwdFromHead(
  path: string,
  options: LocalJsonlAdapterOptions,
): Promise<string | undefined> {
  for (const record of await readJsonlHeadObjects(path, options.headScanBytes ?? HEAD_SCAN_BYTES)) {
    const cwd = options.cwdFromRecord?.(record);
    if (cwd !== undefined && cwd.length > 0) return cwd;
  }
  return undefined;
}

async function versionFromHead(
  path: string,
  options: LocalJsonlAdapterOptions,
): Promise<string | undefined> {
  for (const record of await readJsonlHeadObjects(path, options.headScanBytes ?? HEAD_SCAN_BYTES)) {
    const version = options.versionFromRecord?.(record);
    if (version !== undefined && version.length > 0) return version;
  }
  return undefined;
}

async function jsonlFilesWithMtime(dir: string): Promise<Array<{ path: string; mtime: number }>> {
  if (!(await dirExists(dir))) return [];
  const files = await listSafeJsonlFiles(dir);
  return mapConcurrent(files, DISCOVERY_CONCURRENCY_LIMIT, async (path) => {
    const fileStat = await lstat(path);
    return { path, mtime: fileStat.mtimeMs };
  });
}

async function listSafeJsonlFiles(dir: string): Promise<string[]> {
  const names = await readdir(dir);
  return (
    await mapConcurrent(names, DISCOVERY_CONCURRENCY_LIMIT, (name) => safeJsonlPath(dir, name))
  ).filter((file): file is string => file !== undefined);
}

async function safeJsonlPath(dir: string, name: string): Promise<string | undefined> {
  if (!name.endsWith(".jsonl")) return undefined;
  const file = join(dir, name);
  if (!(await isRegularFile(file))) return undefined;
  if (!(await isRealPathInsideDir(dir, file))) return undefined;
  return file;
}

async function isRegularFile(path: string): Promise<boolean> {
  const fileStat = await lstat(path).catch(() => undefined);
  return fileStat?.isFile() === true && !fileStat.isSymbolicLink();
}

async function isRealPathInsideDir(dir: string, file: string): Promise<boolean> {
  const [realDir, realFile] = await Promise.all([
    realpath(dir).catch(() => undefined),
    realpath(file).catch(() => undefined),
  ]);
  if (realDir === undefined || realFile === undefined) return false;
  const rel = relative(realDir, realFile);
  return rel.length > 0 && !rel.startsWith("..") && !isAbsolute(rel);
}

async function dirExists(path: string): Promise<boolean> {
  const dirStat = await stat(path).catch(() => undefined);
  return dirStat?.isDirectory() === true;
}

function missingHealth(adapter: string, path: string | null, warning: string): AdapterSourceHealth {
  return {
    adapter,
    path,
    present: false,
    readable: false,
    sessionCount: 0,
    sourceVersion: null,
    warnings: [warning],
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
