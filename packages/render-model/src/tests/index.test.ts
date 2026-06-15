import { expect, test } from "bun:test";
import { parseTrailJsonl, type TrailDiagnostic } from "@agent-trail/core";
import {
  buildRenderModel,
  buildTranscriptItems,
  DEFAULT_FILTERS,
  FILTERS,
  filterTranscriptItems,
  type RenderEvent,
  renderItemAnchor,
  renderItemKey,
  renderItemLabel,
  renderItemPreview,
  type ToolTranscriptItem,
  toolGroupTimestamp,
} from "../index.ts";
import { pairToolLifecycleEvents } from "../pairing.ts";

const header = {
  type: "session",
  schema_version: "0.1.0",
  id: "01HSESS0000000000000000001",
  session_uid: "01HZZZZZZZZZZZZZZZZZZZZZ01",
  ts: "2026-05-17T14:00:00.000Z",
  agent: { name: "codex" },
} as const;

function jsonl(records: readonly object[]): string {
  return `${[header, ...records].map((record) => JSON.stringify(record)).join("\n")}\n`;
}

async function renderModel(records: readonly object[]) {
  return buildRenderModel(await parseTrailJsonl(jsonl(records)));
}

test("builds render events and transcript items for core message and tool records", async () => {
  const model = await renderModel([
    {
      type: "user_message",
      id: "01HEVTA0000000000000000001",
      ts: "2026-05-17T14:00:05.000Z",
      payload: { text: "Render core events" },
    },
    {
      type: "agent_message",
      id: "01HEVTA0000000000000000002",
      ts: "2026-05-17T14:00:06.000Z",
      payload: { text: "Rendering now.", model: "gpt-test", stop_reason: "end_turn" },
    },
    {
      type: "agent_thinking",
      id: "01HEVTA0000000000000000007",
      ts: "2026-05-17T14:00:06.500Z",
      payload: { text: "Keep thinking visible.", level: "medium" },
    },
    {
      type: "tool_call",
      id: "01HEVTA0000000000000000003",
      ts: "2026-05-17T14:00:07.000Z",
      payload: { tool: "shell_command", args: { command: "bun test", cwd: "/tmp/project" } },
    },
    {
      type: "tool_result",
      id: "01HEVTA0000000000000000004",
      ts: "2026-05-17T14:00:08.000Z",
      payload: {
        for_id: "01HEVTA0000000000000000003",
        ok: false,
        error: "exit 1",
        output_size: 1570,
        truncated: true,
      },
    },
    {
      type: "session_summary",
      id: "01HEVTA0000000000000000005",
      ts: "2026-05-17T14:00:09.000Z",
      payload: { scope: "session", text: "Core events rendered." },
    },
    {
      type: "future_event",
      id: "01HEVTA0000000000000000006",
      ts: "2026-05-17T14:00:10.000Z",
      payload: { text: "future shape" },
    },
  ]);

  expect(model.summary).toEqual({ records: 8, sessions: 1, warnings: 0 });
  expect(model.events.map((event) => [event.kind, event.title, event.body])).toEqual([
    ["user", "User message", "Render core events"],
    ["agent", "Agent message", "Rendering now."],
    ["agent", "Agent thinking", "Keep thinking visible."],
    ["tool_call", "Tool call: shell_command", "bun test"],
    ["tool_result", "Tool result: error", "exit 1"],
    ["summary", "Session summary", "Core events rendered."],
    ["fallback", "Unknown record: future_event", "future shape"],
  ]);
  expect(model.events[1]?.meta).toEqual([
    { label: "model", value: "gpt-test" },
    { label: "stop", value: "end_turn" },
  ]);
  expect(model.events[4]?.status).toBe("error");
  expect(model.events[4]?.meta).toEqual([
    { label: "for", value: "01HEVTA0000000000000000003" },
    { label: "truncated", value: "true" },
    { label: "bytes", value: "1570" },
  ]);
  expect(model.transcriptItems.map((item) => item.kind)).toEqual([
    "user",
    "agent",
    "agent",
    "tool",
  ]);
  expect(model.transcriptItems[3]?.kind).toBe("tool");
  if (model.transcriptItems[3]?.kind !== "tool") throw new Error("expected paired tool");
  expect(model.transcriptItems[3].call?.id).toBe("01HEVTA0000000000000000003");
  expect(model.transcriptItems[3].result?.id).toBe("01HEVTA0000000000000000004");
});

test("groups consecutive tool calls into one collapsible group", async () => {
  const model = await renderModel([
    toolCallRecord("01HEVTA0000000000000000001", "file_search", {
      args: { query: "useTrail" },
      ts: "2026-05-17T14:00:05.000Z",
    }),
    toolResultRecord("01HEVTA0000000000000000002", "01HEVTA0000000000000000001", {
      output: "src/useTrail.ts",
      ts: "2026-05-17T14:00:06.000Z",
    }),
    toolCallRecord("01HEVTA0000000000000000003", "file_read", {
      args: { path: "src/useTrail.ts" },
      ts: "2026-05-17T14:00:07.000Z",
    }),
    toolResultRecord("01HEVTA0000000000000000004", "01HEVTA0000000000000000003", {
      output: "export const useTrail",
      ts: "2026-05-17T14:00:08.000Z",
    }),
    {
      type: "agent_message",
      id: "01HEVTA0000000000000000005",
      ts: "2026-05-17T14:00:09.000Z",
      payload: { text: "Found the hook." },
    },
  ]);

  expect(model.transcriptItems).toHaveLength(2);
  expect(model.transcriptItems[0]?.kind).toBe("tool_group");
  if (model.transcriptItems[0]?.kind !== "tool_group") throw new Error("expected tool group");
  expect(model.transcriptItems[0].items).toHaveLength(2);
  expect(toolGroupTimestamp(model.transcriptItems[0])).toBe("2026-05-17T14:00:05.000Z");
  expect(renderItemLabel(model.transcriptItems[0])).toBe("Tools");
  expect(renderItemPreview(model.transcriptItems[0])).toBe("2 grouped tool calls...");
});

test("renders aborted tool calls and non-shell result text in shared model", async () => {
  const model = await renderModel([
    toolCallRecord("01HEVTA0000000000000000001", "file_search", {
      args: { query: "useTrail" },
    }),
    toolResultRecord("01HEVTA0000000000000000002", "01HEVTA0000000000000000001", {
      output: "Result: src/useTrail.ts\n\nplain output",
    }),
    toolCallRecord("01HEVTA0000000000000000003", "shell_command", {
      args: { command: "sleep 10" },
    }),
    {
      type: "tool_call_aborted",
      id: "01HEVTA0000000000000000004",
      ts: "2026-05-17T14:00:08.000Z",
      payload: {
        for_id: "01HEVTA0000000000000000003",
        reason: "user_interrupt",
        scope: "tool_call",
      },
    },
  ]);

  expect(model.transcriptItems).toHaveLength(1);
  expect(model.transcriptItems[0]?.kind).toBe("tool_group");
  if (model.transcriptItems[0]?.kind !== "tool_group") throw new Error("expected tool group");
  expect(model.transcriptItems[0].items[0]?.result?.body).toBe(
    "Result: src/useTrail.ts\n\nplain output",
  );
  expect(model.transcriptItems[0].items[1]?.abort?.title).toBe("Tool aborted: user_interrupt");
  expect(model.transcriptItems[0].items[1]?.abort?.meta).toContainEqual({
    label: "reason",
    value: "user_interrupt",
  });
});

test("keeps tool-only groups bounded by original trail adjacency", () => {
  const items = filterTranscriptItems(
    buildTranscriptItems([
      toolCallEvent(2, "01HEVTA0000000000000000001", "file_search"),
      toolResultEvent(3, "01HEVTA0000000000000000002", "01HEVTA0000000000000000001"),
      agentEvent(4, "Separated by agent text."),
      toolCallEvent(5, "01HEVTA0000000000000000004", "file_read"),
      toolResultEvent(6, "01HEVTA0000000000000000005", "01HEVTA0000000000000000004"),
      toolCallEvent(7, "01HEVTA0000000000000000006", "file_write"),
      toolResultEvent(8, "01HEVTA0000000000000000007", "01HEVTA0000000000000000006"),
    ]),
    {
      agent: false,
      thinking: false,
      tool: true,
      user: false,
    },
  );

  expect(items).toHaveLength(2);
  expect(items[0]?.kind).toBe("tool");
  expect(items[1]?.kind).toBe("tool_group");
  if (items[1]?.kind !== "tool_group") throw new Error("expected second item to be tool group");
  expect(items[1].items).toHaveLength(2);
});

test("pairs tool results by semantic fallback", () => {
  const semanticItems = buildTranscriptItems([
    toolCallEvent(2, "01HEVTA0000000000000000001", "file_search", {
      semanticCallId: "call-1",
    }),
    toolResultEvent(3, "01HEVTA0000000000000000002", undefined, {
      semanticCallId: "call-1",
    }),
  ]);

  const item = singleToolItem(semanticItems, "expected paired semantic tool item");
  expect(item.call?.id).toBe("01HEVTA0000000000000000001");
  expect(item.result?.id).toBe("01HEVTA0000000000000000002");
});

test("pairs tool results by sequential fallback", () => {
  const sequentialItems = buildTranscriptItems([
    toolCallEvent(2, "01HEVTA0000000000000000003", "file_read"),
    toolResultEvent(3, "01HEVTA0000000000000000004", undefined),
  ]);

  const item = singleToolItem(sequentialItems, "expected paired sequential tool item");
  expect(item.call?.id).toBe("01HEVTA0000000000000000003");
  expect(item.result?.id).toBe("01HEVTA0000000000000000004");
});

test("keeps paired tool results in file order across non-tool events", () => {
  const items = buildTranscriptItems([
    toolCallEvent(2, "01HEVTA0000000000000000001", "file_search"),
    agentEvent(3, "Intervening response."),
    toolResultEvent(4, "01HEVTA0000000000000000003", "01HEVTA0000000000000000001"),
  ]);

  expect(items).toHaveLength(3);
  expect(items[0]?.kind).toBe("tool");
  expect(items[1]?.kind).toBe("agent");
  expect(items[2]?.kind).toBe("tool");
  const callItem = toolItemAt(items, 0);
  const resultItem = toolItemAt(items, 2);
  expect(callItem.call?.id).toBe("01HEVTA0000000000000000001");
  expect(callItem.result).toBeUndefined();
  expect(resultItem.call).toBeUndefined();
  expect(resultItem.result?.id).toBe("01HEVTA0000000000000000003");
});

test("does not pair tool results across session boundaries", () => {
  const items = buildTranscriptItems([
    toolCallEvent(2, "01HEVTA0000000000000000001", "file_search", { sessionIndex: 0 }),
    toolResultEvent(4, "01HEVTA0000000000000000002", undefined, { sessionIndex: 1 }),
  ]);

  expect(items).toHaveLength(2);
  expect(items[0]?.kind).toBe("tool");
  expect(items[1]?.kind).toBe("tool");
  if (items[0]?.kind !== "tool" || items[1]?.kind !== "tool") {
    throw new Error("expected separate cross-session tool events");
  }
  expect(items[0].call?.id).toBe("01HEVTA0000000000000000001");
  expect(items[0].result).toBeUndefined();
  expect(items[1].call).toBeUndefined();
  expect(items[1].result?.id).toBe("01HEVTA0000000000000000002");
});

test("sequential fallback pairs same-parent sibling tool events", () => {
  const parentId = "01HEVTA0000000000000000001";
  const items = buildTranscriptItems([
    agentEvent(2, "Run tool.", { id: parentId }),
    toolCallEvent(3, "01HEVTA0000000000000000002", "file_read", { parentId }),
    toolResultEvent(4, "01HEVTA0000000000000000003", undefined, { parentId }),
  ]);

  expect(items).toHaveLength(2);
  expect(items[1]?.kind).toBe("tool");
  if (items[1]?.kind !== "tool") throw new Error("expected same-parent sibling pair");
  expect(items[1].call?.id).toBe("01HEVTA0000000000000000002");
  expect(items[1].result?.id).toBe("01HEVTA0000000000000000003");
});

test("parent-id fallback takes precedence over newer sequential calls", () => {
  const firstCallId = "01HEVTA0000000000000000001";
  const secondCallId = "01HEVTA0000000000000000002";
  const resultId = "01HEVTA0000000000000000003";
  const items = buildTranscriptItems([
    toolCallEvent(2, firstCallId, "file_read"),
    toolCallEvent(3, secondCallId, "file_search"),
    toolResultEvent(4, resultId, undefined, { parentId: firstCallId }),
  ]);

  expect(items).toHaveLength(1);
  expect(items[0]?.kind).toBe("tool_group");
  if (items[0]?.kind !== "tool_group") throw new Error("expected grouped tool events");
  expect(items[0].items[0]?.call?.id).toBe(firstCallId);
  expect(items[0].items[0]?.result?.id).toBe(resultId);
  expect(items[0].items[1]?.call?.id).toBe(secondCallId);
  expect(items[0].items[1]?.result).toBeUndefined();
});

test("explicit pairing ignores duplicate completions for an already matched call", () => {
  const callId = "01HEVTA0000000000000000001";
  const pairings = pairToolLifecycleEvents([
    toolCallEvent(2, callId, "file_read"),
    toolResultEvent(3, "01HEVTA0000000000000000002", callId),
    toolResultEvent(4, "01HEVTA0000000000000000003", callId),
  ]);

  expect(pairings.get(1)).toBe(callId);
  expect(pairings.has(2)).toBe(false);
});

test("sequential fallback does not pair child branch results to parent calls", () => {
  const invokeId = "01HEVTA0000000000000000001";
  const items = buildTranscriptItems([
    toolCallEvent(2, invokeId, "subagent_invoke"),
    toolCallEvent(3, "01HEVTA0000000000000000002", "file_read"),
    toolResultEvent(4, "01HEVTA0000000000000000003", undefined, { parentId: invokeId }),
  ]);

  expect(items).toHaveLength(1);
  expect(items[0]?.kind).toBe("tool_group");
  if (items[0]?.kind !== "tool_group") throw new Error("expected grouped separate tool events");
  expect(items[0].items).toHaveLength(3);
  expect(items[0].items[1]?.call?.id).toBe("01HEVTA0000000000000000002");
  expect(items[0].items[1]?.result).toBeUndefined();
  expect(items[0].items[2]?.call).toBeUndefined();
  expect(items[0].items[2]?.result?.id).toBe("01HEVTA0000000000000000003");
});

test("summary notices and fallback events stay out of transcript but remain in full events", async () => {
  const model = await renderModel([
    {
      type: "session_summary",
      id: "01HEVTA0000000000000000001",
      ts: "2026-05-17T14:00:05.000Z",
      payload: { scope: "session", text: "summarized" },
    },
    {
      type: "branch_point",
      id: "01HEVTA0000000000000000002",
      ts: "2026-05-17T14:00:06.000Z",
      payload: { reason: "fork", from_id: "root" },
    },
    {
      type: "branch_summary",
      id: "01HEVTA0000000000000000003",
      ts: "2026-05-17T14:00:07.000Z",
      payload: { summary: "abandoned", abandoned_branch_id: "branch-1" },
    },
    {
      type: "future_event",
      id: "01HEVTA0000000000000000004",
      ts: "2026-05-17T14:00:08.000Z",
      payload: { summary: "future summary", extra: { nested: true } },
    },
  ]);

  expect(model.events.map((event) => event.kind)).toEqual([
    "summary",
    "notice",
    "notice",
    "fallback",
  ]);
  expect(model.events[3]?.body).toBe("future summary");
  expect(model.events[3]?.rawJson).toContain('"future_event"');
  expect(model.transcriptItems).toEqual([]);
});

test("fallback raw JSON formatting is bounded during traversal", () => {
  const record: Record<string, unknown> = {
    id: "01HEVTA0000000000000000001",
    payload: {},
    ts: "2026-05-17T14:00:05.000Z",
    type: "future_event",
  };
  for (let index = 0; index < 400; index += 1) {
    record[`field_${index}`] = "x".repeat(100);
  }
  Object.defineProperty(record, "late_throwing_value", {
    enumerable: true,
    get() {
      throw new Error("bounded formatter should not read past the cap");
    },
  });

  const model = buildRenderModel({
    groups: [{ events: [{ line: 2, record }] }],
    records: [{ line: 2, record }],
  });

  expect(model.events[0]?.rawJson).toContain("... truncated");
  expect(model.events[0]?.rawJson?.length).toBeLessThan(2_100);
});

test("filters transcript items and exposes stable helper values", () => {
  const items = buildTranscriptItems([
    {
      body: "User text",
      id: "01HEVTA0000000000000000001",
      kind: "user",
      line: 2,
      meta: [],
      sessionIndex: 0,
      ts: "2026-05-17T14:00:05.000Z",
      title: "User message",
      type: "user_message",
    },
    agentEvent(3, "Thinking text", { type: "agent_thinking" }),
    agentEvent(4, "Agent text"),
    toolCallEvent(5, "01HEVTA0000000000000000004", "file_read"),
  ]);

  expect(filterTranscriptItems(items, DEFAULT_FILTERS)).toHaveLength(4);
  expect(Object.isFrozen(DEFAULT_FILTERS)).toBe(true);
  expect(Object.isFrozen(FILTERS)).toBe(true);
  expect(Object.isFrozen(FILTERS[0])).toBe(true);
  expect(
    filterTranscriptItems(items, {
      agent: false,
      thinking: true,
      tool: false,
      user: false,
    }),
  ).toHaveLength(1);
  const userItem = items[0];
  const thinkingItem = items[1];
  const agentItem = items[2];
  if (userItem === undefined || thinkingItem === undefined || agentItem === undefined) {
    throw new Error("expected helper test transcript items");
  }
  expect(renderItemAnchor(userItem)).toBe("event-2");
  expect(renderItemKey(userItem, 0)).toBe("user:2:01HEVTA0000000000000000001");
  expect(renderItemLabel(thinkingItem)).toBe("Think");
  expect(renderItemPreview(agentItem)).toBe("Agent text");
});

test("counts only warning diagnostics in summary", async () => {
  const diagnostics: TrailDiagnostic[] = [
    { code: "warn", line: 1, message: "warning", path: "/", severity: "warning" },
    { code: "error", line: 2, message: "error", path: "/", severity: "error" },
  ];
  const trail = await parseTrailJsonl(jsonl([]));

  expect(buildRenderModel(trail, { diagnostics }).summary).toEqual({
    records: 1,
    sessions: 1,
    warnings: 1,
  });
});

function singleToolItem(items: readonly unknown[], message: string): ToolTranscriptItem {
  expect(items).toHaveLength(1);
  return toolItemAt(items, 0, message);
}

function toolItemAt(
  items: readonly unknown[],
  index: number,
  message = "expected tool transcript item",
): ToolTranscriptItem {
  const item = items[index];
  if (typeof item !== "object" || item === null || !("kind" in item) || item.kind !== "tool") {
    throw new Error(message);
  }
  return item as ToolTranscriptItem;
}

function toolCallRecord(
  id: string,
  tool: string,
  options: { args?: Record<string, unknown>; ts?: string } = {},
): object {
  return {
    type: "tool_call",
    id,
    ts: options.ts ?? "2026-05-17T14:00:05.000Z",
    payload: { tool, args: options.args ?? {} },
  };
}

function toolResultRecord(
  id: string,
  forId: string,
  options: { output?: string; ts?: string } = {},
): object {
  return {
    type: "tool_result",
    id,
    ts: options.ts ?? "2026-05-17T14:00:06.000Z",
    payload: { for_id: forId, ok: true, output: options.output ?? "ok" },
  };
}

function toolCallEvent(
  line: number,
  id: string,
  toolName: string,
  options: {
    parentId?: string;
    semanticCallId?: string;
    sessionIndex?: number;
  } = {},
): RenderEvent {
  return {
    body: toolName,
    id,
    kind: "tool_call",
    line,
    meta: [],
    ...optionalEventParentId(options.parentId),
    sessionIndex: options.sessionIndex ?? 0,
    ts: "2026-05-17T14:00:07.000Z",
    title: `Tool call: ${toolName}`,
    tool: { name: toolName, ...optionalSemanticCallId(options.semanticCallId) },
    type: "tool_call",
  };
}

function toolResultEvent(
  line: number,
  id: string,
  forId?: string,
  options: {
    parentId?: string;
    semanticCallId?: string;
    sessionIndex?: number;
  } = {},
): RenderEvent {
  return {
    body: "result",
    id,
    kind: "tool_result",
    line,
    meta: [],
    ...optionalEventParentId(options.parentId),
    sessionIndex: options.sessionIndex ?? 0,
    status: "ok",
    ts: "2026-05-17T14:00:08.000Z",
    title: "Tool result: ok",
    tool: { ...optionalForId(forId), ...optionalSemanticCallId(options.semanticCallId) },
    type: "tool_result",
  };
}

function agentEvent(
  line: number,
  body: string,
  options: {
    id?: string;
    type?: "agent_message" | "agent_thinking";
  } = {},
): RenderEvent {
  const type = options.type ?? "agent_message";
  return {
    body,
    id: options.id ?? `01HEVTA00000000000000000${line.toString().padStart(2, "0")}`,
    kind: "agent",
    line,
    meta: [],
    sessionIndex: 0,
    ts: "2026-05-17T14:00:07.000Z",
    title: type === "agent_thinking" ? "Agent thinking" : "Agent message",
    type,
  };
}

function optionalEventParentId(parentId: string | undefined): { parentId?: string } {
  return parentId === undefined ? {} : { parentId };
}

function optionalForId(forId: string | undefined): { forId?: string } {
  return forId === undefined ? {} : { forId };
}

function optionalSemanticCallId(semanticCallId: string | undefined): { semanticCallId?: string } {
  return semanticCallId === undefined ? {} : { semanticCallId };
}
