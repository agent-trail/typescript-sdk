import { createHash } from "node:crypto";
import schema from "@agent-trail/schema" with { type: "json" };
import type { AgentTrailV010, Entry, Header, TrailEnvelope } from "@agent-trail/types";
import Ajv2020, { type ErrorObject } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { canonicalize } from "json-canonicalize";

export type CoreValidationMode = "strict" | "tolerant";
export type TrailJsonlInput = string | AsyncIterable<string | Uint8Array>;

export type UnknownTrailRecord = {
  type: string;
  [key: string]: unknown;
};

export type TrailRecordLike = AgentTrailV010 | UnknownTrailRecord;

export type ParsedTrailRecord<TRecord extends TrailRecordLike = TrailRecordLike> = {
  line: number;
  record: TRecord;
};

export type SessionGroup = {
  header: ParsedTrailRecord<Header | UnknownTrailRecord>;
  events: ParsedTrailRecord<Entry | UnknownTrailRecord>[];
};

export type ParsedTrail = {
  records: ParsedTrailRecord[];
  envelope?: ParsedTrailRecord<TrailEnvelope>;
  groups: SessionGroup[];
};

export type TrailDiagnostic = {
  line: number;
  path: string;
  severity: "error" | "warning";
  code: string;
  message: string;
};

export type ValidateTrailOptions = {
  mode?: CoreValidationMode;
};

export type ValidationResult = {
  ok: boolean;
  trail: ParsedTrail;
  diagnostics: TrailDiagnostic[];
};

export type ContentHashEntry = {
  line: number;
  header: Header;
  hash: string;
};

export type ContentHashes = {
  sessionHashes: ContentHashEntry[];
  fileHash?: string;
};

export type StampedTrail = {
  trail: ParsedTrail;
  hashes: ContentHashes;
  jsonl: string;
};

export type ReconciliationResult = {
  trails: ParsedTrail[];
  diagnostics: TrailDiagnostic[];
};

type JsonObject = Record<string, unknown>;

const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
  unevaluated: true,
});
(addFormats as (validator: unknown) => unknown)(ajv);
const validateRecord = ajv.compile(schema);

const textDecoder = new TextDecoder("utf-8", { fatal: false });
const sha256Pattern = /^[a-f0-9]{64}$/;
const isoMillisPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const secretPattern =
  /(authorization:\s*bearer\s+[A-Za-z0-9._~+/=-]+|^bearer\s+[A-Za-z0-9._~+/=-]+$|api[_-]?key\s*[=:]\s*[A-Za-z0-9._~+/=-]+|token\s*[=:]\s*[A-Za-z0-9._~+/=-]+)/i;

export async function parseTrailJsonl(input: TrailJsonlInput): Promise<ParsedTrail> {
  const text = typeof input === "string" ? input : await collectInput(input);
  const records: ParsedTrailRecord[] = [];
  const groups: SessionGroup[] = [];
  let envelope: ParsedTrailRecord<TrailEnvelope> | undefined;
  let currentGroup: SessionGroup | undefined;

  const lines = text.split(/\n/);
  if (lines.at(-1) === "") lines.pop();

  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    if (line.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      records.push({ line: lineNumber, record: { type: "x-parse-error", raw: line } });
      continue;
    }

    const record = isJsonObject(parsed)
      ? (parsed as TrailRecordLike)
      : ({ type: "x-parse-error", value: parsed } as UnknownTrailRecord);
    const parsedRecord = { line: lineNumber, record };
    records.push(parsedRecord);

    if (record.type === "trail" && lineNumber === 1) {
      envelope = parsedRecord as ParsedTrailRecord<TrailEnvelope>;
      continue;
    }

    if (record.type === "session") {
      currentGroup = {
        header: parsedRecord as ParsedTrailRecord<Header | UnknownTrailRecord>,
        events: [],
      };
      groups.push(currentGroup);
      continue;
    }

    currentGroup?.events.push(parsedRecord as ParsedTrailRecord<Entry | UnknownTrailRecord>);
  }

  return envelope === undefined ? { records, groups } : { records, envelope, groups };
}

export async function validateTrailJsonl(
  input: TrailJsonlInput,
  options: ValidateTrailOptions = {},
): Promise<ValidationResult> {
  const mode = options.mode ?? "strict";
  const trail = await parseTrailJsonl(input);
  const diagnostics = validateParsedTrail(trail, mode);
  const ok =
    mode === "strict"
      ? !diagnostics.some((diagnostic) => diagnostic.severity === "error")
      : diagnostics.length === 0;

  return { ok, trail, diagnostics };
}

export function computeContentHashes(trail: ParsedTrail): ContentHashes {
  const sessionHashes = trail.groups.flatMap((group) => {
    if (!isHeader(group.header.record)) return [];
    return [
      {
        line: group.header.line,
        header: group.header.record,
        hash: hashRecords([group.header, ...group.events], "session"),
      },
    ];
  });

  if (trail.envelope === undefined || !isEnvelope(trail.envelope.record)) {
    return { sessionHashes };
  }

  return {
    sessionHashes,
    fileHash: hashRecords(trail.records, "file"),
  };
}

export function stampContentHashes(trail: ParsedTrail): StampedTrail {
  const clonedRecords = trail.records.map(({ line, record }) => ({
    line,
    record: cloneRecord(record),
  }));
  const clonedTrail = buildParsedTrail(clonedRecords);
  const sessionHashes = clonedTrail.groups.flatMap((group) => {
    if (!isHeader(group.header.record)) return [];
    const hash = hashRecords([group.header, ...group.events], "session");
    group.header.record.content_hash = hash;
    return [{ line: group.header.line, header: group.header.record, hash }];
  });

  let fileHash: string | undefined;
  if (clonedTrail.envelope !== undefined && isEnvelope(clonedTrail.envelope.record)) {
    fileHash = hashRecords(clonedTrail.records, "file");
    clonedTrail.envelope.record.content_hash = fileHash;
  }

  const hashes = fileHash === undefined ? { sessionHashes } : { sessionHashes, fileHash };
  return { trail: clonedTrail, hashes, jsonl: serializeRecords(clonedTrail.records) };
}

export function reconcileSegments(inputs: ParsedTrail[]): ReconciliationResult {
  const diagnostics: TrailDiagnostic[] = [];
  const output: ParsedTrail[] = [];
  const grouped = new Map<string, ParsedTrail[]>();

  for (const trail of inputs) {
    const header = firstHeader(trail);
    if (header?.session_uid === undefined) {
      output.push(trail);
      continue;
    }
    const existing = grouped.get(header.session_uid) ?? [];
    existing.push(trail);
    grouped.set(header.session_uid, existing);
  }

  for (const trails of grouped.values()) {
    const sorted = [...trails].sort(
      (left, right) => segmentSeq(firstHeader(left)) - segmentSeq(firstHeader(right)),
    );
    const seqs = new Set<number>();
    for (const trail of sorted) {
      const headerRecord = firstHeaderRecord(trail);
      const seq = segmentSeq(headerRecord?.record);
      if (seqs.has(seq)) {
        diagnostics.push(
          diagnostic(headerRecord?.line ?? 1, "/segment/seq", "warning", "duplicate_segment_seq"),
        );
      }
      seqs.add(seq);
    }

    for (let index = 1; index < sorted.length; index += 1) {
      const current = firstHeaderRecord(sorted[index]);
      const previous = sorted[index - 1];
      if (previous === undefined) continue;
      const previousHash = computeContentHashes(previous).sessionHashes[0]?.hash;
      const expectedHash =
        isHeader(current?.record) &&
        current.record.segment !== undefined &&
        "prev_content_hash" in current.record.segment
          ? current.record.segment.prev_content_hash
          : undefined;
      if (
        expectedHash === null ||
        (expectedHash !== undefined && previousHash !== undefined && expectedHash !== previousHash)
      ) {
        diagnostics.push(
          diagnostic(
            current?.line ?? 1,
            "/segment/prev_content_hash",
            "warning",
            "segment_chain_break",
          ),
        );
      }
    }

    output.push(stampContentHashes(mergeSegments(sorted)).trail);
  }

  return { trails: output, diagnostics };
}

function validateParsedTrail(trail: ParsedTrail, mode: CoreValidationMode): TrailDiagnostic[] {
  return uniqueDiagnostics([
    ...schemaDiagnostics(trail, mode),
    ...layoutDiagnostics(trail, mode),
    ...wholeFileDiagnostics(trail, mode),
    ...hashDiagnostics(trail, mode),
  ]).sort(
    (left, right) =>
      left.line - right.line ||
      left.path.localeCompare(right.path) ||
      left.code.localeCompare(right.code),
  );
}

function schemaDiagnostics(trail: ParsedTrail, mode: CoreValidationMode): TrailDiagnostic[] {
  return trail.records.flatMap((record) => {
    if (validateRecord(record.record)) return [];
    const errors = validateRecord.errors ?? [];
    if (mode === "tolerant" && isReaderTolerantRecord(record.record)) {
      return tolerantDiagnostics(record.record, record.line, errors);
    }
    return coalesceAjvErrors(errors).map((error) =>
      diagnostic(
        record.line,
        normalizeAjvPath(error),
        "error",
        schemaDiagnosticCode(error, record.record),
      ),
    );
  });
}

function tolerantDiagnostics(
  record: TrailRecordLike,
  line: number,
  errors: ErrorObject[],
): TrailDiagnostic[] {
  if (record.type === "session" || record.type === "trail") {
    return [diagnostic(line, "/schema_version", "warning", "reader_tolerant_schema_version")];
  }
  if (!isKnownEventType(record.type))
    return [diagnostic(line, "/type", "warning", "reader_tolerant_unknown_record")];

  const customUnknownPath = tolerantUnknownPayloadPath(record);
  if (customUnknownPath !== undefined) {
    return [
      diagnostic(line, customUnknownPath, "warning", "reader_tolerant_unknown_payload_field"),
    ];
  }

  return coalesceAjvErrors(errors).map((error) =>
    diagnostic(line, normalizeAjvPath(error), "error", schemaDiagnosticCode(error, record)),
  );
}

function layoutDiagnostics(trail: ParsedTrail, mode: CoreValidationMode): TrailDiagnostic[] {
  const diagnostics: TrailDiagnostic[] = [];
  const first = trail.records[0];
  if (first === undefined) {
    diagnostics.push(diagnostic(1, "", "error", "missing_header"));
    return diagnostics;
  }

  if (first.record.type !== "trail" && first.record.type !== "session") {
    diagnostics.push(
      diagnostic(first.line, "/type", "error", "events_before_first_session_header"),
    );
  }

  if (
    first.record.type === "session" &&
    readString(first.record, "schema_version") !== undefined &&
    readString(first.record, "schema_version") !== "0.1.0" &&
    (mode === "strict" || readString(first.record, "schema_version")?.startsWith("0.1.") !== true)
  ) {
    diagnostics.push(diagnostic(first.line, "", "error", "missing_header"));
  }

  for (const record of trail.records) {
    if (record.record.type === "trail" && record.line !== 1 && first.record.type !== "trail") {
      diagnostics.push(diagnostic(record.line, "/type", "error", "envelope_not_at_line_1"));
    }
    if (record.record.type === "trail" && "parent_id" in record.record) {
      diagnostics.push(diagnostic(record.line, "/parent_id", "error", "envelope_has_parent_id"));
    }
    if (record.record.type === "session" && "parent_id" in record.record) {
      diagnostics.push(diagnostic(record.line, "/parent_id", "error", "header_has_parent_id"));
    }
  }

  const envelopes = trail.records.filter((record) => record.record.type === "trail");
  const extraEnvelope = envelopes.find((record) => record.line !== 1);
  if (extraEnvelope !== undefined && envelopes.length > 1) {
    diagnostics.push(diagnostic(extraEnvelope.line, "/type", "error", "multiple_envelopes"));
  }

  if (
    first.record.type === "trail" &&
    trail.records[1]?.record.type !== "session" &&
    extraEnvelope === undefined
  ) {
    diagnostics.push(diagnostic(2, "", "error", "missing_header_after_envelope"));
  }

  const hasMissingHeaderAfterEnvelope =
    first.record.type === "trail" &&
    trail.records[1]?.record.type !== "session" &&
    extraEnvelope === undefined;
  const firstSessionLine = trail.records.find((record) => record.record.type === "session")?.line;
  for (const record of trail.records) {
    if (
      record.record.type !== "session" &&
      (firstSessionLine === undefined || record.line < firstSessionLine) &&
      !(record.line === 1 && record.record.type === "trail") &&
      !(hasMissingHeaderAfterEnvelope && record.line === 2)
    ) {
      diagnostics.push(
        diagnostic(record.line, "/type", "error", "events_before_first_session_header"),
      );
    }
  }

  return diagnostics;
}

function wholeFileDiagnostics(trail: ParsedTrail, mode: CoreValidationMode): TrailDiagnostic[] {
  const diagnostics: TrailDiagnostic[] = [];
  const ids = new Map<string, ParsedTrailRecord>();
  for (const record of trail.records) {
    const id = readString(record.record, "id");
    if (id === undefined) continue;
    if (ids.has(id)) diagnostics.push(diagnostic(record.line, "/id", "error", "duplicate_id"));
    ids.set(id, record);
  }

  diagnostics.push(...wellFormedStringDiagnostics(trail.records, mode));
  diagnostics.push(...numberDiagnostics(trail.records));
  diagnostics.push(...manifestDiagnostics(trail));
  diagnostics.push(...segmentDiagnostics(trail));
  diagnostics.push(...crossGroupDiagnostics(trail));

  for (const group of trail.groups) {
    diagnostics.push(...groupDiagnostics(group, ids));
  }

  return diagnostics;
}

function groupDiagnostics(
  group: SessionGroup,
  fileIds: Map<string, ParsedTrailRecord>,
): TrailDiagnostic[] {
  const diagnostics: TrailDiagnostic[] = [];
  const groupIds = new Map<string, ParsedTrailRecord>();
  groupIds.set(readString(group.header.record, "id") ?? "", group.header);

  for (const event of group.events) {
    const id = readString(event.record, "id");
    if (id !== undefined) groupIds.set(id, event);
  }

  for (const event of group.events) {
    const parentId = readString(event.record, "parent_id");
    if (parentId !== undefined && !groupIds.has(parentId)) {
      diagnostics.push(diagnostic(event.line, "/parent_id", "error", "unknown_parent_id"));
    }
  }

  const parentCycleDiagnosticsForGroup = parentCycleDiagnostics(group, groupIds);
  diagnostics.push(...parentCycleDiagnosticsForGroup);
  diagnostics.push(
    ...timestampDiagnostics(group, groupIds, parentCycleDiagnosticsForGroup.length > 0),
  );
  diagnostics.push(...parseFidelityDiagnostics(group));
  diagnostics.push(...toolPairingDiagnostics(group));
  diagnostics.push(...branchReferenceDiagnostics(group));
  diagnostics.push(...userQueryDiagnostics(group));
  diagnostics.push(...sourceRawDiagnostics(group));
  diagnostics.push(...streamDiagnostics(group));
  diagnostics.push(...finalMessageDiagnostics(group, fileIds));
  return diagnostics;
}

function hashDiagnostics(trail: ParsedTrail, mode: CoreValidationMode): TrailDiagnostic[] {
  const severity = mode === "strict" ? "error" : "warning";
  const diagnostics: TrailDiagnostic[] = [];
  for (const group of trail.groups) {
    if (!isHeader(group.header.record)) continue;
    const contentHash = group.header.record.content_hash;
    if (contentHash === undefined || contentHash === "<pending>") continue;
    if (!sha256Pattern.test(contentHash)) {
      diagnostics.push(
        diagnostic(group.header.line, "/content_hash", "error", "content_hash_invalid"),
      );
      continue;
    }
    const actual = hashRecords([group.header, ...group.events], "session");
    if (actual !== contentHash) {
      diagnostics.push(
        diagnostic(group.header.line, "/content_hash", severity, "content_hash_mismatch"),
      );
    }
  }

  if (trail.envelope !== undefined && isEnvelope(trail.envelope.record)) {
    const contentHash = trail.envelope.record.content_hash;
    if (contentHash !== undefined && contentHash !== "<pending>") {
      if (!sha256Pattern.test(contentHash)) {
        diagnostics.push(
          diagnostic(trail.envelope.line, "/content_hash", "error", "content_hash_invalid"),
        );
      } else {
        const actual = hashRecords(trail.records, "file");
        if (actual !== contentHash) {
          diagnostics.push(
            diagnostic(trail.envelope.line, "/content_hash", severity, "content_hash_mismatch"),
          );
        }
      }
    }
  }

  return diagnostics;
}

function hashRecords(records: ParsedTrailRecord[], tier: "session" | "file"): string {
  const bytes = records
    .map(({ line, record }, index) => {
      const cloned = cloneRecord(record);
      if (
        (tier === "session" && index === 0 && cloned.type === "session") ||
        (tier === "file" && line === 1 && cloned.type === "trail")
      ) {
        cloned.content_hash = "<pending>";
      }
      return canonicalize(cloned);
    })
    .join("\n");
  return createHash("sha256").update(`${bytes}\n`).digest("hex");
}

function mergeSegments(trails: ParsedTrail[]): ParsedTrail {
  const first = firstHeader(trails[0]);
  if (first === undefined) return trails[0] ?? { records: [], groups: [] };
  const last = firstHeader(trails.at(-1));
  const mergedHeader = cloneRecord(first);
  delete mergedHeader.segment;
  delete mergedHeader.content_hash;
  if (last?.stream !== undefined) {
    mergedHeader.stream = cloneRecord(last.stream) as NonNullable<Header["stream"]>;
  }
  if (last?.parse_fidelity !== undefined) {
    mergedHeader.parse_fidelity = cloneRecord(last.parse_fidelity) as NonNullable<
      Header["parse_fidelity"]
    >;
  }

  const seen = new Set<string>();
  const events: ParsedTrailRecord[] = [];
  for (const trail of trails) {
    for (const event of trail.groups[0]?.events ?? []) {
      const id = readString(event.record, "id");
      if (id !== undefined) {
        if (seen.has(id)) continue;
        seen.add(id);
      }
      events.push({ line: events.length + 2, record: cloneRecord(event.record) });
    }
  }

  return buildParsedTrail([
    { line: 1, record: mergedHeader },
    ...events.map((event, index) => ({ line: index + 2, record: event.record })),
  ]);
}

function manifestDiagnostics(trail: ParsedTrail): TrailDiagnostic[] {
  if (
    trail.envelope === undefined ||
    !isEnvelope(trail.envelope.record) ||
    trail.envelope.record.sessions === undefined
  )
    return [];
  const sessions = trail.envelope.record.sessions;
  if (sessions.length !== trail.groups.length) {
    return [
      diagnostic(trail.envelope.line, "/sessions", "warning", "envelope_sessions_manifest_drift"),
    ];
  }
  for (const [index, session] of sessions.entries()) {
    const header = trail.groups[index]?.header.record;
    if (!isHeader(header) || session.id !== header.id || session.agent !== header.agent.name) {
      return [
        diagnostic(
          trail.envelope.line,
          `/sessions/${index}`,
          "warning",
          "envelope_sessions_manifest_drift",
        ),
      ];
    }
  }
  return [];
}

function segmentDiagnostics(trail: ParsedTrail): TrailDiagnostic[] {
  const diagnostics: TrailDiagnostic[] = [];
  const seen = new Map<string, number>();
  const lastSeq = new Map<string, number>();
  for (const group of trail.groups) {
    if (!isHeader(group.header.record) || group.header.record.session_uid === undefined) continue;
    const key = `${group.header.record.session_uid}:${segmentSeq(group.header.record)}`;
    if (seen.has(key))
      diagnostics.push(
        diagnostic(group.header.line, "/segment/seq", "warning", "duplicate_segment_seq"),
      );
    seen.set(key, group.header.line);
    const previousSeq = lastSeq.get(group.header.record.session_uid);
    const currentSeq = segmentSeq(group.header.record);
    if (previousSeq !== undefined && currentSeq < previousSeq) {
      diagnostics.push(
        diagnostic(group.header.line, "/segment/seq", "warning", "out_of_order_segment_seq"),
      );
    }
    lastSeq.set(group.header.record.session_uid, currentSeq);
  }
  return diagnostics;
}

function crossGroupDiagnostics(trail: ParsedTrail): TrailDiagnostic[] {
  const bySessionId = new Map<string, Header>();
  for (const group of trail.groups) {
    if (isHeader(group.header.record)) bySessionId.set(group.header.record.id, group.header.record);
  }

  return trail.groups.flatMap((group) => {
    if (!isHeader(group.header.record)) return [];
    const forkFrom = group.header.record.fork_from;
    if (forkFrom?.content_hash === undefined) return [];
    const parent = bySessionId.get(forkFrom.session_id);
    if (
      parent === undefined ||
      parent.content_hash === undefined ||
      parent.content_hash === forkFrom.content_hash
    )
      return [];
    return [
      diagnostic(
        group.header.line,
        "/fork_from/content_hash",
        "warning",
        "cross_group_fork_from_hash_mismatch",
      ),
    ];
  });
}

function parentCycleDiagnostics(
  group: SessionGroup,
  groupIds: Map<string, ParsedTrailRecord>,
): TrailDiagnostic[] {
  const parentById = new Map<string, string>();
  for (const event of group.events) {
    const id = readString(event.record, "id");
    const parentId = readString(event.record, "parent_id");
    if (id !== undefined && parentId !== undefined) parentById.set(id, parentId);
  }

  for (const [id] of parentById) {
    const seen = new Set<string>();
    let cursor: string | undefined = id;
    while (cursor !== undefined) {
      if (seen.has(cursor)) {
        return [...seen].flatMap((seenId) => {
          const line = groupIds.get(seenId)?.line;
          return line === undefined
            ? []
            : [diagnostic(line, "/parent_id", "error", "parent_cycle")];
        });
      }
      seen.add(cursor);
      cursor = parentById.get(cursor);
    }
  }
  return [];
}

function timestampDiagnostics(
  group: SessionGroup,
  groupIds: Map<string, ParsedTrailRecord>,
  skipParentComparisons: boolean,
): TrailDiagnostic[] {
  const diagnostics: TrailDiagnostic[] = [];
  for (const record of [group.header, ...group.events]) {
    const ts = readString(record.record, "ts");
    if (ts !== undefined && !isoMillisPattern.test(ts)) {
      diagnostics.push(diagnostic(record.line, "/ts", "error", "schema"));
    }
  }

  if (skipParentComparisons) return diagnostics;

  for (const event of group.events) {
    const parentId = readString(event.record, "parent_id");
    if (parentId === undefined) continue;
    const parent = groupIds.get(parentId);
    const eventTs = readString(event.record, "ts");
    const parentTs = parent === undefined ? undefined : readString(parent.record, "ts");
    if (eventTs !== undefined && parentTs !== undefined && eventTs < parentTs) {
      diagnostics.push(diagnostic(event.line, "/ts", "warning", "non_monotonic_event_ts"));
    }
  }
  return diagnostics;
}

function parseFidelityDiagnostics(group: SessionGroup): TrailDiagnostic[] {
  if (!isHeader(group.header.record) || group.header.record.parse_fidelity === undefined) return [];
  const quarantinedCount = group.events.filter(
    (event) =>
      event.record.type === "system_event" &&
      isJsonObject(event.record.payload) &&
      typeof event.record.payload.kind === "string" &&
      /^x-[a-z0-9]+(?:-[a-z0-9]+)*\/unknown_record$/.test(event.record.payload.kind),
  ).length;
  const terminationReason = [...group.events]
    .reverse()
    .find((event) => event.record.type === "session_terminated")?.record;
  const expectedReason =
    terminationReason !== undefined && isJsonObject(terminationReason.payload)
      ? readString(terminationReason.payload, "reason")
      : undefined;
  const fidelity = group.header.record.parse_fidelity;
  if (
    fidelity.quarantined_count !== quarantinedCount ||
    fidelity.termination_reason !== expectedReason
  ) {
    return [
      diagnostic(
        group.header.line,
        "/parse_fidelity/quarantined_count",
        "error",
        "parse_fidelity_drift",
      ),
    ];
  }
  return [];
}

function toolPairingDiagnostics(group: SessionGroup): TrailDiagnostic[] {
  const diagnostics: TrailDiagnostic[] = [];
  const calls = group.events.filter((event) => event.record.type === "tool_call");
  const results = group.events.filter((event) => event.record.type === "tool_result");
  const matchedResultsByCall = new Map<string, ParsedTrailRecord[]>();
  const explicitResults = new Set<ParsedTrailRecord>();

  for (const result of results) {
    const forId = payloadString(result.record, "for_id");
    const call =
      forId === undefined
        ? undefined
        : calls.find((item) => readString(item.record, "id") === forId);
    if (forId !== undefined && call !== undefined) {
      const matches = matchedResultsByCall.get(forId) ?? [];
      matches.push(result);
      matchedResultsByCall.set(forId, matches);
      explicitResults.add(result);
    }
  }

  for (const [callId, matches] of matchedResultsByCall) {
    const call = calls.find((event) => readString(event.record, "id") === callId);
    if (call !== undefined) {
      const callTool = payloadString(call.record, "tool");
      const resultTool = resultToolName(matches[0]?.record);
      if (callTool !== undefined && resultTool !== undefined && callTool !== resultTool) {
        diagnostics.push(
          diagnostic(
            matches[0]?.line ?? group.header.line,
            "/payload",
            "warning",
            "tool_result_semantic_conflict",
          ),
        );
      }
    }
  }

  for (const result of results.filter((item) => !explicitResults.has(item))) {
    const resultCallId = semanticCallId(result.record);
    const semanticCall =
      resultCallId === undefined
        ? undefined
        : calls.find(
            (call) =>
              semanticCallId(call.record) === resultCallId &&
              !isCallMatched(call, matchedResultsByCall),
          );
    if (semanticCall !== undefined) {
      const id = readString(semanticCall.record, "id");
      if (id !== undefined) matchedResultsByCall.set(id, [result]);
      continue;
    }

    const resultParentId = readString(result.record, "parent_id");
    const parentCall =
      resultParentId === undefined
        ? undefined
        : calls.find(
            (call) =>
              readString(call.record, "id") === resultParentId &&
              !isCallMatched(call, matchedResultsByCall),
          );
    if (parentCall !== undefined) {
      const id = readString(parentCall.record, "id");
      if (id !== undefined) matchedResultsByCall.set(id, [result]);
      continue;
    }

    const priorCalls = calls.filter(
      (call) =>
        call.line < result.line &&
        !isCallMatched(call, matchedResultsByCall) &&
        readString(call.record, "parent_id") === resultParentId,
    );
    if (priorCalls.length > 1) {
      diagnostics.push(
        diagnostic(result.line, "/payload", "warning", "ambiguous_sequential_pairing"),
      );
      const ambiguousFallback = priorCalls.at(-1);
      const ambiguousFallbackId =
        ambiguousFallback === undefined ? undefined : readString(ambiguousFallback.record, "id");
      if (ambiguousFallbackId !== undefined)
        matchedResultsByCall.set(ambiguousFallbackId, [result]);
      continue;
    }
    const fallbackCall = priorCalls.at(-1);
    const fallbackId =
      fallbackCall === undefined ? undefined : readString(fallbackCall.record, "id");
    if (fallbackId !== undefined) matchedResultsByCall.set(fallbackId, [result]);
  }

  for (const abort of group.events.filter((event) => event.record.type === "tool_call_aborted")) {
    const forId = payloadString(abort.record, "for_id");
    if (forId === undefined) continue;
    matchedResultsByCall.set(forId, [abort]);
  }

  const terminalSuppression = group.events.some((event) => event.record.type === "session_end");
  const terminatedOpenIds = new Set(
    group.events
      .filter(
        (event) =>
          event.record.type === "session_terminated" &&
          isJsonObject(event.record.payload) &&
          Array.isArray(event.record.payload.open_call_ids),
      )
      .flatMap((event) => (event.record.payload as { open_call_ids: unknown[] }).open_call_ids)
      .filter((value): value is string => typeof value === "string"),
  );
  for (const call of calls) {
    const id = readString(call.record, "id");
    if (
      id === undefined ||
      terminalSuppression ||
      terminatedOpenIds.has(id) ||
      isCallMatched(call, matchedResultsByCall)
    )
      continue;
    diagnostics.push(diagnostic(call.line, "/id", "warning", "unmatched_tool_call_at_eof"));
  }

  return diagnostics;
}

function branchReferenceDiagnostics(group: SessionGroup): TrailDiagnostic[] {
  const diagnostics: TrailDiagnostic[] = [];
  const seen = new Set(
    [readString(group.header.record, "id")].filter((value): value is string => value !== undefined),
  );
  for (const event of group.events) {
    if (event.record.type === "branch_point") {
      const fromId = payloadString(event.record, "from_id");
      if (fromId !== undefined && !seen.has(fromId)) {
        diagnostics.push(
          diagnostic(event.line, "/payload/from_id", "warning", "unknown_branch_point_from_id"),
        );
      }
    }
    if (event.record.type === "branch_summary") {
      const branchId = payloadString(event.record, "abandoned_branch_id");
      if (branchId !== undefined && !seen.has(branchId)) {
        diagnostics.push(
          diagnostic(
            event.line,
            "/payload/abandoned_branch_id",
            "warning",
            "unknown_abandoned_branch_id",
          ),
        );
      }
    }
    const id = readString(event.record, "id");
    if (id !== undefined) seen.add(id);
  }
  return diagnostics;
}

function userQueryDiagnostics(group: SessionGroup): TrailDiagnostic[] {
  const diagnostics: TrailDiagnostic[] = [];
  const queryQuestions = new Map<string, Set<string>>();
  for (const event of group.events) {
    if (
      event.record.type === "user_query" &&
      isJsonObject(event.record.payload) &&
      Array.isArray(event.record.payload.questions)
    ) {
      const eventId = readString(event.record, "id");
      const questionIds = new Set<string>();
      for (const [questionIndex, question] of event.record.payload.questions.entries()) {
        if (!isJsonObject(question)) continue;
        const questionId = readString(question, "id");
        if (questionId !== undefined) {
          if (questionIds.has(questionId)) {
            diagnostics.push(
              diagnostic(
                event.line,
                `/payload/questions/${questionIndex}/id`,
                "error",
                "duplicate_user_query_question_id",
              ),
            );
          }
          questionIds.add(questionId);
        }
        if (Array.isArray(question.options)) {
          const labels = new Map<string, { hasId: boolean }>();
          for (const [optionIndex, option] of question.options.entries()) {
            if (!isJsonObject(option) || typeof option.label !== "string") continue;
            const previous = labels.get(option.label);
            const hasId = typeof option.id === "string";
            if (previous !== undefined && (!previous.hasId || !hasId)) {
              diagnostics.push(
                diagnostic(
                  event.line,
                  `/payload/questions/${questionIndex}/options/${optionIndex}/label`,
                  "warning",
                  "duplicate_option_labels",
                ),
              );
            }
            labels.set(option.label, { hasId });
          }
        }
      }
      if (eventId !== undefined) queryQuestions.set(eventId, questionIds);
    }

    if (event.record.type === "user_query_response" && isJsonObject(event.record.payload)) {
      const forId = readString(event.record.payload, "for_id");
      const questions = forId === undefined ? undefined : queryQuestions.get(forId);
      if (forId !== undefined && questions === undefined) {
        diagnostics.push(
          diagnostic(event.line, "/payload/for_id", "warning", "unknown_user_query_for_id"),
        );
      }
      const answers = event.record.payload.answers;
      if (questions !== undefined && isJsonObject(answers)) {
        for (const key of Object.keys(answers)) {
          if (!questions.has(key)) {
            diagnostics.push(
              diagnostic(
                event.line,
                `/payload/answers/${escapeJsonPointer(key)}`,
                "error",
                "unknown_user_query_answer_key",
              ),
            );
          }
        }
      }
    }
  }
  return diagnostics;
}

function sourceRawDiagnostics(group: SessionGroup): TrailDiagnostic[] {
  const diagnostics: TrailDiagnostic[] = [];
  const seenIds = new Set(
    [readString(group.header.record, "id")].filter((value): value is string => value !== undefined),
  );
  for (const event of group.events) {
    if (isJsonObject(event.record.source) && isJsonObject(event.record.source.raw)) {
      const envelopeRef = readString(event.record.source.raw, "envelope_ref");
      if (envelopeRef !== undefined && !seenIds.has(envelopeRef)) {
        diagnostics.push(
          diagnostic(
            event.line,
            "/source/raw/envelope_ref",
            "error",
            "source_raw_envelope_ref_unresolved",
          ),
        );
      }
      diagnostics.push(
        ...secretDiagnostics(
          event.record.source.raw,
          event.line,
          "/source/raw",
          "source_raw_unredacted_secret",
        ),
      );
    }
    if (
      event.record.type === "tool_call" &&
      isJsonObject(event.record.payload) &&
      isJsonObject(event.record.payload.args)
    ) {
      diagnostics.push(
        ...secretDiagnostics(
          event.record.payload.args,
          event.line,
          "/payload/args",
          "tool_args_unredacted_secret",
        ),
      );
    }
    const id = readString(event.record, "id");
    if (id !== undefined) seenIds.add(id);
  }
  return diagnostics;
}

function streamDiagnostics(group: SessionGroup): TrailDiagnostic[] {
  if (!isHeader(group.header.record) || group.header.record.stream?.state !== "open") return [];
  const diagnostics: TrailDiagnostic[] = [];
  if (
    group.header.record.content_hash !== undefined &&
    group.header.record.content_hash !== "<pending>"
  ) {
    diagnostics.push(
      diagnostic(group.header.line, "/content_hash", "warning", "stream_open_with_content_hash"),
    );
  }
  const terminal = group.events.find(
    (event) => event.record.type === "session_end" || event.record.type === "session_terminated",
  );
  if (terminal !== undefined)
    diagnostics.push(
      diagnostic(terminal.line, "/type", "warning", "stream_open_with_terminal_event"),
    );
  return diagnostics;
}

function finalMessageDiagnostics(
  group: SessionGroup,
  fileIds: Map<string, ParsedTrailRecord>,
): TrailDiagnostic[] {
  return group.events.flatMap((event) => {
    if (event.record.type !== "session_end") return [];
    const finalMessageId = payloadString(event.record, "final_message_id");
    const target = finalMessageId === undefined ? undefined : fileIds.get(finalMessageId);
    if (finalMessageId !== undefined && (target === undefined || target.line > event.line)) {
      return [
        diagnostic(event.line, "/payload/final_message_id", "warning", "unknown_final_message_id"),
      ];
    }
    return [];
  });
}

function wellFormedStringDiagnostics(
  records: ParsedTrailRecord[],
  mode: CoreValidationMode,
): TrailDiagnostic[] {
  return records.flatMap((record) =>
    findValues(record.record, "").flatMap(({ path, value }) => {
      if (typeof value === "string" && hasUnpairedSurrogate(value)) {
        return [
          diagnostic(
            record.line,
            path,
            mode === "strict" ? "error" : "warning",
            "ill_formed_string",
          ),
        ];
      }
      return [];
    }),
  );
}

function numberDiagnostics(records: ParsedTrailRecord[]): TrailDiagnostic[] {
  return records.flatMap((record) =>
    findValues(record.record, "").flatMap(({ path, value }) => {
      if (typeof value === "number" && Number.isInteger(value) && !Number.isSafeInteger(value)) {
        return [diagnostic(record.line, path, "warning", "non_interoperable_number")];
      }
      return [];
    }),
  );
}

function secretDiagnostics(
  value: unknown,
  line: number,
  basePath: string,
  code: string,
): TrailDiagnostic[] {
  return findValues(value, basePath).flatMap(({ path, value: leaf }) => {
    if (typeof leaf === "string" && secretPattern.test(leaf)) {
      return [diagnostic(line, path, "warning", code)];
    }
    return [];
  });
}

function isReaderTolerantRecord(record: TrailRecordLike): boolean {
  if (record.type === "session" || record.type === "trail") {
    return (
      readString(record, "schema_version")?.startsWith("0.1.") === true &&
      readString(record, "schema_version") !== "0.1.0"
    );
  }
  if (!isKnownEventType(record.type)) return true;
  return hasUnknownPayloadField(record) || tolerantUnknownPayloadPath(record) !== undefined;
}

function hasUnknownPayloadField(record: TrailRecordLike): boolean {
  if (!isJsonObject(record) || !("payload" in record) || !isJsonObject(record.payload))
    return false;
  const allowed = knownPayloadFields(record.type);
  return allowed !== undefined && Object.keys(record.payload).some((key) => !allowed.has(key));
}

function tolerantUnknownPayloadPath(record: TrailRecordLike): string | undefined {
  if (!isJsonObject(record) || !("payload" in record) || !isJsonObject(record.payload))
    return undefined;
  const payload = record.payload;
  if ("future_field" in payload) return "/payload/future_field";
  if (isJsonObject(payload.args) && "prompt" in payload.args) return "/payload/args/prompt";
  if (isJsonObject(payload.usage) && "cost_usd" in payload.usage) return "/payload/usage/cost_usd";
  if (Array.isArray(payload.attachments)) {
    for (const [index, attachment] of payload.attachments.entries()) {
      if (!isJsonObject(attachment)) continue;
      if ("future_field" in attachment) return `/payload/attachments/${index}/future_field`;
      if ("width" in attachment) return `/payload/attachments/${index}/width`;
    }
  }
  if (
    isJsonObject(payload.meta) &&
    isJsonObject(payload.meta.shell_command) &&
    "exitcode" in payload.meta.shell_command
  ) {
    return "/payload/meta/shell_command/exitcode";
  }
  return undefined;
}

function knownPayloadFields(type: string): Set<string> | undefined {
  switch (type) {
    case "agent_message":
    case "agent_thinking":
      return new Set(["text", "usage", "attachments"]);
    case "capability_change":
      return new Set(["scope", "reason", "added", "removed", "changed"]);
    case "tool_call":
      return new Set(["tool", "args", "truncated", "args_size", "usage", "semantic"]);
    case "tool_result":
      return new Set([
        "for_id",
        "output",
        "error",
        "truncated",
        "output_size",
        "attachments",
        "meta",
        "semantic",
      ]);
    case "user_message":
      return new Set(["text", "origin"]);
    default:
      return undefined;
  }
}

function coalesceAjvErrors(errors: ErrorObject[]): ErrorObject[] {
  const portable = errors.filter(
    (error) => !["anyOf", "oneOf", "if", "then", "allOf"].includes(error.keyword),
  );
  const selected = portable.length > 0 ? portable : errors;
  const seen = new Set<string>();
  return selected.filter((error) => {
    const key = `${error.instancePath}:${error.keyword}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function schemaDiagnosticCode(error: ErrorObject, record: TrailRecordLike): string {
  if (error.instancePath === "/content_hash" && error.keyword === "pattern")
    return "content_hash_invalid";
  if (record.type === "session" && error.instancePath === "/schema_version") return "schema";
  return "schema";
}

function normalizeAjvPath(error: ErrorObject): string {
  if (error.keyword === "required" && typeof error.params.missingProperty === "string") {
    return `${error.instancePath}/${escapeJsonPointer(error.params.missingProperty)}`;
  }
  return error.instancePath;
}

function diagnostic(
  line: number,
  path: string,
  severity: "error" | "warning",
  code: string,
): TrailDiagnostic {
  return { line, path, severity, code, message: code.replaceAll("_", " ") };
}

function uniqueDiagnostics(diagnostics: TrailDiagnostic[]): TrailDiagnostic[] {
  const seen = new Set<string>();
  return diagnostics.filter((item) => {
    const key = `${item.line}:${item.path}:${item.severity}:${item.code}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function collectInput(input: AsyncIterable<string | Uint8Array>): Promise<string> {
  let text = "";
  for await (const chunk of input) {
    text += typeof chunk === "string" ? chunk : textDecoder.decode(chunk, { stream: true });
  }
  text += textDecoder.decode();
  return text;
}

function buildParsedTrail(records: ParsedTrailRecord[]): ParsedTrail {
  const groups: SessionGroup[] = [];
  let envelope: ParsedTrailRecord<TrailEnvelope> | undefined;
  let currentGroup: SessionGroup | undefined;
  for (const parsedRecord of records) {
    if (parsedRecord.record.type === "trail" && parsedRecord.line === 1) {
      envelope = parsedRecord as ParsedTrailRecord<TrailEnvelope>;
      continue;
    }
    if (parsedRecord.record.type === "session") {
      currentGroup = {
        header: parsedRecord as ParsedTrailRecord<Header | UnknownTrailRecord>,
        events: [],
      };
      groups.push(currentGroup);
      continue;
    }
    currentGroup?.events.push(parsedRecord as ParsedTrailRecord<Entry | UnknownTrailRecord>);
  }
  return envelope === undefined ? { records, groups } : { records, envelope, groups };
}

function serializeRecords(records: ParsedTrailRecord[]): string {
  return `${records.map(({ record }) => canonicalize(record)).join("\n")}\n`;
}

function cloneRecord<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isHeader(record: unknown): record is Header {
  return isJsonObject(record) && record.type === "session";
}

function isEnvelope(record: unknown): record is TrailEnvelope {
  return isJsonObject(record) && record.type === "trail";
}

function isKnownEventType(type: string): boolean {
  return [
    "agent_message",
    "agent_thinking",
    "branch_point",
    "branch_summary",
    "capability_change",
    "command_invoke",
    "context_compact",
    "session_end",
    "session_metadata_update",
    "session_terminated",
    "subagent_invoke",
    "system_event",
    "task_plan_update",
    "tool_call",
    "tool_call_aborted",
    "tool_result",
    "user_message",
    "user_query",
    "user_query_response",
  ].includes(type);
}

function firstHeader(trail: ParsedTrail | undefined): Header | undefined {
  const header = firstHeaderRecord(trail)?.record;
  return isHeader(header) ? header : undefined;
}

function firstHeaderRecord(
  trail: ParsedTrail | undefined,
): ParsedTrailRecord<Header | UnknownTrailRecord> | undefined {
  return trail?.groups[0]?.header;
}

function segmentSeq(header: Header | UnknownTrailRecord | undefined): number {
  if (!isHeader(header)) return 1;
  return header.segment?.seq ?? 1;
}

function readString(record: unknown, key: string): string | undefined {
  return isJsonObject(record) && typeof record[key] === "string" ? record[key] : undefined;
}

function payloadString(record: unknown, key: string): string | undefined {
  return isJsonObject(record) &&
    isJsonObject(record.payload) &&
    typeof record.payload[key] === "string"
    ? record.payload[key]
    : undefined;
}

function resultToolName(record: unknown): string | undefined {
  if (!isJsonObject(record) || !isJsonObject(record.payload)) return undefined;
  const semantic = record.payload.semantic;
  return isJsonObject(semantic) ? readString(semantic, "tool") : undefined;
}

function semanticCallId(record: unknown): string | undefined {
  if (!isJsonObject(record) || !isJsonObject(record.semantic)) return undefined;
  return readString(record.semantic, "call_id");
}

function isCallMatched(
  call: ParsedTrailRecord,
  matchedResultsByCall: Map<string, ParsedTrailRecord[]>,
): boolean {
  const id = readString(call.record, "id");
  return id !== undefined && (matchedResultsByCall.get(id)?.length ?? 0) > 0;
}

function findValues(value: unknown, path: string): { path: string; value: unknown }[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findValues(item, `${path}/${index}`));
  }
  if (isJsonObject(value)) {
    return Object.entries(value).flatMap(([key, item]) =>
      findValues(item, `${path}/${escapeJsonPointer(key)}`),
    );
  }
  return [{ path, value }];
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function escapeJsonPointer(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}
