import type { SessionGroup, TrailDiagnostic } from "../index.js";
import { diagnostic, isHeader, isJsonObject, readString } from "../shared.js";

export function parseFidelityDiagnostics(group: SessionGroup): TrailDiagnostic[] {
  if (!isHeader(group.header.record) || group.header.record.parse_fidelity === undefined) return [];
  const quarantinedCount = group.events.filter(
    (event) =>
      event.record.type === "system_event" &&
      isJsonObject(event.record.payload) &&
      typeof event.record.payload.kind === "string" &&
      /^x-[a-z0-9]+(?:-[a-z0-9]+)*\/unknown_record$/.test(event.record.payload.kind),
  ).length;
  const terminationReason = [...group.events]
    .reverse()
    .find((event) => event.record.type === "session_terminated")?.record;
  const expectedReason =
    terminationReason !== undefined && isJsonObject(terminationReason.payload)
      ? readString(terminationReason.payload, "reason")
      : undefined;
  const fidelity = group.header.record.parse_fidelity;
  const diagnostics: TrailDiagnostic[] = [];
  if (fidelity.quarantined_count !== quarantinedCount) {
    diagnostics.push(
      diagnostic(
        group.header.line,
        "/parse_fidelity/quarantined_count",
        "error",
        "parse_fidelity_drift",
      ),
    );
  }
  if (fidelity.termination_reason !== expectedReason) {
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
