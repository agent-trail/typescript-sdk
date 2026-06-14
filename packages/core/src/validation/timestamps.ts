import type { ParsedTrailRecord, TrailDiagnostic } from "../index.js";
import { diagnostic, isJsonObject, readString } from "../shared.js";
import type { GroupValidationContext, ValidationContext } from "./context.js";
import type { SessionGraph } from "./session-graph.js";

const isoMillisPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function timestampDiagnostics(context: GroupValidationContext): TrailDiagnostic[] {
  if (context.hasParentCycles) return [];
  return parentTimestampDiagnostics(context.group.events, context.graph);
}

export function timestampSyntaxDiagnostics(context: ValidationContext): TrailDiagnostic[] {
  return context.trail.records.flatMap((record) => timestampSyntaxDiagnostic(record));
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
  graph: SessionGraph,
): TrailDiagnostic[] {
  return events.flatMap((event) =>
    isBeforeParentTimestamp(event, graph)
      ? [diagnostic(event.line, "/ts", "warning", "non_monotonic_event_ts")]
      : [],
  );
}

function isBeforeParentTimestamp(event: ParsedTrailRecord, graph: SessionGraph): boolean {
  const parent = graph.parentRecord(event);
  const eventTs = readString(event.record, "ts");
  const parentTs = parent === undefined ? undefined : readString(parent.record, "ts");
  if (eventTs === undefined || parentTs === undefined) return false;
  if (!isValidUtcIsoMillis(eventTs) || !isValidUtcIsoMillis(parentTs)) return false;
  return eventTs < parentTs;
}

function isValidUtcIsoMillis(value: string): boolean {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}
