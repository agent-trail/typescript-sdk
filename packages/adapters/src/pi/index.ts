import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import pkg from "../../package.json" with { type: "json" };
import type {
  AdapterSourceHealth,
  DetectOptions,
  SessionRef,
  TrailAdapter,
  TrailFile,
} from "../index.js";
import { buildTrailEnvelope } from "../shared/envelope.js";
import { applyHeaderMetadataUpdates } from "../shared/header-metadata.js";
import {
  inspectLocalJsonlSourceHealth,
  newestLocalJsonlSourceVersion,
  scanLocalJsonlProjectDir,
  scanLocalJsonlProjectsRoot,
} from "../shared/local-jsonl.js";
import { applyParseFidelity } from "../shared/parse-fidelity.js";
import { resumeCommand } from "../shared/resume.js";
import { sanitizeTrailFile } from "../shared/trail-sanitizer.js";
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
  const s = await stat(path).catch(() => undefined);
  return s?.isDirectory() === true;
}

async function inspectSourceHealth(
  env: NodeJS.ProcessEnv = process.env,
): Promise<AdapterSourceHealth> {
  const root = piSessionsDir(env);
  return inspectLocalJsonlSourceHealth({
    adapter: "pi",
    root: root ?? null,
    scan: () => detectPiSessions({ allCwds: true }, env),
    sourceVersion: () => newestPiSourceVersion(env),
  });
}

async function scanProjectDir(dir: string): Promise<SessionRef[]> {
  return scanLocalJsonlProjectDir(dir, {
    adapter: "pi",
    idFromPath: (path) => basename(path, ".jsonl"),
    cwdFromRecord: cwdFromPiRecord,
  });
}

async function detectPiSessions(
  opts: DetectOptions | undefined,
  env: NodeJS.ProcessEnv,
): Promise<SessionRef[]> {
  const sessionsDir = piSessionsDir(env);
  if (sessionsDir === undefined) return [];
  if (opts?.allCwds === true) {
    return scanLocalJsonlProjectsRoot(piProjectsRoot(sessionsDir), {
      adapter: "pi",
      idFromPath: (path) => basename(path, ".jsonl"),
      cwdFromRecord: cwdFromPiRecord,
      allCwds: true,
      projectDirForCwd: (cwd) => piProjectDir({ sessionsDir, cwd }),
    });
  }
  return scanProjectDir(piProjectDir({ sessionsDir, cwd: opts?.cwd ?? process.cwd() }));
}

async function newestPiSourceVersion(env: NodeJS.ProcessEnv): Promise<string | null> {
  const sessionsDir = piSessionsDir(env);
  if (sessionsDir === undefined) return null;
  return newestLocalJsonlSourceVersion(piProjectDir({ sessionsDir, cwd: process.cwd() }), {
    adapter: "pi",
    versionFromRecord: (record) => versionString(record.version) ?? undefined,
  });
}

function cwdFromPiRecord(record: Record<string, unknown>): string | undefined {
  return typeof record.cwd === "string" && record.cwd.length > 0 ? record.cwd : undefined;
}

/** Options for the Pi adapter factory. */
export type PiAdapterOptions = {
  /** Environment overrides used for discovery and parsing. */
  env?: NodeJS.ProcessEnv;
};

/** Create a Pi adapter instance. */
export function createPiAdapter(options: PiAdapterOptions = {}): TrailAdapter {
  const env = options.env ?? process.env;
  return {
    name: "pi",
    async detectSessions(opts?: DetectOptions): Promise<SessionRef[]> {
      return detectPiSessions(opts, env);
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
      return newestPiSourceVersion(env);
    },
    sourceHealth: () => inspectSourceHealth(env),
  };
}
