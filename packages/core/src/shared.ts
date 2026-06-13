import type { Header, TrailEnvelope } from "@agent-trail/types";
import type {
  ParsedTrail,
  ParsedTrailRecord,
  TrailDiagnostic,
  UnknownTrailRecord,
} from "./index.js";

type JsonObject = Record<string, unknown>;

export function diagnostic(
  line: number,
  path: string,
  severity: "error" | "warning",
  code: string,
): TrailDiagnostic {
  return { line, path, severity, code, message: code.replaceAll("_", " ") };
}

export function uniqueDiagnostics(diagnostics: TrailDiagnostic[]): TrailDiagnostic[] {
  const seen = new Set<string>();
  return diagnostics.filter((item) => {
    const key = `${item.line}:${item.path}:${item.severity}:${item.code}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function cloneRecord<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isHeader(record: unknown): record is Header {
  return isJsonObject(record) && record.type === "session";
}

export function isEnvelope(record: unknown): record is TrailEnvelope {
  return isJsonObject(record) && record.type === "trail";
}

export function isKnownEventType(type: string): boolean {
  return [
    "agent_message",
    "agent_thinking",
    "branch_point",
    "branch_summary",
    "capability_change",
    "command_invoke",
    "context_compact",
    "mode_change",
    "model_change",
    "session_end",
    "session_summary",
    "session_metadata_update",
    "session_terminated",
    "system_event",
    "task_plan_update",
    "thinking_level_change",
    "tool_call",
    "tool_call_aborted",
    "tool_result",
    "user_interrupt",
    "user_message",
    "user_query",
    "user_query_response",
  ].includes(type);
}

export function firstHeader(trail: ParsedTrail | undefined): Header | undefined {
  const header = firstHeaderRecord(trail)?.record;
  return isHeader(header) ? header : undefined;
}

export function firstHeaderRecord(
  trail: ParsedTrail | undefined,
): ParsedTrailRecord<Header | UnknownTrailRecord> | undefined {
  return trail?.groups[0]?.header;
}

export function segmentSeq(header: Header | UnknownTrailRecord | undefined): number {
  if (!isHeader(header)) return 1;
  return header.segment?.seq ?? 1;
}

export function readString(record: unknown, key: string): string | undefined {
  return isJsonObject(record) && typeof record[key] === "string" ? record[key] : undefined;
}

export function payloadString(record: unknown, key: string): string | undefined {
  return isJsonObject(record) &&
    isJsonObject(record.payload) &&
    typeof record.payload[key] === "string"
    ? record.payload[key]
    : undefined;
}

export function resultToolName(record: unknown): string | undefined {
  if (!isJsonObject(record) || !isJsonObject(record.payload)) return undefined;
  const semantic = record.payload.semantic;
  return isJsonObject(semantic) ? readString(semantic, "tool") : undefined;
}

export function semanticCallId(record: unknown): string | undefined {
  if (!isJsonObject(record) || !isJsonObject(record.semantic)) return undefined;
  return readString(record.semantic, "call_id");
}

export function isCallMatched(
  call: ParsedTrailRecord,
  matchedResultsByCall: Map<string, ParsedTrailRecord[]>,
): boolean {
  const id = readString(call.record, "id");
  return id !== undefined && (matchedResultsByCall.get(id)?.length ?? 0) > 0;
}

export function findValues(value: unknown, path: string): { path: string; value: unknown }[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findValues(item, `${path}/${index}`));
  }
  if (isJsonObject(value)) {
    return Object.entries(value).flatMap(([key, item]) =>
      findValues(item, `${path}/${escapeJsonPointer(key)}`),
    );
  }
  return [{ path, value }];
}

export function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

export function escapeJsonPointer(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}
