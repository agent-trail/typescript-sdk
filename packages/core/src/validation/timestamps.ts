import type { ParsedTrailRecord, SessionGroup, TrailDiagnostic } from "../index.js";
import { diagnostic, isJsonObject, readString } from "../shared.js";

const isoMillisPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function timestampDiagnostics(
  group: SessionGroup,
  groupIds: Map<string, ParsedTrailRecord>,
  skipParentComparisons: boolean,
): TrailDiagnostic[] {
  if (skipParentComparisons) return [];
  return parentTimestampDiagnostics(group.events, groupIds);
}

export function timestampSyntaxDiagnostics(records: ParsedTrailRecord[]): TrailDiagnostic[] {
  return records.flatMap((record) => timestampSyntaxDiagnostic(record));
}

function timestampSyntaxDiagnostic(record: ParsedTrailRecord): TrailDiagnostic[] {
  return [
    ...timestampValueDiagnostic(record, "/ts", readString(record.record, "ts")),
    ...timestampValueDiagnostic(record, "/stream/started_at", streamStartedAt(record.record)),
  ];
}

function timestampValueDiagnostic(
  record: ParsedTrailRecord,
  path: string,
  value: string | undefined,
): TrailDiagnostic[] {
  if (value === undefined) return [];
  if (!isoMillisPattern.test(value)) return [diagnostic(record.line, path, "error", "schema")];
  if (!isValidUtcIsoMillis(value))
    return [diagnostic(record.line, path, "error", "invalid_timestamp")];
  return [];
}

function streamStartedAt(record: unknown): string | undefined {
  if (!isJsonObject(record) || !isJsonObject(record.stream)) return undefined;
  return readString(record.stream, "started_at");
}

function parentTimestampDiagnostics(
  events: ParsedTrailRecord[],
  groupIds: Map<string, ParsedTrailRecord>,
): TrailDiagnostic[] {
  return events.flatMap((event) =>
    isBeforeParentTimestamp(event, groupIds)
      ? [diagnostic(event.line, "/ts", "warning", "non_monotonic_event_ts")]
      : [],
  );
}

function isBeforeParentTimestamp(
  event: ParsedTrailRecord,
  groupIds: Map<string, ParsedTrailRecord>,
): boolean {
  const parentId = readString(event.record, "parent_id");
  const parent = parentId === undefined ? undefined : groupIds.get(parentId);
  const eventTs = readString(event.record, "ts");
  const parentTs = parent === undefined ? undefined : readString(parent.record, "ts");
  return eventTs !== undefined && parentTs !== undefined && eventTs < parentTs;
}

function isValidUtcIsoMillis(value: string): boolean {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}
