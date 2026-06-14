import type { TrailDiagnostic } from "../index.js";
import { diagnostic, payloadString } from "../shared.js";
import type { GroupValidationContext } from "./context.js";

export function branchReferenceDiagnostics(context: GroupValidationContext): TrailDiagnostic[] {
  const diagnostics: TrailDiagnostic[] = [];
  for (const event of context.group.events) {
    if (event.record.type === "branch_point") {
      const fromId = payloadString(event.record, "from_id");
      if (fromId !== undefined && !context.graph.hasPriorId(fromId, event)) {
        diagnostics.push(
          diagnostic(event.line, "/payload/from_id", "warning", "unknown_branch_point_from_id"),
        );
      }
    }
    if (event.record.type === "branch_summary") {
      const branchId = payloadString(event.record, "abandoned_branch_id");
      if (branchId !== undefined && !context.graph.hasPriorId(branchId, event)) {
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
  }
  return diagnostics;
}
