import type { ParsedTrail } from "../index.js";
import { buildParsedTrail } from "../parse.js";
import { cloneRecord, firstHeader } from "../shared.js";
import { collectMergedEvents } from "./events.js";
import { appendHeaderMetadataReplayCorrections } from "./metadata.js";
import { parseFidelityForEvents } from "./parse-fidelity.js";

export function mergeSegments(trails: ParsedTrail[]): ParsedTrail {
  const mergedHeader = buildMergedHeader(trails);
  if (mergedHeader === undefined) return trails[0] ?? { records: [], groups: [] };
  const { events, latestSegmentEventStartIndex } = collectMergedEvents(trails);
  appendHeaderMetadataReplayCorrections(mergedHeader, events, trails, latestSegmentEventStartIndex);
  mergedHeader.parse_fidelity = parseFidelityForEvents(events);

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
