import { type ParsedTrail, parseTrailJsonl } from "../src/index.ts";

export const baseHeader = {
  type: "session",
  schema_version: "0.1.0",
  id: "01HSESS0000000000000000001",
  session_uid: "01HZZZZZZZZZZZZZZZZZZZZZ01",
  ts: "2026-05-17T14:00:00.000Z",
  agent: { name: "codex-cli" },
} as const;

export const baseEnvelope = {
  type: "trail",
  schema_version: "0.1.0",
  id: "01HSESS0000000000000000900",
  ts: "2026-05-17T14:00:00.000Z",
  producer: "agent-trail-test",
} as const;

export function jsonl(records: unknown[]): string {
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

export async function* chunks(parts: (string | Uint8Array)[]): AsyncIterable<string | Uint8Array> {
  for (const part of parts) yield part;
}
