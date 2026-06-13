import type { Header } from "@agent-trail/types";
import { computeContentHashes, stampContentHashes } from "./hashing.js";
import { buildParsedTrail } from "./parse.js";
import {
  cloneRecord,
  diagnostic,
  firstHeader,
  firstHeaderRecord,
  hasSegment,
  isHeader,
  readString,
  segmentSeq,
} from "./shared.js";
import type {
  ParsedTrail,
  ParsedTrailRecord,
  ReconciliationResult,
  TrailDiagnostic,
} from "./types.js";

export function reconcileSegments(inputs: ParsedTrail[]): ReconciliationResult {
  const diagnostics: TrailDiagnostic[] = [];
  const output: ParsedTrail[] = [];
  const grouped = groupReconciliationInputs(inputs, output);

  for (const trails of grouped.values()) {
    const sorted = sortSegments(trails);
    const chain = validateSegmentChain(sorted);
    diagnostics.push(...chain.diagnostics);

    output.push(...(chain.canMerge ? [stampContentHashes(mergeSegments(sorted)).trail] : sorted));
  }

  return { trails: output, diagnostics };
}

function groupReconciliationInputs(
  inputs: ParsedTrail[],
  passThrough: ParsedTrail[],
): Map<string, ParsedTrail[]> {
  const grouped = new Map<string, ParsedTrail[]>();
  const sessionUidCounts = countSessionUids(inputs);

  for (const trail of inputs) {
    const header = firstHeader(trail);
    if (
      header?.session_uid === undefined ||
      (!hasSegment(trail) && sessionUidCounts.get(header.session_uid) === 1)
    ) {
      passThrough.push(trail);
      continue;
    }
    const existing = grouped.get(header.session_uid) ?? [];
    existing.push(trail);
    grouped.set(header.session_uid, existing);
  }

  return grouped;
}

function countSessionUids(inputs: ParsedTrail[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const trail of inputs) {
    const sessionUid = firstHeader(trail)?.session_uid;
    if (sessionUid !== undefined) counts.set(sessionUid, (counts.get(sessionUid) ?? 0) + 1);
  }
  return counts;
}

function sortSegments(trails: ParsedTrail[]): ParsedTrail[] {
  return [...trails].sort(
    (left, right) => segmentSeq(firstHeader(left)) - segmentSeq(firstHeader(right)),
  );
}

function validateSegmentChain(trails: ParsedTrail[]): {
  canMerge: boolean;
  diagnostics: TrailDiagnostic[];
} {
  const diagnostics = [...duplicateSeqDiagnostics(trails), ...prevHashDiagnostics(trails)];
  return { canMerge: diagnostics.length === 0, diagnostics };
}

function duplicateSeqDiagnostics(trails: ParsedTrail[]): TrailDiagnostic[] {
  const diagnostics: TrailDiagnostic[] = [];
  const seqs = new Set<number>();
  for (const trail of trails) {
    const headerRecord = firstHeaderRecord(trail);
    const seq = segmentSeq(headerRecord?.record);
    if (seqs.has(seq)) {
      diagnostics.push(
        diagnostic(headerRecord?.line ?? 1, "/segment/seq", "error", "duplicate_segment_seq"),
      );
    }
    seqs.add(seq);
  }
  return diagnostics;
}

function prevHashDiagnostics(trails: ParsedTrail[]): TrailDiagnostic[] {
  const diagnostics: TrailDiagnostic[] = [];
  for (let index = 1; index < trails.length; index += 1) {
    const current = firstHeaderRecord(trails[index]);
    const previous = trails[index - 1];
    if (previous === undefined || isExpectedPrevHash(current, previous)) continue;
    diagnostics.push(
      diagnostic(current?.line ?? 1, "/segment/prev_content_hash", "error", "segment_chain_break"),
    );
  }
  return diagnostics;
}

function isExpectedPrevHash(
  current: ParsedTrailRecord<Header> | ParsedTrailRecord | undefined,
  previous: ParsedTrail,
): boolean {
  const currentRecord = current?.record;
  const previousHash = computeContentHashes(previous).sessionHashes[0]?.hash;
  if (
    !isHeader(currentRecord) ||
    currentRecord.segment === undefined ||
    !("prev_content_hash" in currentRecord.segment)
  )
    return false;
  return currentRecord.segment.prev_content_hash === previousHash;
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
