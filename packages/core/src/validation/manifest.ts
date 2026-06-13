import type { ParsedTrail, TrailDiagnostic } from "../index.js";
import { diagnostic, isEnvelope, isHeader } from "../shared.js";

export function manifestDiagnostics(trail: ParsedTrail): TrailDiagnostic[] {
  if (
    trail.envelope === undefined ||
    !isEnvelope(trail.envelope.record) ||
    trail.envelope.record.sessions === undefined
  )
    return [];
  const sessions = trail.envelope.record.sessions;
  if (sessions.length !== trail.groups.length) {
    return [
      diagnostic(trail.envelope.line, "/sessions", "warning", "envelope_sessions_manifest_drift"),
    ];
  }
  for (const [index, session] of sessions.entries()) {
    const header = trail.groups[index]?.header.record;
    if (!isHeader(header) || session.id !== header.id || session.agent !== header.agent.name) {
      return [
        diagnostic(
          trail.envelope.line,
          `/sessions/${index}`,
          "warning",
          "envelope_sessions_manifest_drift",
        ),
      ];
    }
  }
  return [];
}
