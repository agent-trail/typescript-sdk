import type { ParsedTrail } from "../index.js";
import { buildParsedTrail } from "../parse.js";
import { firstHeader, hasSegment, segmentSeq } from "../shared.js";

export function groupReconciliationInputs(
  inputs: ParsedTrail[],
  passThrough: ParsedTrail[],
): Map<string, ParsedTrail[]> {
  const grouped = new Map<string, ParsedTrail[]>();
  const sessionInputs = explodeMultiSessionInputs(inputs);
  const sessionUidCounts = countSessionUids(sessionInputs);

  for (const trail of sessionInputs) {
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

export function sortSegments(trails: ParsedTrail[]): ParsedTrail[] {
  return [...trails].sort(
    (left, right) => segmentSeq(firstHeader(left)) - segmentSeq(firstHeader(right)),
  );
}
