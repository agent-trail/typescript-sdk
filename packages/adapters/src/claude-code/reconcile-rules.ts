// Claude Code is linear (parentChain handles parent_id). These custom rules cover
// the cross-record behaviors the kit's per-record mappings can't express:
// synthesized model_change (assistant model transitions), permission-mode deltas,
// compact-boundary provenance, request-level usage dedupe, tool_kind propagation
// to results, and multi-block source.raw.envelope_ref backfill + hint stripping.
// ccEnvelopeRefBackfill runs LAST (it strips hints).
import type { ReconcilerRule } from "@agent-trail/adapter-kit";
import type { Entry, ToolKind } from "@agent-trail/types";
import { CLAUDE_CODE_ENTRY_ID_NAMESPACE, deriveSynthesizedEntryId } from "../session-uid.js";
import { linkerCallId } from "../shared/linker-meta.js";
import { uniqueOptionLabelToId } from "../shared/options.js";
import { dropTaskPlanAckResults, withTaskPlanDeltas } from "../task-plan.js";
import { synthesizeVcsCommitEvents } from "../vcs-commit.js";
import { type CcHint, HINT } from "./mappings.js";
import { isObject, stringValue } from "./source.js";

function hintOf(entry: Entry): CcHint | undefined {
  return entry.meta?.[HINT] as CcHint | undefined;
}

function payloadHasUsage(entry: Entry): boolean {
  return (
    entry.payload !== null &&
    typeof entry.payload === "object" &&
    Object.hasOwn(entry.payload, "usage")
  );
}

function omitPayloadUsage(entry: Entry): Entry {
  const { usage: _usage, ...payload } = entry.payload as Record<string, unknown>;
  return { ...entry, payload } as Entry;
}

/**
 * Insert a synthesized model_change when a new assistant envelope's model differs
 * from the previous one. Mirrors v1: per source assistant envelope (grouped by
 * hint.sid), reading the model off hint.model — so tool-only / thinking-only
 * assistants still trigger it. Runs before ccEnvelopeRefBackfill strips hints.
 */
export const ccModelChangeSynth: ReconcilerRule = (entries) => {
  const tracker: ModelTracker = {};
  const out: Entry[] = [];
  for (const entry of entries) {
    const modelChange = nextModelChange(entry, tracker);
    if (modelChange !== undefined) {
      out.push(modelChange);
      out.push({ ...entry, parent_id: modelChange.id });
      continue;
    }
    out.push(entry);
  }
  return out;
};

type ModelTracker = {
  prevModel?: string;
  lastSid?: string;
};

type ModelHint = {
  model: string;
  sid: string;
};

function nextModelChange(entry: Entry, tracker: ModelTracker): Entry | undefined {
  const current = modelHint(entry);
  if (current === undefined || current.sid === tracker.lastSid) return undefined;
  const previous = tracker.prevModel;
  tracker.prevModel = current.model;
  tracker.lastSid = current.sid;
  return previous !== undefined && previous !== current.model
    ? modelChangeEntry(entry, previous, current.model)
    : undefined;
}

function modelHint(entry: Entry): ModelHint | undefined {
  const hint = hintOf(entry);
  return hint?.model !== undefined && hint.sid !== undefined
    ? { model: hint.model, sid: hint.sid }
    : undefined;
}

function modelChangeEntry(entry: Entry, prevModel: string, model: string): Entry {
  const modelChangeId = deriveSynthesizedEntryId(CLAUDE_CODE_ENTRY_ID_NAMESPACE, [
    "model_change",
    entry.id,
    prevModel,
    model,
  ]);
  return {
    type: "model_change",
    id: modelChangeId,
    ts: entry.ts,
    parent_id: entry.parent_id ?? null,
    payload: { from_model: prevModel, to_model: model },
    source: modelChangeSource(entry),
  } as Entry;
}

function modelChangeSource(entry: Entry): Entry["source"] {
  const envelope = entry.source?.raw?.envelope;
  const schemaVersion = entry.source?.schema_version;
  return {
    agent: "claude-code",
    original_type: "assistant",
    ...(schemaVersion !== undefined ? { schema_version: schemaVersion } : {}),
    synthesized: true,
    ...(envelope !== undefined ? { raw: envelope } : {}),
  } as Entry["source"];
}

function hasVcsBranchUpdate(entry: Entry): boolean {
  return (
    entry.type === "session_metadata_update" &&
    (entry.payload as { field?: unknown }).field === "vcs.branch"
  );
}

function gitBranchSource(entry: Entry): Entry["source"] {
  const originalType = entry.source?.original_type;
  return {
    agent: "claude-code",
    ...(typeof originalType === "string" ? { original_type: `${originalType}.gitBranch` } : {}),
    ...(entry.source?.schema_version !== undefined
      ? { schema_version: entry.source.schema_version }
      : {}),
    synthesized: true,
    ...(entry.source?.raw !== undefined ? { raw: entry.source.raw } : {}),
  } as Entry["source"];
}

/**
 * Claude Code tracer records carry `gitBranch`, but not a session-time commit in
 * observed local corpora. Preserve the first branch as metadata without emitting
 * `header.vcs`, and let mapped `worktree-state` branch updates win when present.
 */
export const ccGitBranchMetadataSynth: ReconcilerRule = (entries) => {
  if (entries.some(hasVcsBranchUpdate)) return entries;
  const out: Entry[] = [];
  let emitted = false;
  for (const entry of entries) {
    if (!emitted) {
      const branch = hintOf(entry)?.gitBranch;
      if (branch !== undefined && branch.length > 0) {
        const id = deriveSynthesizedEntryId(CLAUDE_CODE_ENTRY_ID_NAMESPACE, [
          "gitBranch",
          entry.id,
          branch,
        ]);
        out.push({
          type: "session_metadata_update",
          id,
          ts: entry.ts,
          parent_id: entry.parent_id ?? null,
          payload: { field: "vcs.branch", value: branch, reason: "runtime_inferred" },
          source: gitBranchSource(entry),
        } as Entry);
        out.push({ ...entry, parent_id: id });
        emitted = true;
        continue;
      }
    }
    out.push(entry);
  }
  return out;
};

/**
 * Claude Code can split one assistant API response across multiple JSONL
 * records that share `requestId`; each record repeats the same
 * `message.usage`. Keep usage only on the first usage-capable entry in that
 * request group.
 */
export const ccRequestUsageDedupe: ReconcilerRule = (entries) => {
  const seenGroups = new Set<string>();
  return entries.map((entry) => {
    const groupId = entry.semantic?.group_id;
    if (typeof groupId !== "string" || !payloadHasUsage(entry)) return entry;
    if (seenGroups.has(groupId)) return omitPayloadUsage(entry);
    seenGroups.add(groupId);
    return entry;
  });
};

function isCompactBoundary(entry: Entry): boolean {
  return (
    entry.type === "system_event" &&
    (entry.payload as { kind?: unknown }).kind === "x-claudecode/compact_boundary"
  );
}

export const ccCompactBoundaryProvenance: ReconcilerRule = (entries) => {
  const out: Entry[] = [];
  let entryIdsSinceLastCompact: string[] = [];
  let pendingReplacedMessageIds: string[] | undefined;

  for (const entry of entries) {
    if (isCompactBoundary(entry)) {
      pendingReplacedMessageIds =
        entryIdsSinceLastCompact.length > 0 ? [...entryIdsSinceLastCompact] : undefined;
      entryIdsSinceLastCompact = [];
      out.push(entry);
      continue;
    }

    if (entry.type === "context_compact") {
      if (pendingReplacedMessageIds !== undefined) {
        out.push({
          ...entry,
          payload: { ...entry.payload, replaced_message_ids: pendingReplacedMessageIds },
        });
      } else {
        out.push(entry);
      }
      pendingReplacedMessageIds = undefined;
      entryIdsSinceLastCompact = [];
      continue;
    }

    entryIdsSinceLastCompact.push(entry.id);
    out.push(entry);
  }

  return out;
};

/**
 * Copy `semantic.tool_kind` from each tool_call onto its linked tool_result
 * (linked by payload.for_id from the built-in toolLinking pass). Same as Pi.
 */
export const ccToolKindToResult: ReconcilerRule = (entries) => {
  const context = toolResultContext(entries);
  return entries.map((entry) => reconcileToolResult(entry, context));
};

type ToolResultContext = {
  kindByCallEntryId: Map<string, ToolKind>;
  readRangeByCallEntryId: Map<string, [number, number]>;
  queryByCallId: Map<string, Entry>;
};

function toolResultContext(entries: readonly Entry[]): ToolResultContext {
  const context: ToolResultContext = {
    kindByCallEntryId: new Map(),
    readRangeByCallEntryId: new Map(),
    queryByCallId: new Map(),
  };
  for (const entry of entries) {
    collectToolCallContext(entry, context);
    collectUserQueryContext(entry, context);
  }
  return context;
}

function collectToolCallContext(entry: Entry, context: ToolResultContext): void {
  if (entry.type !== "tool_call") return;
  const kind = entry.semantic?.tool_kind;
  if (kind === undefined) return;
  context.kindByCallEntryId.set(entry.id, kind);
  const range = kind === "file_read" ? fileReadRange(entry) : undefined;
  if (range !== undefined) context.readRangeByCallEntryId.set(entry.id, range);
}

function fileReadRange(entry: Entry): [number, number] | undefined {
  const range = (entry.payload as { args?: { range?: unknown } }).args?.range;
  return isNumericRange(range) ? [range[0], range[1]] : undefined;
}

function isNumericRange(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number"
  );
}

function collectUserQueryContext(entry: Entry, context: ToolResultContext): void {
  if (entry.type !== "user_query") return;
  const callId = entry.semantic?.call_id ?? linkerCallId(entry);
  if (callId !== undefined) context.queryByCallId.set(callId, entry);
}

function reconcileToolResult(entry: Entry, context: ToolResultContext): Entry {
  if (entry.type !== "tool_result") return entry;
  return queryResponseEntry(entry, context) ?? toolKindResultEntry(entry, context) ?? entry;
}

function queryResponseEntry(entry: Entry, context: ToolResultContext): Entry | undefined {
  const callId = entry.semantic?.call_id ?? linkerCallId(entry);
  const query = callId !== undefined ? context.queryByCallId.get(callId) : undefined;
  if (query === undefined) return undefined;
  return {
    ...entry,
    type: "user_query_response",
    payload: {
      for_id: query.id,
      answers: answersForQuery(query, (entry.payload as { output?: unknown }).output),
    },
    semantic: {
      ...(callId !== undefined ? { call_id: callId } : {}),
    },
  } as Entry;
}

function toolKindResultEntry(entry: Entry, context: ToolResultContext): Entry | undefined {
  const forId = (entry.payload as { for_id?: unknown }).for_id;
  if (typeof forId !== "string") return undefined;
  const kind = context.kindByCallEntryId.get(forId);
  return kind === undefined
    ? undefined
    : withToolKind(entry, kind, context.readRangeByCallEntryId.get(forId));
}

function withToolKind(entry: Entry, kind: ToolKind, range: [number, number] | undefined): Entry {
  return {
    ...entry,
    payload: range === undefined ? entry.payload : withFileReadRange(entry, range),
    semantic: { ...entry.semantic, tool_kind: kind },
  } as Entry;
}

function withFileReadRange(entry: Entry, range: [number, number]): Entry["payload"] {
  return {
    ...entry.payload,
    meta: {
      ...(entry.payload as { meta?: object }).meta,
      file_read: {
        ...((entry.payload as { meta?: { file_read?: object } }).meta?.file_read ?? {}),
        range,
      },
    },
  };
}

function queryQuestions(entry: Entry): Record<string, unknown>[] {
  const questions = (entry.payload as { questions?: unknown }).questions;
  return Array.isArray(questions)
    ? questions.filter(
        (question): question is Record<string, unknown> =>
          question !== null && typeof question === "object",
      )
    : [];
}

function unescapeQuoted(value: string): string {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
}

function parseSerializedAnswers(output: unknown): Map<string, string> {
  const answers = new Map<string, string>();
  if (typeof output !== "string" || output.length === 0) return answers;
  const pairPattern = /"((?:\\.|[^"\\])*)"="((?:\\.|[^"\\])*)"/g;
  for (const match of output.matchAll(pairPattern)) {
    const question = match[1] as string;
    const answer = match[2] as string;
    answers.set(unescapeQuoted(question), unescapeQuoted(answer));
  }
  if (answers.size === 0) answers.set("", output);
  return answers;
}

function selectedFor(
  question: Record<string, unknown>,
  answerText: string,
): Record<string, unknown> {
  const selected = selectedAnswerValues(question, answerText);
  const options = questionOptions(question);
  const normalizedSelected = normalizeSelectedLabels(selected, options);
  const knownOptions = knownOptionSet(options);
  if (question.allow_other !== true || knownOptions.size === 0) {
    return { selected: normalizedSelected };
  }
  const known = normalizedSelected.filter((value) => knownOptions.has(value));
  const unknown = normalizedSelected.filter((value) => !knownOptions.has(value));
  return { selected: known, ...(unknown.length > 0 ? { other: unknown.join(", ") } : {}) };
}

function selectedAnswerValues(question: Record<string, unknown>, answerText: string): string[] {
  if (question.multi_select === true) {
    return answerText
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
  }
  return answerText.length > 0 ? [answerText] : [];
}

function questionOptions(question: Record<string, unknown>): Record<string, unknown>[] {
  return (Array.isArray(question.options) ? question.options : []).filter(isObject);
}

function normalizeSelectedLabels(selected: string[], options: Record<string, unknown>[]): string[] {
  const labelToId = uniqueOptionLabelToId(options);
  return selected.map((value) => labelToId.get(value) ?? value);
}

function knownOptionSet(options: Record<string, unknown>[]): Set<string> {
  const optionIds = stringSet(options.map((option) => option.id));
  return optionIds.size > 0 ? fallbackKnownValues(options) : stringSet(options.map((o) => o.label));
}

function fallbackKnownValues(options: Record<string, unknown>[]): Set<string> {
  const knownValues = new Set<string>();
  for (const option of options) {
    const id = option.id;
    const label = option.label;
    if (typeof id === "string") knownValues.add(id);
    else if (typeof label === "string") knownValues.add(label);
  }
  return knownValues;
}

function stringSet(values: unknown[]): Set<string> {
  return new Set(values.filter((value): value is string => typeof value === "string"));
}

function answersForQuery(query: Entry, output: unknown): Record<string, unknown> {
  const serialized = parseSerializedAnswers(output);
  if (serialized.size === 0) return {};
  const questions = queryQuestions(query);
  const fallback = questions.length === 1 && serialized.has("") ? serialized.get("") : undefined;
  const textCounts = questionTextCounts(questions);
  const out: Record<string, unknown> = {};
  for (const question of questions) {
    addQuestionAnswer(out, question, serialized, textCounts, fallback);
  }
  return out;
}

function questionTextCounts(questions: Record<string, unknown>[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const question of questions) {
    const text = typeof question.question === "string" ? question.question : undefined;
    if (text !== undefined) counts.set(text, (counts.get(text) ?? 0) + 1);
  }
  return counts;
}

function addQuestionAnswer(
  out: Record<string, unknown>,
  question: Record<string, unknown>,
  serialized: Map<string, string>,
  textCounts: Map<string, number>,
  fallback: string | undefined,
): void {
  const id = typeof question.id === "string" ? question.id : undefined;
  if (id === undefined) return;
  const answerText = answerForQuestion(question, serialized, textCounts) ?? fallback;
  if (answerText !== undefined) out[id] = selectedFor(question, answerText);
}

function answerForQuestion(
  question: Record<string, unknown>,
  serialized: Map<string, string>,
  textCounts: Map<string, number>,
): string | undefined {
  const text = typeof question.question === "string" ? question.question : undefined;
  return text !== undefined && textCounts.get(text) === 1 ? serialized.get(text) : undefined;
}

/** Fill permission `mode_change.from_mode` from the prior permission mode. */
export const ccPermissionModeDelta: ReconcilerRule = (entries) => {
  let prevMode: string | undefined;
  return entries.map((entry) => {
    if (entry.type !== "mode_change") return entry;
    const payload = entry.payload;
    if (payload?.scope !== "permission") return entry;
    const mode = typeof payload.to_mode === "string" ? payload.to_mode : undefined;
    if (mode === undefined) return entry;
    let next = entry;
    const nextPayload = {
      ...payload,
      trigger: prevMode === undefined ? "initial" : "runtime_inferred",
      ...(prevMode !== undefined && prevMode !== mode ? { from_mode: prevMode } : {}),
    } as typeof payload;
    next = { ...entry, payload: nextPayload };
    prevMode = mode;
    return next;
  });
};

export const ccTaskPlanDeltas: ReconcilerRule = (entries) => withTaskPlanDeltas(entries);

export const ccDropTaskPlanResults: ReconcilerRule = (entries) =>
  dropTaskPlanAckResults(entries, { sourceGroupKey: (entry) => hintOf(entry)?.sid });

export const ccVcsCommitEvents: ReconcilerRule = (entries) =>
  synthesizeVcsCommitEvents(entries, { idNamespace: CLAUDE_CODE_ENTRY_ID_NAMESPACE });

function hookFallbackPayload(entry: Entry): Entry["payload"] {
  const fields = hookFallbackFields(entry);
  return {
    kind: "hook_failed",
    text: fields.hookName !== undefined ? `Hook failed: ${fields.hookName}` : "Hook failed",
    data: hookFallbackData(fields),
  };
}

type HookFallbackFields = {
  hookName?: string;
  code?: string;
  details?: string;
};

function hookFallbackFields(entry: Entry): HookFallbackFields {
  const raw = isObject(entry.source?.raw) ? entry.source.raw : undefined;
  const attachment = isObject(raw?.attachment) ? raw.attachment : raw;
  const payload = entry.payload as { blocked_by?: unknown };
  return {
    ...hookNameField(attachment, payload),
    ...hookCodeField(attachment),
    ...hookDetailsField(attachment),
  };
}

function hookNameField(
  attachment: Record<string, unknown> | undefined,
  payload: { blocked_by?: unknown },
): Pick<HookFallbackFields, "hookName"> {
  const hookName = stringValue(attachment?.hookName) ?? stringValue(payload.blocked_by);
  return hookName !== undefined ? { hookName } : {};
}

function hookCodeField(
  attachment: Record<string, unknown> | undefined,
): Pick<HookFallbackFields, "code"> {
  const code = stringValue(attachment?.code);
  return code !== undefined ? { code } : {};
}

function hookDetailsField(
  attachment: Record<string, unknown> | undefined,
): Pick<HookFallbackFields, "details"> {
  const details = stringValue(attachment?.message);
  return details !== undefined ? { details } : {};
}

function hookFallbackData(fields: HookFallbackFields): Record<string, unknown> {
  return {
    severity: "error",
    blocking: true,
    ...(fields.hookName !== undefined ? { hook_name: fields.hookName } : {}),
    ...(fields.code !== undefined ? { code: fields.code } : {}),
    ...(fields.details !== undefined ? { details: fields.details } : {}),
  };
}

export const ccUnresolvedHookAbortFallback: ReconcilerRule = (entries) =>
  entries.map((entry) => {
    if (entry.type !== "tool_call_aborted") return entry;
    const payload = entry.payload as { scope?: unknown; reason?: unknown; for_id?: unknown };
    if (
      payload.scope !== "tool_call" ||
      payload.reason !== "hook_blocked" ||
      typeof payload.for_id === "string"
    ) {
      return entry;
    }
    return {
      ...entry,
      type: "system_event",
      payload: hookFallbackPayload(entry),
    } as Entry;
  });

function stripHint(entry: Entry): Entry {
  const m = entry.meta as Record<string, unknown> | undefined;
  if (m === undefined || !(HINT in m)) return entry;
  const { [HINT]: _drop, ...rest } = m;
  // v1 Claude Code entries carry no entry-level meta — drop it when only the
  // (now-removed) hint remained.
  if (Object.keys(rest).length > 0) return { ...entry, meta: rest };
  const { meta: _meta, ...withoutMeta } = entry;
  return withoutMeta as Entry;
}

/**
 * Backfill multi-block `source.raw.envelope_ref` (placeholder until now) to the
 * first entry id of the same source envelope (grouped by hint.sid), then strip
 * the transient hints.
 */
export const ccEnvelopeRefBackfill: ReconcilerRule = (entries) => {
  const firstEntryIdForSid = new Map<string, string>();
  for (const entry of entries) {
    const sid = hintOf(entry)?.sid;
    if (sid !== undefined && !firstEntryIdForSid.has(sid)) firstEntryIdForSid.set(sid, entry.id);
  }
  return entries.map((entry) => {
    const sid = hintOf(entry)?.sid;
    const source = entry.source;
    const raw = source?.raw;
    let next = entry;
    if (sid !== undefined && source !== undefined && raw !== undefined && "envelope_ref" in raw) {
      const firstId = firstEntryIdForSid.get(sid);
      if (firstId !== undefined) {
        next = {
          ...entry,
          source: {
            ...(source as NonNullable<Entry["source"]>),
            raw: { ...raw, envelope_ref: firstId },
          },
        };
      }
    }
    return stripHint(next);
  });
};
