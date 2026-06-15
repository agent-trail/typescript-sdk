import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import pkg from "../../package.json" with { type: "json" };
import { buildTrailEnvelope } from "../envelope.js";
import { applyHeaderMetadataUpdates } from "../header-metadata.js";
import type {
  AdapterSourceHealth,
  DetectOptions,
  SessionRef,
  TrailAdapter,
  TrailFile,
} from "../index.js";
import { applyParseFidelity } from "../parse-fidelity.js";
import { resumeCommand } from "../resume.js";
import { DISCOVERY_CONCURRENCY_LIMIT, mapConcurrent } from "../shared/concurrency.js";
import { readJsonlHeadObjects } from "../shared/jsonl-head.js";
import { sanitizeTrailFile } from "../trail-sanitizer.js";
import { parsePiSnapshotEntries } from "./kit.js";
import { buildHeader } from "./parser.js";
import { piProjectDir, piProjectsRoot, piSessionsDir } from "./paths.js";
import { parseLines, versionString } from "./source.js";

const PRODUCER = `@agent-trail/adapters-pi/${pkg.version}`;
const PI_SESSION_UUID_SUFFIX_RE =
  /_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

function piResumeSessionId(id: string): string {
  return PI_SESSION_UUID_SUFFIX_RE.exec(id)?.[1] ?? id;
}

async function dirExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function inspectSourceHealth(
  env: NodeJS.ProcessEnv = process.env,
): Promise<AdapterSourceHealth> {
  const root = piSessionsDir(env);
  if (root === undefined) {
    return {
      adapter: "pi",
      path: null,
      present: false,
      readable: false,
      sessionCount: 0,
      sourceVersion: null,
      warnings: ["home directory not found"],
    };
  }

  const rootStat = await stat(root).catch(() => undefined);
  if (rootStat === undefined || !rootStat.isDirectory()) {
    return {
      adapter: "pi",
      path: root,
      present: false,
      readable: false,
      sessionCount: 0,
      sourceVersion: null,
      warnings: ["source path not found"],
    };
  }

  const entriesOrError = await readdir(root, { withFileTypes: true }).catch(
    (error: unknown) => error,
  );
  if (!Array.isArray(entriesOrError)) {
    const message =
      entriesOrError instanceof Error ? entriesOrError.message : String(entriesOrError);
    return {
      adapter: "pi",
      path: root,
      present: true,
      readable: false,
      sessionCount: 0,
      sourceVersion: null,
      warnings: [`source path unreadable: ${message}`],
    };
  }
  const entries = entriesOrError;

  const warnings: string[] = [];
  let sessions: SessionRef[] = [];
  try {
    const projectDirs = entries.filter((entry) => entry.isDirectory());
    const perDir = await mapConcurrent(projectDirs, DISCOVERY_CONCURRENCY_LIMIT, (entry) =>
      scanProjectDir(join(root, entry.name)),
    );
    sessions = perDir.flat();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`session scan failed: ${message}`);
  }

  let sourceVersion: string | null = null;
  try {
    sourceVersion = await createPiAdapter({ env }).sourceVersion();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`source version check failed: ${message}`);
  }

  return {
    adapter: "pi",
    path: root,
    present: true,
    readable: true,
    sessionCount: sessions.length,
    sourceVersion,
    warnings,
  };
}

async function readFirstJsonlLine(path: string): Promise<Record<string, unknown> | undefined> {
  const text = await readFile(path, "utf8");
  const newlineAt = text.indexOf("\n");
  const line = newlineAt === -1 ? text : text.slice(0, newlineAt);
  if (line.length === 0) return undefined;
  return JSON.parse(line) as Record<string, unknown>;
}

const HEAD_SCAN_BYTES = 16_384;

async function readCwdFromHead(path: string): Promise<string | undefined> {
  for (const record of await readJsonlHeadObjects(path, HEAD_SCAN_BYTES)) {
    const cwd = record.cwd;
    if (typeof cwd === "string" && cwd.length > 0) {
      return cwd;
    }
  }
  return undefined;
}

async function buildSessionRef(filePath: string, id: string): Promise<SessionRef> {
  const ref: SessionRef = { id, adapter: "pi", path: filePath };
  try {
    const s = await stat(filePath);
    ref.modifiedAt = new Date(s.mtimeMs).toISOString();
  } catch {
    // leave modifiedAt undefined
  }
  try {
    const cwd = await readCwdFromHead(filePath);
    if (cwd !== undefined) ref.cwd = cwd;
  } catch {
    // leave cwd undefined
  }
  return ref;
}

async function scanProjectDir(dir: string): Promise<SessionRef[]> {
  if (!(await dirExists(dir))) return [];
  const entries = await readdir(dir);
  const jsonlNames = entries.filter((name) => name.endsWith(".jsonl"));
  return mapConcurrent(jsonlNames, DISCOVERY_CONCURRENCY_LIMIT, (name) =>
    buildSessionRef(join(dir, name), name.slice(0, -".jsonl".length)),
  );
}

export type PiAdapterOptions = {
  env?: NodeJS.ProcessEnv;
};

export function createPiAdapter(options: PiAdapterOptions = {}): TrailAdapter {
  const env = options.env ?? process.env;
  return {
    name: "pi",
    async detectSessions(opts?: DetectOptions): Promise<SessionRef[]> {
      const sessionsDir = piSessionsDir(env);
      if (sessionsDir === undefined) return [];
      if (opts?.allCwds === true) {
        const root = piProjectsRoot(sessionsDir);
        if (!(await dirExists(root))) return [];
        const entries = await readdir(root, { withFileTypes: true });
        const projectDirs = entries.filter((entry) => entry.isDirectory());
        const perDir = await mapConcurrent(projectDirs, DISCOVERY_CONCURRENCY_LIMIT, (entry) =>
          scanProjectDir(join(root, entry.name)),
        );
        return perDir.flat();
      }
      const dir = piProjectDir({ sessionsDir, cwd: opts?.cwd ?? process.cwd() });
      return scanProjectDir(dir);
    },
    async parseSession(ref: SessionRef): Promise<TrailFile> {
      if (ref.path === undefined) {
        throw new Error("Pi adapter requires SessionRef.path");
      }
      const text = await readFile(ref.path, "utf8");
      const envelopes = parseLines(text);
      const header = buildHeader(envelopes);
      if (header.session_uid === undefined) {
        throw new Error("Pi header missing session_uid (buildHeader invariant)");
      }
      const entries = await parsePiSnapshotEntries(envelopes, header.session_uid);
      applyHeaderMetadataUpdates(header, entries);
      applyParseFidelity(header, entries);
      const groups = [{ header, entries }];
      const envelope = buildTrailEnvelope({ producer: PRODUCER, groups });
      return sanitizeTrailFile({ envelope, groups });
    },
    async resumeSession(ref: SessionRef) {
      const id = piResumeSessionId(ref.id);
      return resumeCommand(ref, `Resume Pi session ${id}`, ["pi", "--session", id]);
    },
    async isAvailable(): Promise<boolean> {
      const sessionsDir = piSessionsDir(env);
      if (sessionsDir === undefined) return false;
      return dirExists(piProjectDir({ sessionsDir, cwd: process.cwd() }));
    },
    async sourceVersion(): Promise<string | null> {
      const sessionsDir = piSessionsDir(env);
      if (sessionsDir === undefined) return null;
      const dir = piProjectDir({ sessionsDir, cwd: process.cwd() });
      if (!(await dirExists(dir))) return null;
      const entries = await readdir(dir);
      const jsonlFiles = entries.filter((name) => name.endsWith(".jsonl"));
      if (jsonlFiles.length === 0) return null;
      const withMtime = await Promise.all(
        jsonlFiles.map(async (name) => {
          const path = join(dir, name);
          const s = await stat(path);
          return { path, mtime: s.mtimeMs };
        }),
      );
      withMtime.sort((a, b) => b.mtime - a.mtime);
      const newest = withMtime[0];
      if (newest === undefined) return null;
      const first = await readFirstJsonlLine(newest.path);
      if (first === undefined) return null;
      return versionString(first.version) ?? null;
    },
    sourceHealth: () => inspectSourceHealth(env),
  };
}
