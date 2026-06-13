import type { ParsedTrailRecord, SessionGroup, TrailDiagnostic } from "../index.js";
import { diagnostic, readString } from "../shared.js";

const isoMillisPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function timestampDiagnostics(
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
