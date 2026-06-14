import type { TrailDiagnostic } from "../index.js";
import { diagnostic, isJsonObject, readString } from "../shared.js";
import type { GroupValidationContext } from "./context.js";
import { secretDiagnostics } from "./scalars.js";

const sourceRawSoftCapBytes = 8 * 1024;
const sourceRawHardCapBytes = 32 * 1024;

export function sourceRawDiagnostics(context: GroupValidationContext): TrailDiagnostic[] {
  const diagnostics: TrailDiagnostic[] = [];
  for (const event of context.group.events) {
    if (isJsonObject(event.record.source) && isJsonObject(event.record.source.raw)) {
      diagnostics.push(...sourceRawSizeDiagnostics(event.record.source.raw, event.line));
      const envelopeRef = readString(event.record.source.raw, "envelope_ref");
      if (envelopeRef !== undefined && !context.graph.hasPriorId(envelopeRef, event)) {
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
  }
  return diagnostics;
}

function sourceRawSizeDiagnostics(raw: Record<string, unknown>, line: number): TrailDiagnostic[] {
  const size = new TextEncoder().encode(JSON.stringify(raw)).byteLength;
  if (size > sourceRawHardCapBytes) {
    return [diagnostic(line, "/source/raw", "error", "source_raw_oversized_hard")];
  }
  if (size > sourceRawSoftCapBytes) {
    return [diagnostic(line, "/source/raw", "warning", "source_raw_oversized")];
  }
  return [];
}
