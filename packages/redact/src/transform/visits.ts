import type { RedactionRecord } from "./records.js";

export type Visit = {
  recordIndex: number;
  location: string;
  identity: object;
  key?: string;
  get: () => string;
  set: (next: string) => void;
};

function arrayVisit(
  container: unknown[],
  index: number,
  recordIndex: number,
  location: string,
): Visit {
  return {
    recordIndex,
    location,
    identity: container,
    key: String(index),
    get: () => container[index] as string,
    set: (next) => {
      container[index] = next;
    },
  };
}

export function keyVisit(
  container: Record<string, unknown>,
  key: string,
  recordIndex: number,
  location: string,
): Visit {
  return {
    recordIndex,
    location,
    identity: container,
    key,
    get: () => container[key] as string,
    set: (next) => {
      container[key] = next;
    },
  };
}

function* walkContainer(
  container: Record<string, unknown> | unknown[],
  recordIndex: number,
  prefix: string,
): Generator<Visit> {
  if (Array.isArray(container)) yield* walkArray(container, recordIndex, prefix);
  else yield* walkObject(container, recordIndex, prefix);
}

function* walkArray(container: unknown[], recordIndex: number, prefix: string): Generator<Visit> {
  for (let i = 0; i < container.length; i += 1) {
    yield* visitChild(container[i], recordIndex, `${prefix}[${i}]`, () =>
      arrayVisit(container, i, recordIndex, `${prefix}[${i}]`),
    );
  }
}

function* walkObject(
  container: Record<string, unknown>,
  recordIndex: number,
  prefix: string,
): Generator<Visit> {
  for (const [key, child] of Object.entries(container)) {
    yield* visitChild(child, recordIndex, `${prefix}.${key}`, () =>
      keyVisit(container, key, recordIndex, `${prefix}.${key}`),
    );
  }
}

function* visitChild(
  child: unknown,
  recordIndex: number,
  path: string,
  stringVisit: () => Visit,
): Generator<Visit> {
  if (typeof child === "string") {
    yield stringVisit();
  } else if (child !== null && typeof child === "object") {
    yield* walkContainer(child as Record<string, unknown> | unknown[], recordIndex, path);
  }
}

const TEXT_PAYLOAD_TYPES = new Set<string>([
  "agent_message",
  "user_message",
  "session_summary",
  "agent_thinking",
  "system_event",
]);

const REASON_PAYLOAD_TYPES = new Set<string>(["user_interrupt", "branch_point"]);
const SUMMARY_PAYLOAD_TYPES = new Set<string>(["context_compact", "branch_summary"]);

// Attachment references (image/file uris) appear on user_message, agent_message,
// and tool_result payloads (spec §9.2). They carry potentially sensitive uris
// (local file: paths leaking home/username, https: with tokens), so scrub them
// the same way wherever they appear.
function* visitAttachments(payload: Record<string, unknown>, index: number): Generator<Visit> {
  const attachments = payload.attachments;
  if (!Array.isArray(attachments)) return;
  for (let i = 0; i < attachments.length; i += 1) {
    const a = attachments[i];
    if (a === null || typeof a !== "object") continue;
    const obj = a as Record<string, unknown>;
    if (typeof obj.uri === "string") {
      yield keyVisit(obj, "uri", index, `records[${index}].payload.attachments[${i}].uri`);
    }
    if (typeof obj.name === "string") {
      yield keyVisit(obj, "name", index, `records[${index}].payload.attachments[${i}].name`);
    }
  }
}

function* visitObjectMember(
  container: Record<string, unknown>,
  key: string,
  recordIndex: number,
  path: string,
): Generator<Visit> {
  const value = container[key];
  if (typeof value === "string") {
    yield keyVisit(container, key, recordIndex, path);
  } else if (value !== null && typeof value === "object") {
    yield* walkContainer(value as Record<string, unknown> | unknown[], recordIndex, path);
  }
}

function* visitLabelMetadata(value: Record<string, unknown>, index: number): Generator<Visit> {
  for (const key of ["name", "description", "tags"] as const) {
    yield* visitObjectMember(value, key, index, `records[${index}].${key}`);
  }
}

export function* visitStrings(
  records: RedactionRecord[],
  includeSourceRaw: boolean,
): Generator<Visit> {
  for (const [index, record] of records.entries()) {
    const value = record.value as Record<string, unknown>;
    const payload = value.payload;
    const type = value.type;

    yield* uniqueVisits([
      visitRecordHeaderStrings(value, type, index),
      visitParseErrorStrings(value, type, index),
      visitPayloadStrings(payload, type, index),
      visitRecordMetaStrings(value, index),
      includeSourceRaw ? visitSourceRawStrings(value, type, index) : [],
    ]);
  }
}

function* uniqueVisits(sources: Iterable<Visit>[]): Generator<Visit> {
  const seen = new WeakMap<object, Set<string | undefined>>();
  for (const source of sources) {
    for (const visit of source) {
      const keys = seen.get(visit.identity);
      if (keys?.has(visit.key)) continue;
      if (keys === undefined) {
        seen.set(visit.identity, new Set([visit.key]));
      } else {
        keys.add(visit.key);
      }
      yield visit;
    }
  }
}

function* visitParseErrorStrings(
  value: Record<string, unknown>,
  type: unknown,
  index: number,
): Generator<Visit> {
  if (type !== "x-parse-error") return;
  if (typeof value.raw === "string") {
    yield keyVisit(value, "raw", index, `records[${index}].raw`);
  }
  yield* visitObjectMember(value, "value", index, `records[${index}].value`);
}

function* visitRecordHeaderStrings(
  value: Record<string, unknown>,
  type: unknown,
  index: number,
): Generator<Visit> {
  if (type !== "session" && type !== "trail") return;
  yield* visitLabelMetadata(value, index);
  const vcs = value.vcs as Record<string, unknown> | undefined;
  if (vcs !== undefined) yield* visitVcsStrings(vcs, index, `records[${index}].vcs`);
  if (type !== "session") return;
  if (typeof value.cwd === "string") yield keyVisit(value, "cwd", index, `records[${index}].cwd`);
  const source = value.source as Record<string, unknown> | undefined;
  if (source !== undefined && typeof source.path === "string") {
    yield keyVisit(source, "path", index, `records[${index}].source.path`);
  }
}

function* visitPayloadStrings(payload: unknown, type: unknown, index: number): Generator<Visit> {
  if (payload === null || typeof payload !== "object") return;
  const payloadRecord = payload as Record<string, unknown>;
  yield* visitTextLikePayload(payloadRecord, type, index);
  yield* visitStructuredPayload(payloadRecord, type, index);
  yield* visitToolPayload(payloadRecord, type, index);
  yield* visitForwardCompatiblePayload(payloadRecord, type, index);
}

function* visitTextLikePayload(
  payload: Record<string, unknown>,
  type: unknown,
  index: number,
): Generator<Visit> {
  if (TEXT_PAYLOAD_TYPES.has(type as string) && typeof payload.text === "string") {
    yield keyVisit(payload, "text", index, `records[${index}].payload.text`);
  }
  if (REASON_PAYLOAD_TYPES.has(type as string) && typeof payload.reason === "string") {
    yield keyVisit(payload, "reason", index, `records[${index}].payload.reason`);
  }
  if (SUMMARY_PAYLOAD_TYPES.has(type as string) && typeof payload.summary === "string") {
    yield keyVisit(payload, "summary", index, `records[${index}].payload.summary`);
  }
  if (type === "tool_call_aborted" && typeof payload.blocked_by === "string") {
    yield keyVisit(payload, "blocked_by", index, `records[${index}].payload.blocked_by`);
  }
}

function* visitStructuredPayload(
  payload: Record<string, unknown>,
  type: unknown,
  index: number,
): Generator<Visit> {
  if (type === "user_message" || type === "agent_message") yield* visitAttachments(payload, index);
  if (type === "user_query" || type === "user_query_response" || type === "capability_change") {
    yield* walkContainer(payload, index, `records[${index}].payload`);
  }
  if (type === "system_event") {
    yield* visitObjectMember(payload, "data", index, `records[${index}].payload.data`);
  }
  if (type === "session_metadata_update") {
    yield* visitSessionMetadataUpdatePayload(payload, index);
  }
}

function* visitToolPayload(
  payload: Record<string, unknown>,
  type: unknown,
  index: number,
): Generator<Visit> {
  if (type === "tool_call") {
    yield* visitObjectMember(payload, "args", index, `records[${index}].payload.args`);
  }
  if (type !== "tool_result") return;
  if (typeof payload.output === "string") {
    yield keyVisit(payload, "output", index, `records[${index}].payload.output`);
  }
  if (typeof payload.error === "string") {
    yield keyVisit(payload, "error", index, `records[${index}].payload.error`);
  }
  yield* visitAttachments(payload, index);
  yield* visitObjectMember(payload, "meta", index, `records[${index}].payload.meta`);
}

function* visitForwardCompatiblePayload(
  payload: Record<string, unknown>,
  _type: unknown,
  index: number,
): Generator<Visit> {
  yield* walkContainer(payload, index, `records[${index}].payload`);
}

function* visitSessionMetadataUpdatePayload(
  payload: Record<string, unknown>,
  index: number,
): Generator<Visit> {
  if (payload.field === "vcs.worktree") {
    yield* visitWorktreeMetadataMember(payload, "value", index, `records[${index}].payload.value`);
    yield* visitWorktreeMetadataMember(
      payload,
      "previous_value",
      index,
      `records[${index}].payload.previous_value`,
    );
    return;
  }
  yield* visitObjectMember(payload, "value", index, `records[${index}].payload.value`);
  yield* visitObjectMember(
    payload,
    "previous_value",
    index,
    `records[${index}].payload.previous_value`,
  );
}

function* visitRecordMetaStrings(value: Record<string, unknown>, index: number): Generator<Visit> {
  const meta = value.meta;
  if (meta !== null && typeof meta === "object") {
    yield* walkContainer(
      meta as Record<string, unknown> | unknown[],
      index,
      `records[${index}].meta`,
    );
  }
}

function* visitSourceRawStrings(
  value: Record<string, unknown>,
  type: unknown,
  index: number,
): Generator<Visit> {
  if (type === "session") return;
  const source = value.source as Record<string, unknown> | undefined;
  const raw = source?.raw;
  if (raw !== undefined && raw !== null && typeof raw === "object") {
    yield* walkContainer(
      raw as Record<string, unknown> | unknown[],
      index,
      `records[${index}].source.raw`,
    );
  } else if (typeof raw === "string" && source !== undefined) {
    yield keyVisit(source, "raw", index, `records[${index}].source.raw`);
  }
}

function* visitVcsStrings(
  vcs: Record<string, unknown>,
  recordIndex: number,
  path: string,
): Generator<Visit> {
  if (typeof vcs.branch === "string") yield keyVisit(vcs, "branch", recordIndex, `${path}.branch`);
  const worktree = vcs.worktree as Record<string, unknown> | undefined;
  if (worktree === undefined) return;
  yield* visitWorktreeStrings(worktree, recordIndex, `${path}.worktree`);
}

function* visitWorktreeMetadataMember(
  container: Record<string, unknown>,
  key: "value" | "previous_value",
  recordIndex: number,
  path: string,
): Generator<Visit> {
  const value = container[key];
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    yield* visitWorktreeStrings(value as Record<string, unknown>, recordIndex, path);
  }
}

function* visitWorktreeStrings(
  worktree: Record<string, unknown>,
  recordIndex: number,
  path: string,
): Generator<Visit> {
  for (const key of ["name", "path", "original_cwd", "original_branch"] as const) {
    if (typeof worktree[key] === "string") {
      yield keyVisit(worktree, key, recordIndex, `${path}.${key}`);
    }
  }
}
