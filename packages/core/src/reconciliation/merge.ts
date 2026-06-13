import type { ParsedTrail, ParsedTrailRecord } from "../index.js";
import { buildParsedTrail } from "../parse.js";
import { cloneRecord, firstHeader, readString } from "../shared.js";

export function mergeSegments(trails: ParsedTrail[]): ParsedTrail {
  const mergedHeader = buildMergedHeader(trails);
  if (mergedHeader === undefined) return trails[0] ?? { records: [], groups: [] };
  const events = mergedEvents(trails);

  return buildParsedTrail([
    { line: 1, record: mergedHeader },
    ...events.map((event, index) => ({ line: index + 2, record: event.record })),
  ]);
}

function buildMergedHeader(trails: ParsedTrail[]) {
  const first = firstHeader(trails[0]);
  if (first === undefined) return undefined;
  const last = firstHeader(trails.at(-1));
  const mergedHeader = cloneRecord(last ?? first);
  delete mergedHeader.segment;
  delete mergedHeader.content_hash;
  mergedHeader.id = first.id;
  mergedHeader.type = first.type;
  mergedHeader.schema_version = first.schema_version;
  if (first.session_uid === undefined) {
    delete mergedHeader.session_uid;
  } else {
    mergedHeader.session_uid = first.session_uid;
  }
  mergedHeader.ts = first.ts;
  return mergedHeader;
}

function mergedEvents(trails: ParsedTrail[]): ParsedTrailRecord[] {
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
  return events;
}
