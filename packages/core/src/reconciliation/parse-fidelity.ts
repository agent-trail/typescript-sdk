import type { ParseFidelity } from "@agent-trail/types";
import type { ParsedTrailRecord } from "../index.js";
import { isJsonObject } from "../shared.js";

const sessionTerminationReasons = new Set<string>([
  "eof_with_open_tool_calls",
  "process_terminated",
  "truncated",
  "user_abort",
]);

export function parseFidelityForEvents(events: ParsedTrailRecord[]): ParseFidelity {
  const out: ParseFidelity = {
    quarantined_count: events.filter(isQuarantinedUnknownRecord).length,
  };
  const terminationReason = finalSessionTerminatedReason(events);
  if (terminationReason !== undefined) out.termination_reason = terminationReason;
  return out;
}

function isQuarantinedUnknownRecord(event: ParsedTrailRecord): boolean {
  const record = event.record;
  return (
    isJsonObject(record) &&
    record.type === "system_event" &&
    isJsonObject(record.payload) &&
    typeof record.payload.kind === "string" &&
    /^x-[a-z0-9]+(?:-[a-z0-9]+)*\/unknown_record$/.test(record.payload.kind)
  );
}

function finalSessionTerminatedReason(
  events: ParsedTrailRecord[],
): ParseFidelity["termination_reason"] | undefined {
  let reason: ParseFidelity["termination_reason"] | undefined;
  for (const event of events) {
    const record = event.record;
    if (!isJsonObject(record) || record.type !== "session_terminated") continue;
    if (!isJsonObject(record.payload)) continue;
    const rawReason = record.payload.reason;
    if (isSessionTerminationReason(rawReason)) reason = rawReason;
  }
  return reason;
}

function isSessionTerminationReason(
  value: unknown,
): value is NonNullable<ParseFidelity["termination_reason"]> {
  return typeof value === "string" && sessionTerminationReasons.has(value);
}
