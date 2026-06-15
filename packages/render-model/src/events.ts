import type { RenderEvent, RenderMeta, RenderTrail, RenderTrailRecord } from "./types.js";
import {
  booleanValue,
  cappedJson,
  compactValue,
  numberValue,
  objectValue,
  optionalMeta,
  optionalToolField,
  stringValue,
} from "./values.js";

type EventContext = {
  record: RenderTrailRecord;
  sessionIndex: number;
  value: Record<string, unknown>;
  payload: Record<string, unknown> | undefined;
  type: string;
};

type EventRenderer = (context: EventContext) => RenderEvent;

const EVENT_RENDERERS: Record<string, EventRenderer> = {
  agent_message: renderAgentMessage,
  agent_thinking: renderAgentThinking,
  branch_point: renderBranchPoint,
  branch_summary: renderBranchSummary,
  session_summary: renderSessionSummary,
  tool_call: renderToolCall,
  tool_call_aborted: renderToolAborted,
  tool_result: renderToolResult,
  user_message: renderUserMessage,
};

export function buildRenderEvents(trail: RenderTrail): RenderEvent[] {
  return trail.groups.flatMap((group, sessionIndex) =>
    group.events.map((record) => renderEventFromRecord(record, sessionIndex)),
  );
}

function renderEventFromRecord(record: RenderTrailRecord, sessionIndex: number): RenderEvent {
  const value = record.record as Record<string, unknown>;
  const type = stringValue(value.type) ?? "unknown";
  const context = {
    payload: objectValue(value.payload),
    record,
    sessionIndex,
    type,
    value,
  };
  return (EVENT_RENDERERS[type] ?? renderFallback)(context);
}

function renderUserMessage({ payload, record, sessionIndex }: EventContext): RenderEvent {
  return baseEvent(record, sessionIndex, {
    body: stringValue(payload?.text) ?? null,
    kind: "user",
    meta: attachmentMeta(payload),
    title: "User message",
  });
}

function renderAgentMessage({ payload, record, sessionIndex }: EventContext): RenderEvent {
  return baseEvent(record, sessionIndex, {
    body: stringValue(payload?.text) ?? null,
    kind: "agent",
    meta: [
      ...optionalMeta("model", stringValue(payload?.model)),
      ...optionalMeta("stop", stringValue(payload?.stop_reason)),
      ...attachmentMeta(payload),
    ],
    title: "Agent message",
  });
}

function renderAgentThinking({ payload, record, sessionIndex }: EventContext): RenderEvent {
  return baseEvent(record, sessionIndex, {
    body: stringValue(payload?.text) ?? null,
    kind: "agent",
    meta: [
      ...optionalMeta("model", stringValue(payload?.model)),
      ...optionalMeta("level", stringValue(payload?.level)),
    ],
    title: "Agent thinking",
  });
}

function renderToolCall({ payload, record, sessionIndex, value }: EventContext): RenderEvent {
  const tool = stringValue(payload?.tool) ?? "unknown";
  const args = objectValue(payload?.args);
  return baseEvent(record, sessionIndex, {
    body: summarizeArgs(args) ?? null,
    kind: "tool_call",
    meta: argsMeta(args),
    title: `Tool call: ${tool}`,
    tool: {
      name: tool,
      ...optionalToolField("semanticCallId", readSemanticCallId(value)),
    },
  });
}

function renderToolResult({ payload, record, sessionIndex, value }: EventContext): RenderEvent {
  const forId = stringValue(payload?.for_id);
  const statusLabel = toolResultStatusLabel(booleanValue(payload?.ok));
  return baseEvent(record, sessionIndex, {
    body: toolResultBody(payload),
    kind: "tool_result",
    meta: [
      ...optionalMeta("for", forId),
      ...optionalMeta("truncated", booleanValue(payload?.truncated)?.toString()),
      ...optionalMeta("bytes", numberValue(payload?.output_size)?.toString()),
      ...attachmentMeta(payload),
    ],
    status: statusLabel,
    title: `Tool result: ${statusLabel}`,
    tool: {
      ...optionalToolField("forId", forId),
      ...optionalToolField("semanticCallId", readSemanticCallId(value)),
    },
  });
}

function toolResultBody(payload: Record<string, unknown> | undefined): string | null {
  return stringValue(payload?.output) ?? stringValue(payload?.error) ?? null;
}

function toolResultStatusLabel(ok: boolean | undefined): "error" | "ok" | "unknown" {
  if (ok === undefined) return "unknown";
  return ok ? "ok" : "error";
}

function renderToolAborted({ payload, record, sessionIndex, value }: EventContext): RenderEvent {
  const forId = stringValue(payload?.for_id);
  const scope = stringValue(payload?.scope);
  return baseEvent(record, sessionIndex, {
    body: stringValue(payload?.reason) ?? null,
    kind: "tool_aborted",
    meta: [
      ...optionalMeta("for", forId),
      ...optionalMeta("scope", scope),
      ...optionalMeta("reason", stringValue(payload?.reason)),
      ...optionalMeta("blocked by", stringValue(payload?.blocked_by)),
    ],
    status: "error",
    title: `Tool aborted: ${stringValue(payload?.reason) ?? "unknown"}`,
    tool: {
      ...optionalToolField("forId", forId),
      ...optionalToolField("scope", scope),
      ...optionalToolField("semanticCallId", readSemanticCallId(value)),
    },
  });
}

function renderSessionSummary({ payload, record, sessionIndex }: EventContext): RenderEvent {
  return baseEvent(record, sessionIndex, {
    body: stringValue(payload?.text) ?? null,
    kind: "summary",
    meta: optionalMeta("scope", stringValue(payload?.scope)),
    title: "Session summary",
  });
}

function renderBranchPoint({ payload, record, sessionIndex }: EventContext): RenderEvent {
  return baseEvent(record, sessionIndex, {
    body: stringValue(payload?.reason) ?? null,
    kind: "notice",
    meta: optionalMeta("from", stringValue(payload?.from_id)),
    title: "Branch point",
  });
}

function renderBranchSummary({ payload, record, sessionIndex }: EventContext): RenderEvent {
  return baseEvent(record, sessionIndex, {
    body: stringValue(payload?.summary) ?? null,
    kind: "notice",
    meta: optionalMeta("abandoned", stringValue(payload?.abandoned_branch_id)),
    title: "Branch summary",
  });
}

function renderFallback({ payload, record, sessionIndex, type, value }: EventContext): RenderEvent {
  return baseEvent(record, sessionIndex, {
    body: fallbackBody(payload),
    kind: "fallback",
    meta: [],
    rawJson: cappedJson(value),
    title: `Unknown record: ${type}`,
  });
}

function baseEvent(
  record: RenderTrailRecord,
  sessionIndex: number,
  opts: Omit<RenderEvent, "id" | "line" | "parentId" | "sessionIndex" | "ts" | "type">,
): RenderEvent {
  const value = record.record as Record<string, unknown>;
  return {
    id: stringValue(value.id) ?? null,
    line: record.line,
    ...optionalParentId(value),
    sessionIndex,
    ts: stringValue(value.ts) ?? null,
    type: stringValue(value.type) ?? "unknown",
    ...opts,
  };
}

function optionalParentId(value: Record<string, unknown>): { parentId?: string } {
  const parentId = stringValue(value.parent_id);
  return parentId === undefined ? {} : { parentId };
}

function fallbackBody(payload: Record<string, unknown> | undefined): string | null {
  return stringValue(payload?.text) ?? stringValue(payload?.summary) ?? null;
}

function attachmentMeta(payload: Record<string, unknown> | undefined): RenderMeta[] {
  const attachments = payload?.attachments;
  return Array.isArray(attachments) && attachments.length > 0
    ? [{ label: "attachments", value: String(attachments.length) }]
    : [];
}

function argsMeta(args: Record<string, unknown> | undefined): RenderMeta[] {
  if (args === undefined) return [];
  return Object.entries(args).map(([label, value]) => ({ label, value: compactValue(value) }));
}

function readSemanticCallId(value: Record<string, unknown>): string | undefined {
  return stringValue(objectValue(value.semantic)?.call_id);
}

function summarizeArgs(args: Record<string, unknown> | undefined): string | null {
  if (args === undefined) return null;
  const path = stringValue(args.path);
  if (path !== undefined) return path;
  const command = stringValue(args.command);
  if (command !== undefined) return command;
  const query = stringValue(args.query);
  if (query !== undefined) return query;
  return cappedJson(args, 600);
}
