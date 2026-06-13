import type { ParsedTrailRecord, SessionGroup, TrailDiagnostic } from "../index.js";
import { diagnostic, readString } from "../shared.js";

const isoMillisPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function timestampDiagnostics(
  group: SessionGroup,
  groupIds: Map<string, ParsedTrailRecord>,
  skipParentComparisons: boolean,
): TrailDiagnostic[] {
  const diagnostics = timestampSyntaxDiagnostics([group.header, ...group.events]);
  if (skipParentComparisons) return diagnostics;

  diagnostics.push(...parentTimestampDiagnostics(group.events, groupIds));
  return diagnostics;
}

function timestampSyntaxDiagnostics(records: ParsedTrailRecord[]): TrailDiagnostic[] {
  return records.flatMap((record) => timestampSyntaxDiagnostic(record));
}

function timestampSyntaxDiagnostic(record: ParsedTrailRecord): TrailDiagnostic[] {
  const ts = readString(record.record, "ts");
  if (ts === undefined) return [];
  if (!isoMillisPattern.test(ts)) return [diagnostic(record.line, "/ts", "error", "schema")];
  if (!isValidUtcIsoMillis(ts))
    return [diagnostic(record.line, "/ts", "error", "invalid_timestamp")];
  return [];
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
