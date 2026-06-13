import { createHash } from "node:crypto";
import type { ParsedTrail, ParsedTrailRecord } from "../index.js";
import { firstHeader, isJsonObject, readString } from "../shared.js";

const headerMetadataFields = ["name", "description", "tags"] as const;
type HeaderMetadataField = (typeof headerMetadataFields)[number];
type HeaderMetadataValue = string | string[];
type EffectiveMetadata = Partial<Record<HeaderMetadataField, HeaderMetadataValue>>;

export function appendHeaderMetadataReplayCorrections(
  header: Record<string, unknown>,
  events: ParsedTrailRecord[],
  trails: ParsedTrail[],
  insertionIndex: number,
): void {
  const sessionUid = readString(header, "session_uid") ?? readString(firstHeader(trails[0]), "id");
  if (sessionUid === undefined) return;

  const effective = effectiveMetadataAtInsertion(header, events, insertionIndex);
  const seenEventIds = eventIds(events);
  let correctionIndex = Math.max(0, Math.min(insertionIndex, events.length));

  for (const field of headerMetadataFields) {
    const correction = correctionForField(
      header,
      effective,
      field,
      sessionUid,
      seenEventIds,
      latestTimestamp(header, events.slice(0, correctionIndex)),
    );
    if (correction === undefined) continue;
    seenEventIds.add(readString(correction.record, "id") ?? "");
    events.splice(correctionIndex, 0, { ...correction, line: correctionIndex + 2 });
    correctionIndex += 1;
  }
}

function effectiveMetadataAtInsertion(
  header: Record<string, unknown>,
  events: ParsedTrailRecord[],
  insertionIndex: number,
): EffectiveMetadata {
  const effective = headerMetadata(header);
  for (const event of events.slice(0, insertionIndex)) {
    applyMetadataUpdate(effective, event);
  }
  return effective;
}

function headerMetadata(header: Record<string, unknown>): EffectiveMetadata {
  const effective: EffectiveMetadata = {};
  for (const field of headerMetadataFields) {
    const value = metadataValueForField(field, header[field]);
    if (value !== undefined) effective[field] = value;
  }
  return effective;
}

function applyMetadataUpdate(effective: EffectiveMetadata, event: ParsedTrailRecord): void {
  const payload = metadataUpdatePayload(event);
  if (payload === undefined) return;
  const next = metadataValueForField(payload.field, payload.value);
  if (next !== undefined) effective[payload.field] = next;
}

function correctionForField(
  header: Record<string, unknown>,
  effective: EffectiveMetadata,
  field: HeaderMetadataField,
  sessionUid: string,
  seenEventIds: Set<string>,
  ts: string,
): ParsedTrailRecord | undefined {
  const target = metadataValueForField(field, header[field]);
  if (target === undefined || metadataEqual(effective[field], target)) return undefined;

  const previousValue = effective[field];
  const id = synthesizedMetadataUpdateId(sessionUid, field, target, seenEventIds);
  effective[field] = target;
  return {
    line: 1,
    record: {
      type: "session_metadata_update",
      id,
      ts,
      payload: correctionPayload(field, target, previousValue),
      source: {
        agent: "x-agent-trail/reconciler",
        original_type: "reconcile.header_metadata_late_bind",
        synthesized: true,
      },
    },
  };
}

function correctionPayload(
  field: HeaderMetadataField,
  target: HeaderMetadataValue,
  previousValue: HeaderMetadataValue | undefined,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    field,
    value: cloneMetadataValue(target),
    reason: "runtime_inferred",
  };
  if (previousValue !== undefined) payload.previous_value = cloneMetadataValue(previousValue);
  return payload;
}

function metadataUpdatePayload(
  event: ParsedTrailRecord,
): { field: HeaderMetadataField; value: unknown } | undefined {
  if (!isJsonObject(event.record) || event.record.type !== "session_metadata_update") return;
  const payload = event.record.payload;
  if (!isJsonObject(payload) || !isHeaderMetadataField(payload.field)) return;
  return { field: payload.field, value: payload.value };
}

function eventIds(events: ParsedTrailRecord[]): Set<string> {
  return new Set(events.flatMap((event) => idList(event.record)));
}

function idList(record: unknown): string[] {
  const id = readString(record, "id");
  return id === undefined ? [] : [id];
}

function latestTimestamp(header: Record<string, unknown>, events: ParsedTrailRecord[]): string {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const ts = readString(events[index]?.record, "ts");
    if (ts !== undefined) return ts;
  }
  return readString(header, "ts") ?? "1970-01-01T00:00:00.000Z";
}

function isHeaderMetadataField(value: unknown): value is HeaderMetadataField {
  return value === "name" || value === "description" || value === "tags";
}

function metadataValueForField(
  field: HeaderMetadataField,
  value: unknown,
): HeaderMetadataValue | undefined {
  if (field === "tags") {
    return Array.isArray(value) && value.every((tag) => typeof tag === "string")
      ? [...value]
      : undefined;
  }
  return typeof value === "string" ? value : undefined;
}

function metadataEqual(left: HeaderMetadataValue | undefined, right: HeaderMetadataValue): boolean {
  if (left === undefined) return false;
  if (!Array.isArray(left) && !Array.isArray(right)) return left === right;
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function cloneMetadataValue(value: HeaderMetadataValue): HeaderMetadataValue {
  return Array.isArray(value) ? [...value] : value;
}

function synthesizedMetadataUpdateId(
  sessionUid: string,
  field: HeaderMetadataField,
  value: HeaderMetadataValue,
  seenEventIds: Set<string>,
): string {
  for (let attempt = 0; ; attempt += 1) {
    const id = createHash("sha256")
      .update(
        JSON.stringify({
          kind: "agent-trail/reconcile-header-metadata",
          sessionUid,
          field,
          value,
          attempt,
        }),
      )
      .digest("hex")
      .slice(0, 32);
    if (!seenEventIds.has(id)) return id;
  }
}
