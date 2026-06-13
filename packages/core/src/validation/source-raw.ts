import type { SessionGroup, TrailDiagnostic } from "../index.js";
import { diagnostic, isJsonObject, readString } from "../shared.js";
import { secretDiagnostics } from "./scalars.js";

export function sourceRawDiagnostics(group: SessionGroup): TrailDiagnostic[] {
  const diagnostics: TrailDiagnostic[] = [];
  const seenIds = headerSeenIds(group);
  for (const event of group.events) {
    if (isJsonObject(event.record.source) && isJsonObject(event.record.source.raw)) {
      const envelopeRef = readString(event.record.source.raw, "envelope_ref");
      if (envelopeRef !== undefined && !seenIds.has(envelopeRef)) {
        diagnostics.push(
          diagnostic(
            event.line,
            "/source/raw/envelope_ref",
            "error",
            "source_raw_envelope_ref_unresolved",
          ),
        );
      }
      diagnostics.push(
        ...secretDiagnostics(
          event.record.source.raw,
          event.line,
          "/source/raw",
          "source_raw_unredacted_secret",
        ),
      );
    }
    if (
      event.record.type === "tool_call" &&
      isJsonObject(event.record.payload) &&
      isJsonObject(event.record.payload.args)
    ) {
      diagnostics.push(
        ...secretDiagnostics(
          event.record.payload.args,
          event.line,
          "/payload/args",
          "tool_args_unredacted_secret",
        ),
      );
    }
    const id = readString(event.record, "id");
    if (id !== undefined) seenIds.add(id);
  }
  return diagnostics;
}

export function headerSeenIds(group: SessionGroup): Set<string> {
  const id = readString(group.header.record, "id");
  return id === undefined ? new Set() : new Set([id]);
}
