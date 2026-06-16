import { lstat, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { DetectOptions, SessionRef } from "../index.js";
import { readJsonlHead as readJsonLinesHead, readJsonlHeadObjects } from "../shared/jsonl-head.js";
import { canonicalizeIdentityString } from "../shared/session-uid.js";
import { isRecord } from "../shared/type-guards.js";
import { type CodexPathOptions, codexSessionsDir } from "./paths.js";

export async function dirExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}

// 64 KiB covers observed Codex 0.128 session_meta records that embed
// base_instructions (~22 KiB), while still keeping discovery/metadata reads
// bounded. If a future shape pushes the first record past this cap,
// `readJsonLinesHead` will return a truncated tail and the wrappers below will
// skip the partial last line.
const HEAD_SCAN_BYTES = 65_536;

export type HeadMetadata = {
  id?: string | undefined;
  cwd?: string | undefined;
  threadSource?: string | undefined;
  parentThreadId?: string | undefined;
};

// Read id + cwd from the same head scan in a single open/read pass. Both
// fields live on (or near) the first record so combining halves the per-file
// I/O during `detectSessions`.
//
// Cwd surfaces in two places across observed Codex originators:
//   - `session_meta.payload.cwd` — codex-tui 0.128.x, Codex Desktop
//     0.133.x-alpha, codex_sdk_ts 0.98.x (canonical wrapped shape).
//   - top-level `cwd` field on the first record — older / hypothetical flat
//     shapes; kept as a tolerant fallback even though no real session
//     observed by the verifying contributor uses it.
// Id is only extracted from the first parseable line (session_meta carries
// the canonical session id at `payload.id`).
// See `docs/parser-source-matrix.md` Codex row for verification notes.
export async function readMetadataFromHead(path: string): Promise<HeadMetadata> {
  const records = await readJsonlHeadObjects(path, HEAD_SCAN_BYTES);
  let id: string | undefined;
  let cwd: string | undefined;
  let threadSource: string | undefined;
  let parentThreadId: string | undefined;

  const first = records[0];
  if (first !== undefined) {
    const firstMeta = firstRecordMetadata(first);
    id = firstMeta.id;
    threadSource = firstMeta.threadSource;
    parentThreadId = firstMeta.parentThreadId;
  }

  for (const record of records) {
    cwd ??= cwdFromRecord(record);
    if (id !== undefined && cwd !== undefined) {
      return { id, cwd, threadSource, parentThreadId };
    }
  }
  return { id, cwd, threadSource, parentThreadId };
}

function firstRecordMetadata(record: Record<string, unknown>): HeadMetadata {
  const payload = payloadRecord(record);
  const id = stringField(payload, "id") ?? stringField(record, "id");
  if (record.type !== "session_meta" || payload === undefined) return { id };
  return {
    id,
    threadSource: stringField(payload, "thread_source"),
    parentThreadId: parentThreadIdFromPayload(payload),
  };
}

function cwdFromRecord(record: Record<string, unknown>): string | undefined {
  return stringField(payloadRecord(record), "cwd") ?? stringField(record, "cwd");
}

function parentThreadIdFromPayload(payload: Record<string, unknown>): string | undefined {
  const source = payload.source;
  if (!isRecord(source) || !isRecord(source.subagent) || !isRecord(source.subagent.thread_spawn)) {
    return undefined;
  }
  return stringField(source.subagent.thread_spawn, "parent_thread_id");
}

function payloadRecord(record: Record<string, unknown>): Record<string, unknown> | undefined {
  return isRecord(record.payload) ? record.payload : undefined;
}

function stringField(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

async function readSessionVersionFromHead(path: string): Promise<string | undefined> {
  const { lines } = await readJsonLinesHead(path, HEAD_SCAN_BYTES);
  const first = lines[0];
  if (first === undefined) return undefined;
  try {
    const record = JSON.parse(first) as Record<string, unknown>;
    const payload = record.payload;
    if (payload !== null && typeof payload === "object") {
      const cliVersion = (payload as Record<string, unknown>).cli_version;
      if (typeof cliVersion === "string" && cliVersion.length > 0) return cliVersion;
      const originator = (payload as Record<string, unknown>).originator;
      if (typeof originator === "string" && originator.length > 0) return originator;
    }
  } catch {
    // ignore
  }
  return undefined;
}

export async function walkRolloutFiles(root: string): Promise<string[]> {
  if (!(await dirExists(root))) return [];
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (dir === undefined) break;
    await collectRolloutFilesInDir(dir, stack, out);
  }
  // Date-partitioned paths (`YYYY/MM/DD/rollout-<datetime>-<uuid>.jsonl`)
  // sort lexicographically into chronological order, giving deterministic
  // results across runs and platforms.
  out.sort();
  return out;
}

async function collectRolloutFilesInDir(
  dir: string,
  stack: string[],
  out: string[],
): Promise<void> {
  const names = await readdir(dir).catch(() => undefined);
  if (names === undefined) return;
  for (const name of names) {
    await collectRolloutPath(join(dir, name), name, stack, out);
  }
}

async function collectRolloutPath(
  fullPath: string,
  name: string,
  stack: string[],
  out: string[],
): Promise<void> {
  const s = await lstat(fullPath).catch(() => undefined);
  if (s === undefined) return;
  if (s.isDirectory()) stack.push(fullPath);
  else if (s.isFile() && name.endsWith(".jsonl")) out.push(fullPath);
}

async function buildSessionRef(filePath: string): Promise<SessionRef> {
  const meta = await readMetadataFromHead(filePath).catch(() => ({}) as HeadMetadata);
  const rawId = meta.id ?? deriveIdFromFilename(filePath) ?? filePath;
  const id = canonicalizeIdentityString(rawId);
  const ref: SessionRef = {
    id,
    adapter: "codex",
    path: filePath,
    headerStatus: meta.id !== undefined ? "header" : "filename-fallback",
  };
  try {
    const s = await stat(filePath);
    ref.modifiedAt = new Date(s.mtimeMs).toISOString();
  } catch {
    // leave modifiedAt undefined
  }
  if (meta.cwd !== undefined) ref.cwd = meta.cwd;
  return ref;
}

// rollout-<datetime>-<uuid>.jsonl — fall back to the trailing UUID when the
// session header is unreadable.
function deriveIdFromFilename(filePath: string): string | undefined {
  const base = filePath.replace(/^.*\//, "").replace(/\.jsonl$/, "");
  const match = base.match(/-([0-9a-f-]{36})$/i);
  return match?.[1];
}

export async function detectCodexSessions(
  opts?: DetectOptions,
  pathOptions: NodeJS.ProcessEnv | CodexPathOptions = process.env,
): Promise<SessionRef[]> {
  const sessionsDir = codexSessionsDir(pathOptions);
  if (sessionsDir === undefined) return [];
  const files = await walkRolloutFiles(sessionsDir);
  const refs = await Promise.all(files.map(buildSessionRef));
  if (opts?.allCwds === true) return refs;
  const filterCwd = opts?.cwd ?? process.cwd();
  return refs.filter((r) => r.cwd === undefined || r.cwd === filterCwd);
}

// Report the newest session's `cli_version` (or originator string when
// version is absent). Mirrors the Pi adapter precedent — pick the file
// most recently touched in the current cwd's session tree.
export async function newestCodexSourceVersion(
  pathOptions: NodeJS.ProcessEnv | CodexPathOptions = process.env,
): Promise<string | null> {
  const dir = codexSessionsDir(pathOptions);
  if (dir === undefined) return null;
  if (!(await dirExists(dir))) return null;
  const files = await walkRolloutFiles(dir);
  if (files.length === 0) return null;
  const withMtime = await Promise.all(
    files.map(async (path) => {
      try {
        const s = await stat(path);
        return { path, mtime: s.mtimeMs };
      } catch {
        return { path, mtime: 0 };
      }
    }),
  );
  // Primary: newest mtime wins. Tiebreaker: lexicographically greatest path
  // because date-partitioned rollout paths sort chronologically.
  withMtime.sort((a, b) => {
    if (b.mtime !== a.mtime) return b.mtime - a.mtime;
    return a.path < b.path ? 1 : a.path > b.path ? -1 : 0;
  });
  const newest = withMtime[0];
  if (newest === undefined) return null;
  return (await readSessionVersionFromHead(newest.path)) ?? null;
}
