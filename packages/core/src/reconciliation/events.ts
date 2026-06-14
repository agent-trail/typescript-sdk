import type { ParsedTrail, ParsedTrailRecord } from "../index.js";
import { cloneRecord, isJsonObject, readString } from "../shared.js";

export type MergedEvents = {
  events: ParsedTrailRecord[];
  latestSegmentEventStartIndex: number;
};

export function collectMergedEvents(trails: ParsedTrail[]): MergedEvents {
  const seen = new Set<string>();
  const events: ParsedTrailRecord[] = [];
  let latestSegmentEventStartIndex = 0;

  for (const [index, trail] of trails.entries()) {
    const isFinal = index === trails.length - 1;
    if (isFinal) latestSegmentEventStartIndex = events.length;
    appendSegmentEvents(events, seen, trail, isFinal);
  }

  return { events, latestSegmentEventStartIndex };
}

function appendSegmentEvents(
  events: ParsedTrailRecord[],
  seen: Set<string>,
  trail: ParsedTrail,
  isFinal: boolean,
): void {
  for (const event of trail.groups[0]?.events ?? []) {
    if (!isFinal && isProcessTerminated(event.record)) break;
    if (hasSeenEventId(event, seen)) continue;
    events.push({ line: events.length + 2, record: cloneRecord(event.record) });
  }
}

function hasSeenEventId(event: ParsedTrailRecord, seen: Set<string>): boolean {
  const id = readString(event.record, "id");
  if (id === undefined) return false;
  if (seen.has(id)) return true;
  seen.add(id);
  return false;
}

function isProcessTerminated(record: unknown): boolean {
  return (
    isJsonObject(record) &&
    record.type === "session_terminated" &&
    isJsonObject(record.payload) &&
    record.payload.reason === "process_terminated"
  );
}
