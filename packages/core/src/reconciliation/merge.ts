import type { Header } from "@agent-trail/types";
import type { ParsedTrail, ParsedTrailRecord } from "../index.js";
import { buildParsedTrail } from "../parse.js";
import { cloneRecord, firstHeader, readString } from "../shared.js";

export function mergeSegments(trails: ParsedTrail[]): ParsedTrail {
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
