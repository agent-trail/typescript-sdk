import type { Header } from "@agent-trail/types";
import type { ParsedTrail, TrailDiagnostic } from "../index.js";
import { diagnostic, isHeader } from "../shared.js";

export function crossGroupDiagnostics(trail: ParsedTrail): TrailDiagnostic[] {
  const bySessionId = new Map<string, Header>();
  for (const group of trail.groups) {
    if (isHeader(group.header.record)) bySessionId.set(group.header.record.id, group.header.record);
  }

  return trail.groups.flatMap((group) => {
    if (!isHeader(group.header.record)) return [];
    const forkFrom = group.header.record.fork_from;
    if (forkFrom?.content_hash === undefined) return [];
    const parent = bySessionId.get(forkFrom.session_id);
    if (
      parent === undefined ||
      parent.content_hash === undefined ||
      parent.content_hash === forkFrom.content_hash
    )
      return [];
    return [
      diagnostic(
        group.header.line,
        "/fork_from/content_hash",
        "warning",
        "cross_group_fork_from_hash_mismatch",
      ),
    ];
  });
}
