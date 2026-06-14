import type { TrailDiagnostic } from "../index.js";
import { deriveParseFidelity } from "../parse-fidelity/index.js";
import { diagnostic, isHeader } from "../shared.js";
import type { GroupValidationContext } from "./context.js";

export function parseFidelityDiagnostics(context: GroupValidationContext): TrailDiagnostic[] {
  const { group } = context;
  if (!isHeader(group.header.record) || group.header.record.parse_fidelity === undefined) return [];
  const expected = deriveParseFidelity(group.events);
  const fidelity = group.header.record.parse_fidelity;
  const diagnostics: TrailDiagnostic[] = [];
  if (fidelity.quarantined_count !== expected.quarantined_count) {
    diagnostics.push(
      diagnostic(
        group.header.line,
        "/parse_fidelity/quarantined_count",
        "error",
        "parse_fidelity_drift",
      ),
    );
  }
  if (fidelity.termination_reason !== expected.termination_reason) {
    diagnostics.push(
      diagnostic(
        group.header.line,
        "/parse_fidelity/termination_reason",
        "error",
        "parse_fidelity_drift",
      ),
    );
  }
  return diagnostics;
}
