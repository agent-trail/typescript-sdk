import type { Entry } from "@agent-trail/types";

export function withLinkedSubagentSessionIds(
  entries: Entry[],
  linked: Map<string, string>,
): Entry[] {
  return entries.map((entry) => withLinkedSubagentSessionId(entry, linked));
}

function withLinkedSubagentSessionId(entry: Entry, linked: Map<string, string>): Entry {
  const childId = linked.get(entry.id);
  if (childId === undefined || !isSubagentToolCall(entry)) return entry;
  const args = isRecord(entry.payload.args) ? entry.payload.args : {};
  return {
    ...entry,
    payload: {
      ...entry.payload,
      args: { ...args, session_id: childId },
    },
  } as Entry;
}

function isSubagentToolCall(
  entry: Entry,
): entry is Entry & { payload: { tool: "subagent_invoke"; args?: unknown } } {
  return entry.type === "tool_call" && entry.payload.tool === "subagent_invoke";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
