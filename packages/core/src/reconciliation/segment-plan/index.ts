import { computeContentHashes } from "../../hashing.js";
import type { ParsedTrail, ParsedTrailRecord, TrailDiagnostic } from "../../index.js";
import { buildParsedTrail } from "../../parse.js";
import {
  diagnostic,
  firstHeader,
  firstHeaderRecord,
  isHeader,
  isJsonObject,
  segmentSeq,
} from "../../shared.js";

export type SegmentMergeGroup = {
  sessionUid: string;
  trails: ParsedTrail[];
  shouldFinalize: boolean;
};

export type SegmentPlan = {
  passThrough: ParsedTrail[];
  mergeGroups: SegmentMergeGroup[];
  diagnostics: TrailDiagnostic[];
};

export function buildSegmentPlan(inputs: ParsedTrail[]): SegmentPlan {
  const passThrough: ParsedTrail[] = [];
  const mergeGroups: SegmentMergeGroup[] = [];
  const diagnostics: TrailDiagnostic[] = [];
  const sessionInputs = explodeMultiSessionInputs(inputs);
  const sessionUidCounts = countSessionUids(sessionInputs);
  const grouped = groupMergeInputs(sessionInputs, sessionUidCounts, passThrough);

  for (const [sessionUid, trails] of grouped) {
    const sorted = sortSegments(trails);
    diagnostics.push(...segmentChainDiagnostics(sorted));
    mergeGroups.push({
      sessionUid,
      trails: sorted,
      shouldFinalize: !isOpenStream(firstHeader(sorted.at(-1))?.stream),
    });
  }

  return { passThrough, mergeGroups, diagnostics };
}

function groupMergeInputs(
  inputs: ParsedTrail[],
  sessionUidCounts: Map<string, number>,
  passThrough: ParsedTrail[],
): Map<string, ParsedTrail[]> {
  const grouped = new Map<string, ParsedTrail[]>();
  for (const trail of inputs) {
    const sessionUid = firstHeader(trail)?.session_uid;
    if (sessionUid === undefined || sessionUidCounts.get(sessionUid) === 1) {
      passThrough.push(trail);
      continue;
    }
    const existing = grouped.get(sessionUid) ?? [];
    existing.push(trail);
    grouped.set(sessionUid, existing);
  }
  return grouped;
}

function explodeMultiSessionInputs(inputs: ParsedTrail[]): ParsedTrail[] {
  return inputs.flatMap((trail) => {
    if (trail.groups.length <= 1) return [trail];
    return trail.groups.map((group) => buildParsedTrail([group.header, ...group.events]));
  });
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

function segmentChainDiagnostics(trails: ParsedTrail[]): TrailDiagnostic[] {
  return [...duplicateSeqDiagnostics(trails), ...prevHashDiagnostics(trails)];
}

function duplicateSeqDiagnostics(trails: ParsedTrail[]): TrailDiagnostic[] {
  const diagnostics: TrailDiagnostic[] = [];
  const seqs = new Set<number>();
  for (const trail of trails) {
    const headerRecord = firstHeaderRecord(trail);
    const seq = segmentSeq(headerRecord?.record);
    if (seqs.has(seq)) {
      diagnostics.push(
        diagnostic(headerRecord?.line ?? 1, "/segment/seq", "warning", "duplicate_segment_seq"),
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
      diagnostic(
        current?.line ?? 1,
        "/segment/prev_content_hash",
        "warning",
        "segment_chain_break",
      ),
    );
  }
  return diagnostics;
}

function isExpectedPrevHash(
  current: ParsedTrailRecord | undefined,
  previous: ParsedTrail,
): boolean {
  const currentRecord = current?.record;
  const previousHash = computeContentHashes(previous).sessionHashes[0]?.hash;
  if (
    !isHeader(currentRecord) ||
    currentRecord.segment === undefined ||
    !("prev_content_hash" in currentRecord.segment)
  )
    return true;
  return currentRecord.segment.prev_content_hash === previousHash;
}

function isOpenStream(stream: unknown): boolean {
  return isJsonObject(stream) && stream.state === "open";
}
