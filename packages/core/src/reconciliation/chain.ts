import type { Header } from "@agent-trail/types";
import { computeContentHashes } from "../hashing.js";
import type { ParsedTrail, ParsedTrailRecord, TrailDiagnostic } from "../index.js";
import { diagnostic, firstHeaderRecord, isHeader, segmentSeq } from "../shared.js";

export function validateSegmentChain(trails: ParsedTrail[]): {
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
