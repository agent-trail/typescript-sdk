import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative } from "node:path";
import type { Entry, Header } from "@agent-trail/types";
import type { TrailFile, TrailSessionGroup } from "../index.js";
import { withLinkedSubagentSessionIds } from "../shared/child-session-links.js";
import { buildTrailEnvelope } from "../shared/envelope.js";
import { applyHeaderMetadataUpdates } from "../shared/header-metadata.js";
import { applyParseFidelity } from "../shared/parse-fidelity.js";
import {
  CODEX_ENTRY_ID_NAMESPACE,
  canonicalizeIdentityString,
  deriveSynthesizedEntryId,
} from "../shared/session-uid.js";
import { sanitizeTrailFile } from "../shared/trail-sanitizer.js";
import { isRecord } from "../shared/type-guards.js";
import { readGitVcs } from "../shared/vcs.js";
import { type HeadMetadata, readMetadataFromHead, walkRolloutFiles } from "./discovery.js";
import { parseCodexSnapshotEntries } from "./kit.js";
import { AGENT_NAME, buildHeader, turnContextSnapshot } from "./parser.js";
import { type CodexPathOptions, codexSessionIndexPath, codexSessionsDir } from "./paths.js";
import { isObject, sanitizeSourceRaw, stringValue, timestampToIso } from "./source.js";

type ForkFrom = NonNullable<Header["fork_from"]>;
type ChildSessionPathIndex = Map<string, string | undefined>;
type ParseCodexTrailFileOptions = CodexPathOptions;

function parseObjectRecords(text: string): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (raw.length === 0) continue;
    try {
      const value: unknown = JSON.parse(raw);
      if (isRecord(value)) records.push(value);
    } catch {
      // Keep Codex's tolerant entry parsing behavior for malformed lines.
    }
  }
  return records;
}

// Scan for the first `turn_context` record and return its policy tuple for the
// header.meta snapshot. Returns undefined when no turn_context carries any
// policy fields.
function firstTurnContextSnapshot(
  records: Record<string, unknown>[],
): Record<string, unknown> | undefined {
  return firstTurnContextValue(records, (payload) => {
    const snapshot = turnContextSnapshot(payload);
    return Object.keys(snapshot).length > 0 ? snapshot : undefined;
  });
}

function firstTurnContextModel(records: Record<string, unknown>[]): string | undefined {
  return firstTurnContextValue(records, (payload) => stringValue(payload.model));
}

function firstTurnContextValue<T>(
  records: Record<string, unknown>[],
  valueFromPayload: (payload: Record<string, unknown>) => T | undefined,
): T | undefined {
  for (const record of records) {
    if (record.type !== "turn_context") continue;
    // Match the overrides' contract: a turn_context with an unparseable
    // timestamp is skipped (it sets no baseline state and emits no events), so
    // the header snapshot must skip it too or the baseline would disagree with
    // the event stream.
    if (timestampToIso(record.timestamp) === undefined) continue;
    const payload = isObject(record.payload) ? record.payload : {};
    const value = valueFromPayload(payload);
    if (value !== undefined) return value;
  }
  return undefined;
}

async function parseSingleGroup(
  path: string,
  forkFrom?: ForkFrom,
  pathOptions: CodexPathOptions = {},
): Promise<TrailSessionGroup> {
  const records = parseObjectRecords(await readFile(path, "utf8"));
  const header = await buildHeaderForRecords(records, forkFrom);
  const sessionUid = header.session_uid ?? header.id;
  const entries = await parseCodexSnapshotEntries(records, sessionUid);
  const sessionIndexUpdate = sessionIndexNameUpdate(
    await readSessionIndexRow(header.id, pathOptions),
    sessionUid,
  );
  if (sessionIndexUpdate !== undefined) entries.push(sessionIndexUpdate);
  applyHeaderMetadataUpdates(header, entries);
  applyParseFidelity(header, entries);
  return { header, entries };
}

async function buildHeaderForRecords(
  records: Record<string, unknown>[],
  forkFrom?: ForkFrom,
): Promise<Header> {
  const firstRecord = records[0];
  if (firstRecord === undefined) {
    throw new Error("Codex session must contain a parseable JSON object header");
  }
  const header = buildHeader(firstRecord);
  if (forkFrom !== undefined) header.fork_from = forkFrom;
  await addLiveVcsFallback(header);
  addInitialTurnContextMeta(header, records);
  addModelDefault(header, records);
  return header;
}

async function addLiveVcsFallback(header: Header): Promise<void> {
  // Recorded git (session_meta.git) wins; live readGitVcs is the fallback only
  // when buildHeader found no recorded VCS block.
  if (header.vcs !== undefined || typeof header.cwd !== "string") return;
  const vcs = await readGitVcs(header.cwd);
  if (vcs !== undefined) header.vcs = vcs;
}

function addInitialTurnContextMeta(header: Header, records: Record<string, unknown>[]): void {
  // Snapshot the initial turn_context policy tuple into header.meta so the
  // starting policy is visible without scanning the event stream; mid-session
  // changes surface as system_events (overrides.ts).
  const snapshot = firstTurnContextSnapshot(records);
  if (snapshot !== undefined) {
    header.meta = { ...(header.meta ?? {}), "dev.codex.turn_context": snapshot };
  }
}

function addModelDefault(header: Header, records: Record<string, unknown>[]): void {
  const modelDefault = firstTurnContextModel(records);
  if (modelDefault !== undefined && header.agent.model_default === undefined) {
    header.agent = { ...header.agent, model_default: modelDefault };
  }
}

function isSubagentInvoke(entry: Entry): boolean {
  return entry.type === "tool_call" && entry.payload.tool === "subagent_invoke";
}

function toolResultOutput(entry: Entry): string | undefined {
  const payload = entry.payload;
  if (typeof payload !== "object" || payload === null) return undefined;
  const output = (payload as Record<string, unknown>).output;
  return typeof output === "string" && output.length > 0 ? output : undefined;
}

function agentIdFromToolOutput(output: string): string | undefined {
  try {
    const parsed = JSON.parse(output) as unknown;
    if (!isObject(parsed)) return undefined;
    const agentId = stringValue(parsed.agent_id);
    return agentId === undefined || agentId.length === 0
      ? undefined
      : canonicalizeIdentityString(agentId);
  } catch {
    return undefined;
  }
}

function childIdFromToolResult(entry: Entry): string | undefined {
  if (entry.type !== "tool_result") return undefined;
  const output = toolResultOutput(entry);
  return output === undefined ? undefined : agentIdFromToolOutput(output);
}

function subagentCallIds(entries: Entry[]): Set<string> {
  return new Set(entries.filter(isSubagentInvoke).map((entry) => entry.id));
}

function spawnChildCandidate(
  entry: Entry,
  callIds: Set<string>,
): { callEntryId: string; childId: string } | undefined {
  if (entry.type !== "tool_result") return undefined;
  const payload = entry.payload;
  if (typeof payload !== "object" || payload === null) return undefined;
  const forId = (payload as Record<string, unknown>).for_id;
  if (typeof forId !== "string" || !callIds.has(forId)) return undefined;
  const childId = childIdFromToolResult(entry);
  return childId === undefined ? undefined : { callEntryId: forId, childId };
}

function uniqueSpawnChildCandidates(entries: Entry[]): { callEntryId: string; childId: string }[] {
  const callIds = subagentCallIds(entries);
  const candidates: { callEntryId: string; childId: string }[] = [];
  const seenPairs = new Set<string>();
  for (const entry of entries) {
    const candidate = spawnChildCandidate(entry, callIds);
    if (candidate === undefined) continue;
    const key = `${candidate.callEntryId}\0${candidate.childId}`;
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);
    candidates.push(candidate);
  }
  return candidates;
}

function spawnChildCandidates(entries: Entry[]): { callEntryId: string; childId: string }[] {
  return uniqueSpawnChildCandidates(entries);
}

function countBy<T>(values: T[], keyOf: (value: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = keyOf(value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function isUnambiguousChildCandidate(
  candidate: { callEntryId: string; childId: string },
  callCounts: Map<string, number>,
  childCounts: Map<string, number>,
): boolean {
  return callCounts.get(candidate.callEntryId) === 1 && childCounts.get(candidate.childId) === 1;
}

async function parseLinkedChildGroup(
  candidate: { callEntryId: string; childId: string },
  childSessionPathIndex: ChildSessionPathIndex,
  parentGroup: TrailSessionGroup,
  pathOptions: CodexPathOptions,
): Promise<TrailSessionGroup | undefined> {
  const childPath = findUniqueSessionPathById(candidate.childId, childSessionPathIndex);
  if (childPath === undefined) return undefined;
  return parseSingleGroup(
    childPath,
    {
      session_id: parentGroup.header.id,
      entry_id: candidate.callEntryId,
    },
    pathOptions,
  ).catch(() => undefined);
}

async function buildChildSessionPathIndex(
  parentPath: string,
  parentSessionId: string,
  pathOptions: CodexPathOptions = {},
): Promise<ChildSessionPathIndex | undefined> {
  const sessionsDir = codexSessionsDir(pathOptions);
  if (sessionsDir === undefined) return undefined;
  const files = await walkRolloutFiles(sessionsDir);
  const index: ChildSessionPathIndex = new Map();
  for (const file of files) {
    if (file === parentPath) continue;
    const meta = await readMetadataFromHead(file).catch(() => ({}) as HeadMetadata);
    if (
      meta.threadSource !== "subagent" ||
      meta.parentThreadId === undefined ||
      canonicalizeIdentityString(meta.parentThreadId) !== parentSessionId
    ) {
      continue;
    }
    if (meta.id === undefined) continue;
    const childId = canonicalizeIdentityString(meta.id);
    index.set(childId, index.has(childId) ? undefined : file);
  }
  return index;
}

function findUniqueSessionPathById(
  childId: string,
  childSessionPathIndex: ChildSessionPathIndex,
): string | undefined {
  return childSessionPathIndex.get(childId);
}

async function isInsideCodexSessionsDir(
  path: string,
  pathOptions: CodexPathOptions = {},
): Promise<boolean> {
  const sessionsDir = codexSessionsDir(pathOptions);
  if (sessionsDir === undefined) return false;
  let root: string;
  let target: string;
  try {
    root = await realpath(sessionsDir);
    target = await realpath(path);
  } catch {
    return false;
  }
  const rel = relative(root, target);
  return rel.length > 0 && !rel.startsWith("..") && !isAbsolute(rel);
}

async function directChildGroups(
  parentGroup: TrailSessionGroup,
  parentPath: string,
  pathOptions: CodexPathOptions = {},
): Promise<TrailSessionGroup[]> {
  if (!(await isInsideCodexSessionsDir(parentPath, pathOptions))) return [];
  const linked = new Map<string, string>();
  const children: TrailSessionGroup[] = [];
  const candidates = spawnChildCandidates(parentGroup.entries);
  const childSessionPathIndex = await buildChildSessionPathIndex(
    parentPath,
    parentGroup.header.id,
    pathOptions,
  );
  if (childSessionPathIndex === undefined) return [];
  const callCounts = countBy(candidates, (candidate) => candidate.callEntryId);
  const childCounts = countBy(candidates, (candidate) => candidate.childId);
  for (const candidate of candidates) {
    // Only link 1:1 relationships: ambiguous repeated calls or child ids stay unlinked.
    if (!isUnambiguousChildCandidate(candidate, callCounts, childCounts)) continue;
    const child = await parseLinkedChildGroup(
      candidate,
      childSessionPathIndex,
      parentGroup,
      pathOptions,
    );
    if (child === undefined) continue;
    linked.set(candidate.callEntryId, child.header.id);
    children.push(child);
  }
  parentGroup.entries = withLinkedSubagentSessionIds(parentGroup.entries, linked);
  return children;
}

async function readSessionIndexRow(
  sessionId: string,
  pathOptions: CodexPathOptions = {},
): Promise<Record<string, unknown> | undefined> {
  const path = codexSessionIndexPath(pathOptions);
  if (path === undefined) return undefined;
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return undefined;
  }
  for (const line of text.split(/\r?\n/)) {
    if (line.length === 0) continue;
    let row: unknown;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isObject(row)) continue;
    const rowId = stringValue(row.id);
    if (rowId !== undefined && canonicalizeIdentityString(rowId) === sessionId) return row;
  }
  return undefined;
}

function sessionIndexNameUpdate(
  row: Record<string, unknown> | undefined,
  sessionUid: string,
): Entry | undefined {
  if (row === undefined) return undefined;
  const threadName = stringValue(row.thread_name);
  const trimmedThreadName = threadName?.trim();
  if (trimmedThreadName === undefined || trimmedThreadName.length === 0) return undefined;
  const ts = sessionIndexTimestampToIso(row.updated_at);
  if (ts === undefined) return undefined;
  return {
    type: "session_metadata_update",
    id: deriveSynthesizedEntryId(CODEX_ENTRY_ID_NAMESPACE, [
      sessionUid,
      "session_index",
      "thread_name",
      ts,
    ]),
    ts,
    payload: { field: "name", value: trimmedThreadName, reason: "external" },
    source: {
      agent: AGENT_NAME,
      original_type: "session_index",
      synthesized: true,
      raw: sanitizeSourceRaw(row),
    },
  };
}

function sessionIndexTimestampToIso(value: unknown): string | undefined {
  const raw = timestampToIso(value);
  if (raw === undefined) return undefined;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

export async function parseCodexTrailFile(
  path: string,
  producer: string,
  options: ParseCodexTrailFileOptions = {},
): Promise<TrailFile> {
  const env = options.env ?? process.env;
  const pathOptions = { ...options, env };
  const parentGroup = await parseSingleGroup(path, undefined, pathOptions);
  const groups = [parentGroup, ...(await directChildGroups(parentGroup, path, pathOptions))];
  const envelope = buildTrailEnvelope({ producer, groups });
  return sanitizeTrailFile({ envelope, groups });
}
