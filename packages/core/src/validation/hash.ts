import { hashRecords } from "../hashing.js";
import type { CoreValidationMode, ParsedTrail, SessionGroup, TrailDiagnostic } from "../index.js";
import { diagnostic, isEnvelope, isHeader } from "../shared.js";

const sha256Pattern = /^[a-f0-9]{64}$/;

export function hashDiagnostics(trail: ParsedTrail, mode: CoreValidationMode): TrailDiagnostic[] {
  const severity = mode === "strict" ? "error" : "warning";
  return [
    ...sessionHashDiagnostics(trail.groups, severity),
    ...fileHashDiagnostics(trail, severity),
  ];
}

function sessionHashDiagnostics(
  groups: SessionGroup[],
  severity: "error" | "warning",
): TrailDiagnostic[] {
  const diagnostics: TrailDiagnostic[] = [];
  for (const group of groups) {
    if (!isHeader(group.header.record)) continue;
    const contentHash = group.header.record.content_hash;
    if (contentHash === undefined || contentHash === "<pending>") continue;
    if (!sha256Pattern.test(contentHash)) {
      diagnostics.push(
        diagnostic(group.header.line, "/content_hash", "error", "content_hash_invalid"),
      );
      continue;
    }
    const actual = hashRecords([group.header, ...group.events], "session");
    if (actual !== contentHash) {
      diagnostics.push(
        diagnostic(group.header.line, "/content_hash", severity, "content_hash_mismatch"),
      );
    }
  }
  return diagnostics;
}

function fileHashDiagnostics(trail: ParsedTrail, severity: "error" | "warning"): TrailDiagnostic[] {
  const diagnostics: TrailDiagnostic[] = [];
  if (trail.envelope !== undefined && isEnvelope(trail.envelope.record)) {
    const contentHash = trail.envelope.record.content_hash;
    if (contentHash !== undefined && contentHash !== "<pending>") {
      if (!sha256Pattern.test(contentHash)) {
        diagnostics.push(
          diagnostic(trail.envelope.line, "/content_hash", "error", "content_hash_invalid"),
        );
      } else {
        const actual = hashRecords(trail.records, "file");
        if (actual !== contentHash) {
          diagnostics.push(
            diagnostic(trail.envelope.line, "/content_hash", severity, "content_hash_mismatch"),
          );
        }
      }
    }
  }

  return diagnostics;
}
