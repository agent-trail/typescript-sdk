import { lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative } from "node:path";
import type { AdapterSourceHealth, SessionRef } from "../index.js";
import { DISCOVERY_CONCURRENCY_LIMIT, mapConcurrent } from "./concurrency.js";
import { readJsonlHeadObjects } from "./jsonl-head.js";

const HEAD_SCAN_BYTES = 16_384;

export type LocalJsonlSessionOptions = {
  adapter: string;
  dir: string;
};

export type NewestLocalJsonlSourceVersionOptions = {
  dir: string;
  versionFrom: (record: Record<string, unknown>) => string | null;
};

export type InspectLocalJsonlSourceHealthOptions = {
  adapter: string;
  root: string | null;
  missingHomeWarning?: string;
  scanRoot: () => Promise<SessionRef[]>;
  sourceVersion: () => Promise<string | null>;
};

async function dirExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function readFirstJsonlLine(path: string): Promise<Record<string, unknown> | undefined> {
  const text = await readFile(path, "utf8");
  const newlineAt = text.indexOf("\n");
  const line = newlineAt === -1 ? text : text.slice(0, newlineAt);
  if (line.length === 0) return undefined;
  return JSON.parse(line) as Record<string, unknown>;
}

async function readCwdFromHead(path: string): Promise<string | undefined> {
  for (const record of await readJsonlHeadObjects(path, HEAD_SCAN_BYTES)) {
    const cwd = record.cwd;
    if (typeof cwd === "string" && cwd.length > 0) return cwd;
  }
  return undefined;
}

async function safeJsonlFilePath(dir: string, name: string): Promise<string | undefined> {
  if (!name.endsWith(".jsonl")) return undefined;
  const file = join(dir, name);
  const fileStat = await lstat(file).catch(() => undefined);
  if (fileStat === undefined || !fileStat.isFile() || fileStat.isSymbolicLink()) return undefined;
  const realDir = await realpath(dir).catch(() => undefined);
  const realFile = await realpath(file).catch(() => undefined);
  if (realDir === undefined || realFile === undefined) return undefined;
  const rel = relative(realDir, realFile);
  if (rel.length === 0 || rel.startsWith("..") || isAbsolute(rel)) return undefined;
  return file;
}

export async function scanLocalJsonlSessionDir(
  options: LocalJsonlSessionOptions,
): Promise<SessionRef[]> {
  if (!(await dirExists(options.dir))) return [];
  const entries = await readdir(options.dir);
  const files = (
    await mapConcurrent(entries, DISCOVERY_CONCURRENCY_LIMIT, (name) =>
      safeJsonlFilePath(options.dir, name),
    )
  ).filter((file): file is string => file !== undefined);

  return mapConcurrent(files, DISCOVERY_CONCURRENCY_LIMIT, async (file) => {
    const ref: SessionRef = { id: basename(file, ".jsonl"), adapter: options.adapter, path: file };
    const fileStat = await stat(file).catch(() => undefined);
    if (fileStat !== undefined) ref.modifiedAt = new Date(fileStat.mtimeMs).toISOString();
    const cwd = await readCwdFromHead(file).catch(() => undefined);
    if (cwd !== undefined) ref.cwd = cwd;
    return ref;
  });
}

export async function scanLocalJsonlProjectRoot(options: {
  adapter: string;
  root: string;
}): Promise<SessionRef[]> {
  if (!(await dirExists(options.root))) return [];
  const entries = await readdir(options.root, { withFileTypes: true });
  const projectDirs = entries.filter((entry) => entry.isDirectory());
  const perDir = await mapConcurrent(projectDirs, DISCOVERY_CONCURRENCY_LIMIT, (entry) =>
    scanLocalJsonlSessionDir({ adapter: options.adapter, dir: join(options.root, entry.name) }),
  );
  return perDir.flat();
}

export async function newestLocalJsonlSourceVersion(
  options: NewestLocalJsonlSourceVersionOptions,
): Promise<string | null> {
  if (!(await dirExists(options.dir))) return null;
  const entries = await readdir(options.dir);
  const jsonlFiles = (
    await mapConcurrent(entries, DISCOVERY_CONCURRENCY_LIMIT, (name) =>
      safeJsonlFilePath(options.dir, name),
    )
  ).filter((file): file is string => file !== undefined);
  if (jsonlFiles.length === 0) return null;

  const withMtime = await Promise.all(
    jsonlFiles.map(async (path) => {
      const s = await lstat(path);
      return { path, mtime: s.mtimeMs };
    }),
  );
  withMtime.sort((a, b) => b.mtime - a.mtime);

  const newest = withMtime[0];
  if (newest === undefined) return null;
  const first = await readFirstJsonlLine(newest.path);
  return first === undefined ? null : options.versionFrom(first);
}

export async function inspectLocalJsonlSourceHealth(
  options: InspectLocalJsonlSourceHealthOptions,
): Promise<AdapterSourceHealth> {
  if (options.root === null) {
    return {
      adapter: options.adapter,
      path: null,
      present: false,
      readable: false,
      sessionCount: 0,
      sourceVersion: null,
      warnings: [options.missingHomeWarning ?? "home directory not found"],
    };
  }

  const rootStat = await stat(options.root).catch(() => undefined);
  if (rootStat === undefined || !rootStat.isDirectory()) {
    return {
      adapter: options.adapter,
      path: options.root,
      present: false,
      readable: false,
      sessionCount: 0,
      sourceVersion: null,
      warnings: ["source path not found"],
    };
  }

  const warnings: string[] = [];
  let sessions: SessionRef[] = [];
  try {
    sessions = await options.scanRoot();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
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

  let sourceVersion: string | null = null;
  try {
    sourceVersion = await options.sourceVersion();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`source version check failed: ${message}`);
  }

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
