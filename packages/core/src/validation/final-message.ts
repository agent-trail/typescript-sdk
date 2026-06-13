import type { ParsedTrailRecord, SessionGroup, TrailDiagnostic } from "../index.js";
import { diagnostic, payloadString } from "../shared.js";

export function finalMessageDiagnostics(
  group: SessionGroup,
  fileIds: Map<string, ParsedTrailRecord>,
): TrailDiagnostic[] {
  return group.events.flatMap((event) => {
    if (event.record.type !== "session_end") return [];
    const finalMessageId = payloadString(event.record, "final_message_id");
    const target = finalMessageId === undefined ? undefined : fileIds.get(finalMessageId);
    if (finalMessageId !== undefined && (target === undefined || target.line > event.line)) {
      return [
        diagnostic(event.line, "/payload/final_message_id", "warning", "unknown_final_message_id"),
      ];
    }
    return [];
  });
}
