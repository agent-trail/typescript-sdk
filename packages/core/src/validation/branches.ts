import type { SessionGroup, TrailDiagnostic } from "../index.js";
import { diagnostic, payloadString, readString } from "../shared.js";
import { headerSeenIds } from "./source-raw.js";

export function branchReferenceDiagnostics(group: SessionGroup): TrailDiagnostic[] {
  const diagnostics: TrailDiagnostic[] = [];
  const seen = headerSeenIds(group);
  for (const event of group.events) {
    if (event.record.type === "branch_point") {
      const fromId = payloadString(event.record, "from_id");
      if (fromId !== undefined && !seen.has(fromId)) {
        diagnostics.push(
          diagnostic(event.line, "/payload/from_id", "warning", "unknown_branch_point_from_id"),
        );
      }
    }
    if (event.record.type === "branch_summary") {
      const branchId = payloadString(event.record, "abandoned_branch_id");
      if (branchId !== undefined && !seen.has(branchId)) {
        diagnostics.push(
          diagnostic(
            event.line,
            "/payload/abandoned_branch_id",
            "warning",
            "unknown_abandoned_branch_id",
          ),
        );
      }
    }
    const id = readString(event.record, "id");
    if (id !== undefined) seen.add(id);
  }
  return diagnostics;
}
