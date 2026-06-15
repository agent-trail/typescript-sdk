import { readFile, stat } from "node:fs/promises";
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
import {
  inspectLocalJsonlSourceHealth,
  newestLocalJsonlSourceVersion,
  scanLocalJsonlProjectRoot,
  scanLocalJsonlSessionDir,
} from "../shared/local-jsonl-sessions.js";
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
    return inspectLocalJsonlSourceHealth({
      adapter: "pi",
      root: null,
      scanRoot: async () => [],
      sourceVersion: async () => null,
    });
  }

  return inspectLocalJsonlSourceHealth({
    adapter: "pi",
    root,
    scanRoot: () => scanLocalJsonlProjectRoot({ adapter: "pi", root }),
    sourceVersion: () => createPiAdapter({ env }).sourceVersion(),
  });
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
        return scanLocalJsonlProjectRoot({ adapter: "pi", root });
      }
      const dir = piProjectDir({ sessionsDir, cwd: opts?.cwd ?? process.cwd() });
      return scanLocalJsonlSessionDir({ adapter: "pi", dir });
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
      return newestLocalJsonlSourceVersion({
        dir,
        versionFrom: (record) => versionString(record.version) ?? null,
      });
    },
    sourceHealth: () => inspectSourceHealth(env),
  };
}
