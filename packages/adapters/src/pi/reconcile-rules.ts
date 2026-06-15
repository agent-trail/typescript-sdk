// Pi-specific pass-2 reconciler rules. Pi is tree-native and synthesizes entries
// that the kit's per-record mappings can't express, and the kit's general
// `branchReconciliation` is deferred (#135) — so these custom rules stand in for
// it. Order matters and is fixed in kit.ts: piModelChangeFromModel runs first
// (it reads the assistant model off the parenting hint, which piParentResolution
// later strips), then piToolKindToResult, piParentResolution, piVcsCommitEvents,
// piSessionTerminatedEof.
import type { RawRecord, ReconcilerRule } from "@agent-trail/adapter-kit";
import type { Entry, ToolKind } from "@agent-trail/types";
import { type ParentableEntry, resolveEntryParents } from "../parenting.js";
import { deriveSynthesizedEntryId, PI_ENTRY_ID_NAMESPACE } from "../session-uid.js";
import { synthesizeVcsCommitEvents } from "../vcs-commit.js";
import { findAbandonedBranchRootId, nearestMappedAncestor } from "./divergence.js";
import { PARENT_HINT, type ParentHint } from "./mappings.js";

function hintOf(entry: Entry): ParentHint | undefined {
  const meta = entry.meta as Record<string, unknown> | undefined;
  const hint = meta?.[PARENT_HINT];
  return hint as ParentHint | undefined;
}

function stripHint(entry: Entry): Entry {
  const meta = entry.meta as Record<string, unknown> | undefined;
  if (meta === undefined || !(PARENT_HINT in meta)) return entry;
  const { [PARENT_HINT]: _drop, ...rest } = meta;
  return { ...entry, meta: rest };
}

function rawParentEdge(raw: Record<string, unknown> | undefined): ParentHintEdge | undefined {
  if (raw === undefined) return undefined;
  if (raw.type === "session") return undefined;
  const sid = raw.id;
  if (typeof sid !== "string") return undefined;
  const rawPid = raw.parentId;
  return { sid, pid: typeof rawPid === "string" ? rawPid : null };
}

type ParentHintEdge = { sid: string; pid: string | null };

type ParentResolutionState = {
  parentBySourceId: Map<string, string | null>;
  sourceIdToFirstEntryId: Map<string, string>;
  sourceIdToEntryIds: Map<string, string[]>;
  activeLeafSourceId: string | undefined;
};

function firstKeptEntryIdFrom(entry: Entry): string | undefined {
  const raw = entry.source?.raw;
  if (raw !== undefined) {
    const firstKept = (raw as Record<string, unknown>).firstKeptEntryId;
    if (typeof firstKept === "string") return firstKept;
  }
  const piMeta = entry.meta?.["dev.pi.compaction"];
  if (piMeta !== null && typeof piMeta === "object") {
    const firstKept = (piMeta as Record<string, unknown>).firstKeptEntryId;
    if (typeof firstKept === "string") return firstKept;
  }
  return undefined;
}

// Resolve a leaf/label target (a raw Pi source id) to the trail entry id it
// points at: the entry the source id emitted, or — if that source id emitted
// nothing (e.g. an unmapped/dropped intermediate) — the nearest mapped ancestor,
// mirroring how abandoned_branch_id resolves. Returns undefined only when the
// whole ancestor chain is unmapped; the caller then keeps the raw id as a
// last-resort audit pointer rather than inventing a reference.
function resolveTargetEntryId(
  rawTargetId: string,
  parentBySourceId: Map<string, string | null>,
  sourceIdToFirstEntryId: Map<string, string>,
): string | undefined {
  return nearestMappedAncestor(rawTargetId, parentBySourceId, sourceIdToFirstEntryId);
}

function sourceIdFromRecord(record: RawRecord): string | undefined {
  const id = (record as Record<string, unknown>).id;
  return typeof id === "string" ? id : undefined;
}

function replacedIdsBeforeSourceId(
  firstKeptSourceId: string,
  records: RawRecord[],
  sourceIdToEntryIds: Map<string, string[]>,
): string[] | undefined {
  const replaced: string[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    const sourceId = sourceIdFromRecord(record);
    if (sourceId === undefined) continue;
    if (sourceId === firstKeptSourceId) {
      return replaced.length > 0 ? replaced : undefined;
    }
    const entryIds = sourceIdToEntryIds.get(sourceId);
    if (entryIds === undefined) continue;
    for (const entryId of entryIds) {
      if (seen.has(entryId)) continue;
      seen.add(entryId);
      replaced.push(entryId);
    }
  }
  return undefined;
}

function rawParentEdgeFromEntry(entry: Entry): ParentHintEdge | undefined {
  return rawParentEdge(
    entry.source?.raw ??
      ((entry.payload as { data?: { raw?: unknown } }).data?.raw as
        | Record<string, unknown>
        | undefined),
  );
}

function rawParentEdgeFromRecord(record: RawRecord): ParentHintEdge | undefined {
  return rawParentEdge(record as Record<string, unknown>);
}

/**
 * Pi tree-topology pass (replaces the deferred kit `branchReconciliation`).
 * Rebuilds the source-id → entry-id maps from the `PARENT_HINT` stashed by the
 * mappings, fills `parent_id` (intra-envelope block chains honored), resolves
 * each `branch_summary.abandoned_branch_id` via the divergence walk, then strips
 * the transient hints. Tree parenting + `divergence.ts` for Pi's forked sessions.
 */
export const piParentResolution: ReconcilerRule = (entries, ctx) => {
  const state = buildParentResolutionState(entries, ctx.records ?? []);
  const built = parentableEntries(entries);
  const parented = resolveEntryParents(
    built,
    state.parentBySourceId,
    sourceIdToLastEntryId(entries),
  );

  return parented.map((entry) => resolvePiParentedEntry(entry, state, ctx.records ?? []));
};

function buildParentResolutionState(entries: Entry[], records: RawRecord[]): ParentResolutionState {
  const state: ParentResolutionState = {
    parentBySourceId: new Map<string, string | null>(),
    sourceIdToFirstEntryId: new Map<string, string>(),
    sourceIdToEntryIds: new Map<string, string[]>(),
    activeLeafSourceId: undefined,
  };

  for (const record of records) {
    addParentEdge(state.parentBySourceId, rawParentEdgeFromRecord(record));
  }
  for (const entry of entries) {
    addEntryParentState(state, entry);
  }
  return state;
}

function addEntryParentState(state: ParentResolutionState, entry: Entry): void {
  const edge = rawParentEdgeFromEntry(entry);
  addParentEdge(state.parentBySourceId, edge);
  const hint = hintOf(entry);
  appendSourceEntryId(state.sourceIdToEntryIds, hint?.sid ?? edge?.sid, entry.id);
  if (hint === undefined) return;
  addParentEdge(state.parentBySourceId, { sid: hint.sid, pid: hint.pid });
  if (!state.sourceIdToFirstEntryId.has(hint.sid)) {
    state.sourceIdToFirstEntryId.set(hint.sid, entry.id);
  }
}

function addParentEdge(
  parentBySourceId: Map<string, string | null>,
  edge: ParentHintEdge | undefined,
): void {
  if (edge !== undefined && !parentBySourceId.has(edge.sid)) {
    parentBySourceId.set(edge.sid, edge.pid);
  }
}

function appendSourceEntryId(
  sourceIdToEntryIds: Map<string, string[]>,
  sourceId: string | undefined,
  entryId: string,
): void {
  if (sourceId === undefined) return;
  const sourceEntryIds = sourceIdToEntryIds.get(sourceId) ?? [];
  sourceEntryIds.push(entryId);
  sourceIdToEntryIds.set(sourceId, sourceEntryIds);
}

function sourceIdToLastEntryId(entries: Entry[]): Map<string, string> {
  const ids = new Map<string, string>();
  for (const entry of entries) {
    const hint = hintOf(entry);
    if (hint !== undefined) ids.set(hint.sid, entry.id);
  }
  return ids;
}

function parentableEntries(entries: Entry[]): ParentableEntry[] {
  const lastEntryIdForSid = new Map<string, string>();
  return entries.map((entry) => {
    const hint = hintOf(entry);
    if (hint === undefined) {
      return { entry, parentSourceId: rawParentEdgeFromEntry(entry)?.pid ?? null };
    }
    // Within one source envelope (multi-block assistant), each block after the
    // first chains off the previous block's entry. Safe regardless of other
    // entries interleaving: the kit emits one record's drafts contiguously and
    // this map is keyed by source id, so only same-envelope blocks chain here.
    const localParentId = lastEntryIdForSid.get(hint.sid);
    lastEntryIdForSid.set(hint.sid, entry.id);
    return { entry, parentSourceId: hint.pid, localParentId };
  });
}

function resolvePiParentedEntry(
  entry: Entry,
  state: ParentResolutionState,
  records: RawRecord[],
): Entry {
  const hint = hintOf(entry);
  let next = resolveSystemEventTargets(entry, state);
  next = resolveBranchSummary(next, hint, state);
  next = fillCompactionReplacements(next, records, state.sourceIdToEntryIds);
  next = backfillEnvelopeRef(next, hint, state.sourceIdToFirstEntryId);
  return stripHint(next);
}

function resolveSystemEventTargets(entry: Entry, state: ParentResolutionState): Entry {
  if (entry.type !== "system_event") return entry;
  const payload = entry.payload as { kind?: string; data?: Record<string, unknown> };
  if (payload.kind === "x-pi/leaf_change") return resolveLeafChangeTarget(entry, payload, state);
  if (payload.kind === "x-pi/label") return resolveLabelTarget(entry, payload, state);
  return entry;
}

function resolveLeafChangeTarget(
  entry: Entry,
  payload: { kind?: string; data?: Record<string, unknown> },
  state: ParentResolutionState,
): Entry {
  const rawLeaf = payload.data?.leaf_id;
  if (typeof rawLeaf !== "string") {
    // A cleared tip resets the tracker before the next branch_summary.
    state.activeLeafSourceId = undefined;
    return entry;
  }
  state.activeLeafSourceId = rawLeaf;
  const mapped = resolveTargetEntryId(
    rawLeaf,
    state.parentBySourceId,
    state.sourceIdToFirstEntryId,
  );
  return mapped === undefined ? entry : withPayloadData(entry, payload, { leaf_id: mapped });
}

function resolveLabelTarget(
  entry: Entry,
  payload: { kind?: string; data?: Record<string, unknown> },
  state: ParentResolutionState,
): Entry {
  const rawTarget = payload.data?.target_id;
  if (typeof rawTarget !== "string") return entry;
  const mapped = resolveTargetEntryId(
    rawTarget,
    state.parentBySourceId,
    state.sourceIdToFirstEntryId,
  );
  return mapped === undefined ? entry : withPayloadData(entry, payload, { target_id: mapped });
}

function withPayloadData(
  entry: Entry,
  payload: { kind?: string; data?: Record<string, unknown> },
  data: Record<string, unknown>,
): Entry {
  return {
    ...entry,
    payload: { ...payload, data: { ...payload.data, ...data } },
  } as Entry;
}

function resolveBranchSummary(
  entry: Entry,
  hint: ParentHint | undefined,
  state: ParentResolutionState,
): Entry {
  if (hint?.fromId === undefined || entry.type !== "branch_summary") return entry;
  const activeLeaf =
    state.activeLeafSourceId ?? (typeof hint.pid === "string" ? hint.pid : undefined);
  const resolved = findAbandonedBranchRootId(
    hint.fromId,
    activeLeaf,
    state.parentBySourceId,
    state.sourceIdToFirstEntryId,
  );
  return { ...entry, payload: { ...entry.payload, abandoned_branch_id: resolved } } as Entry;
}

function fillCompactionReplacements(
  entry: Entry,
  records: RawRecord[],
  sourceIdToEntryIds: Map<string, string[]>,
): Entry {
  if (entry.type !== "context_compact") return entry;
  const firstKeptEntryId = firstKeptEntryIdFrom(entry);
  const replaced =
    firstKeptEntryId === undefined
      ? undefined
      : replacedIdsBeforeSourceId(firstKeptEntryId, records, sourceIdToEntryIds);
  return replaced === undefined
    ? entry
    : ({ ...entry, payload: { ...entry.payload, replaced_message_ids: replaced } } as Entry);
}

// Multi-block assistant blocks after the first carry `source.raw.envelope_ref`
// pointing at the first block's entry id (placeholder until now). Replace it with
// the real first-entry id of the same source envelope.
function backfillEnvelopeRef(
  entry: Entry,
  hint: ParentHint | undefined,
  sourceIdToFirstEntryId: Map<string, string>,
): Entry {
  if (hint === undefined) return entry;
  const source = entry.source as { raw?: Record<string, unknown> } | undefined;
  const raw = source?.raw;
  if (raw === undefined || !("envelope_ref" in raw)) return entry;
  const firstEntryId = sourceIdToFirstEntryId.get(hint.sid);
  if (firstEntryId === undefined) return entry;
  return {
    ...entry,
    source: { ...source, raw: { ...raw, envelope_ref: firstEntryId } },
  } as Entry;
}

/**
 * Copy `semantic.tool_kind` from each `tool_call` onto its linked `tool_result`
 * (linked by `payload.for_id`, set by the built-in `toolLinking` pass). v1
 * carries the call's canonical tool kind on the result; the kit does not.
 */
export const piToolKindToResult: ReconcilerRule = (entries) => {
  const toolKindByCallEntryId = new Map<string, ToolKind>();
  const readRangeByCallEntryId = new Map<string, [number, number]>();
  for (const entry of entries) {
    if (entry.type !== "tool_call") continue;
    const kind = entry.semantic?.tool_kind;
    if (kind !== undefined) toolKindByCallEntryId.set(entry.id, kind);
    if (kind === "file_read") {
      const range = (entry.payload as { args?: { range?: unknown } }).args?.range;
      if (
        Array.isArray(range) &&
        range.length === 2 &&
        typeof range[0] === "number" &&
        typeof range[1] === "number"
      ) {
        readRangeByCallEntryId.set(entry.id, [range[0], range[1]]);
      }
    }
  }

  return entries.map((entry) => {
    if (entry.type !== "tool_result") return entry;
    const forId = (entry.payload as { for_id?: unknown }).for_id;
    if (typeof forId !== "string") return entry;
    const kind = toolKindByCallEntryId.get(forId);
    if (kind === undefined) return entry;
    const range = readRangeByCallEntryId.get(forId);
    return {
      ...entry,
      payload:
        range === undefined
          ? entry.payload
          : {
              ...entry.payload,
              meta: {
                ...(entry.payload as { meta?: object }).meta,
                file_read: {
                  ...((entry.payload as { meta?: { file_read?: object } }).meta?.file_read ?? {}),
                  range,
                },
              },
            },
      semantic: { ...entry.semantic, tool_kind: kind },
    };
  });
};

export const piVcsCommitEvents: ReconcilerRule = (entries) =>
  synthesizeVcsCommitEvents(entries, { idNamespace: PI_ENTRY_ID_NAMESPACE });

/**
 * Fill `model_change.payload.from_model` from the model in effect before the
 * change. v1 threads `prevModel` across source envelopes, advancing it on each
 * emitted assistant message (its model) and each model_change (its to_model).
 *
 * Reads the source assistant model off the parenting hint (`hint.model`), which
 * every entry an assistant envelope emits carries — so a tool_call-only or
 * thinking-only assistant (whose entries hold no model in their own payload)
 * still advances `prevModel`, matching v1. MUST run before `piParentResolution`,
 * which strips the hint.
 */
export const piModelChangeFromModel: ReconcilerRule = (entries) => {
  let prevModel: string | undefined;
  return entries.map((entry) => {
    if (entry.type === "model_change") {
      const payload = entry.payload as { from_model?: unknown; to_model?: unknown };
      const next =
        prevModel !== undefined && payload.from_model === undefined
          ? { ...entry, payload: { ...entry.payload, from_model: prevModel } }
          : entry;
      if (typeof payload.to_model === "string") prevModel = payload.to_model;
      return next;
    }
    const model = hintOf(entry)?.model;
    if (model !== undefined) prevModel = model;
    return entry;
  });
};

/**
 * Append a synthesized `session_terminated` when the file ends with `tool_call`s
 * that never got a paired `tool_result` or call-scoped `tool_call_aborted` (spec §10.3 / §18.4). Ports v1
 * `buildSynthesizedSessionTerminated`; pairing uses rules A (`for_id`) and B
 * (`semantic.call_id`), matching the validator's blocking subset.
 */
export const piSessionTerminatedEof: ReconcilerRule = (entries) => {
  const pairings = toolCallPairingState(entries);
  if (pairings.toolCallEntryIds.size === 0) return entries;
  const matched = matchedToolCallEntryIds(entries, pairings);
  const openCallIds = Array.from(pairings.toolCallEntryIds).filter((id) => !matched.has(id));
  if (openCallIds.length === 0) return entries;
  return [...entries, eofSessionTerminatedEntry(entries, openCallIds)];
};

function toolCallPairingState(entries: Entry[]): {
  toolCallEntryIds: Set<string>;
  callIdToEntryId: Map<string, string>;
} {
  const toolCallEntryIds = new Set<string>();
  const callIdToEntryId = new Map<string, string>();
  for (const entry of entries) {
    if (entry.type !== "tool_call") continue;
    toolCallEntryIds.add(entry.id);
    const callId = entry.semantic?.call_id;
    if (typeof callId === "string") callIdToEntryId.set(callId, entry.id);
  }
  return { toolCallEntryIds, callIdToEntryId };
}

function matchedToolCallEntryIds(
  entries: Entry[],
  pairings: { toolCallEntryIds: Set<string>; callIdToEntryId: Map<string, string> },
): Set<string> {
  const matched = new Set<string>();
  for (const entry of entries) {
    if (!isToolPairingEntry(entry)) continue;
    addForIdMatch(matched, entry, pairings.toolCallEntryIds);
    if (entry.type === "tool_result") addCallIdMatch(matched, entry, pairings.callIdToEntryId);
  }
  return matched;
}

function isToolPairingEntry(entry: Entry): boolean {
  if (entry.type === "tool_result") return true;
  return entry.type === "tool_call_aborted" && isCallScopedAbort(entry);
}

function isCallScopedAbort(entry: Entry): boolean {
  return (entry.payload as { scope?: unknown }).scope === "tool_call";
}

function addForIdMatch(matched: Set<string>, entry: Entry, toolCallEntryIds: Set<string>): void {
  const forId = (entry.payload as { for_id?: unknown }).for_id;
  if (typeof forId === "string" && toolCallEntryIds.has(forId)) matched.add(forId);
}

function addCallIdMatch(
  matched: Set<string>,
  entry: Entry,
  callIdToEntryId: Map<string, string>,
): void {
  const callId = entry.semantic?.call_id;
  if (typeof callId !== "string") return;
  const entryId = callIdToEntryId.get(callId);
  if (entryId !== undefined) matched.add(entryId);
}

function eofSessionTerminatedEntry(entries: Entry[], openCallIds: string[]): Entry {
  // The id is seeded from openCallIds, which are themselves sessionUid-derived
  // engine ids ([sessionUid, recordIndex, type, ordinal]) — so the synthesized
  // id is already session-scoped and deterministic without threading sessionUid
  // into the reconciler context.

  const lastEntry = entries[entries.length - 1];
  const schemaVersion = entries.find((e) => typeof e.source?.schema_version === "string")?.source
    ?.schema_version;
  const synthesized: Entry = {
    type: "session_terminated",
    id: deriveSynthesizedEntryId(PI_ENTRY_ID_NAMESPACE, ["session_terminated_eof", ...openCallIds]),
    ts: lastEntry?.ts ?? "",
    payload: { reason: "eof_with_open_tool_calls", open_call_ids: openCallIds },
    source: {
      agent: "pi",
      ...(schemaVersion !== undefined ? { schema_version: schemaVersion } : {}),
      synthesized: true,
    },
  };
  return synthesized;
}
