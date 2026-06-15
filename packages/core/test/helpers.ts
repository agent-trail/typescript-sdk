import { type ParsedTrail, parseTrailJsonl } from "../src/index.ts";

export const baseHeader = {
  type: "session",
  schema_version: "0.1.0",
  id: "01HSESS0000000000000000001",
  session_uid: "01HZZZZZZZZZZZZZZZZZZZZZ01",
  ts: "2026-05-17T14:00:00.000Z",
  agent: { name: "codex" },
} as const;

export const baseEnvelope = {
  type: "trail",
  schema_version: "0.1.0",
  id: "01HSESS0000000000000000900",
  ts: "2026-05-17T14:00:00.000Z",
  producer: "agent-trail-test",
} as const;

export const segmentChainBreakWarning = {
  code: "segment_chain_break",
  path: "/segment/prev_content_hash",
  severity: "warning",
} as const;

export function jsonl(records: unknown[]): string {
  if (records.length === 0) return "";
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

export function userMessage(
  id: string,
  text = "hello",
  parent_id?: string,
): Record<string, unknown> {
  return event("user_message", id, "2026-05-17T14:00:01.000Z", { text }, parent_id);
}

export function agentMessage(id: string, text = "hi", parent_id?: string): Record<string, unknown> {
  return event("agent_message", id, "2026-05-17T14:00:02.000Z", { text }, parent_id);
}

export function toolCall(
  id: string,
  tool = "file_read",
  parent_id?: string,
): Record<string, unknown> {
  return event("tool_call", id, "2026-05-17T14:00:03.000Z", { tool, args: {} }, parent_id);
}

export function toolResult(
  id: string,
  forId: string | undefined,
  parent_id?: string,
): Record<string, unknown> {
  const payload = forId === undefined ? { output: "ok" } : { for_id: forId, output: "ok" };
  return event("tool_result", id, "2026-05-17T14:00:04.000Z", payload, parent_id);
}

export function sessionMetadataUpdate(
  id: string,
  field: "name" | "description" | "tags",
  value: string | string[],
): Record<string, unknown> {
  return event("session_metadata_update", id, "2026-05-17T14:00:05.000Z", {
    field,
    value,
    reason: "user_set",
  });
}

export function sessionTerminated(id: string, reason: string): Record<string, unknown> {
  return event("session_terminated", id, "2026-05-17T14:00:06.000Z", { reason });
}

export function event(
  type: string,
  id: string,
  ts: string,
  payload: Record<string, unknown>,
  parent_id?: string,
): Record<string, unknown> {
  return parent_id === undefined ? { type, id, ts, payload } : { type, id, ts, parent_id, payload };
}

export async function trail(records: unknown[]): Promise<ParsedTrail> {
  return parseTrailJsonl(jsonl(records));
}

export async function brokenSegmentTrails(): Promise<[ParsedTrail, ParsedTrail]> {
  const first = await trail([
    { ...baseHeader, segment: { seq: 1 } },
    userMessage("01HEVTA0000000000000000001", "one"),
  ]);
  const second = await trail([
    {
      ...baseHeader,
      id: "01HSESS0000000000000000002",
      segment: { seq: 2, prev_content_hash: "a".repeat(64) },
    },
    agentMessage("01HEVTA0000000000000000002", "two"),
  ]);
  return [first, second];
}

export async function* chunks(parts: (string | Uint8Array)[]): AsyncIterable<string | Uint8Array> {
  for (const part of parts) yield part;
}
