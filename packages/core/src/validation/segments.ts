import type { TrailDiagnostic } from "../index.js";
import { diagnostic, isHeader, segmentSeq } from "../shared.js";
import type { ValidationContext } from "./context.js";

export function segmentDiagnostics(context: ValidationContext): TrailDiagnostic[] {
  const diagnostics: TrailDiagnostic[] = [];
  const seen = new Map<string, number>();
  const lastSeq = new Map<string, number>();
  for (const group of context.trail.groups) {
    if (!isHeader(group.header.record) || group.header.record.session_uid === undefined) continue;
    const key = `${group.header.record.session_uid}:${segmentSeq(group.header.record)}`;
    if (seen.has(key))
      diagnostics.push(
        diagnostic(group.header.line, "/segment/seq", "warning", "duplicate_segment_seq"),
      );
    seen.set(key, group.header.line);
    const previousSeq = lastSeq.get(group.header.record.session_uid);
    const currentSeq = segmentSeq(group.header.record);
    if (previousSeq !== undefined && currentSeq < previousSeq) {
      diagnostics.push(
        diagnostic(group.header.line, "/segment/seq", "warning", "out_of_order_segment_seq"),
      );
    }
    lastSeq.set(group.header.record.session_uid, currentSeq);
  }
  return diagnostics;
}
