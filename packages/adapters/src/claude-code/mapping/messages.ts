import { createHash } from "node:crypto";
import type { TrailEntryDraft } from "@agent-trail/adapter-kit";
import { defineMapping } from "@agent-trail/adapter-kit";
import type { ToolKind } from "@agent-trail/types";
import {
  isNonEmptyString,
  isTaskPlanStatus,
  normalizeTaskPlanContent,
  type TaskPlanItem,
  taskPlanItemId,
} from "../../shared/task-plan.js";
import { mapAgentMessageUsage } from "../../shared/usage.js";
import { userQueryPayloadFromInput } from "../../shared/user-query.js";
import {
  asBlocks,
  type CcEnvelope,
  isContinuationPreamble,
  isInterruptMarker,
  isObject,
  jsonObjectValue,
  jsonString,
  stringValue,
  textFromToolResultContent,
} from "../source.js";
import { toolKindAndArgs } from "../tools.js";
import { attributionMeta, gate, imageAttachments, meta, type Raw, src } from "./shared.js";

function questionId(question: string, occurrence: number): string {
  const base = `q_${createHash("sha256").update(question).digest("hex").slice(0, 12)}`;
  return occurrence === 0 ? base : `${base}_${occurrence + 1}`;
}

function userQueryPayload(input: unknown): { questions: Record<string, unknown>[] } | undefined {
  return userQueryPayloadFromInput(input, {
    fallbackId: questionId,
    fallbackIndex: (question, _index, occurrences) => {
      const text = stringValue(question.question);
      const occurrence = text === undefined ? 0 : (occurrences.get(text) ?? 0);
      if (text !== undefined) occurrences.set(text, occurrence + 1);
      return occurrence;
    },
    stringValue,
    isNonEmptyString,
  });
}

function taskPlanItemsFromTodoWrite(input: unknown): TaskPlanItem[] | undefined {
  const args = jsonObjectValue(input) ?? {};
  if (!Array.isArray(args.todos)) return undefined;
  const items: TaskPlanItem[] = [];
  const occurrenceByContent = new Map<string, number>();
  for (const rawTodo of args.todos) {
    const item = taskPlanItemFromRaw(rawTodo, occurrenceByContent);
    if (item === undefined) return undefined;
    items.push(item);
  }
  return items;
}

function taskPlanItemFromRaw(
  rawTodo: unknown,
  occurrenceByContent: Map<string, number>,
): TaskPlanItem | undefined {
  if (!isObject(rawTodo)) return undefined;
  const content = stringValue(rawTodo.content);
  const status = rawTodo.status;
  if (content === undefined || !isTaskPlanStatus(status)) return undefined;
  const occurrence = nextTaskOccurrence(occurrenceByContent, content);
  const activeForm = stringValue(rawTodo.activeForm) ?? stringValue(rawTodo.active_form);
  return {
    id: taskPlanItemId(rawTodo.id, occurrence, content),
    content,
    status,
    ...(activeForm !== undefined ? { active_form: activeForm } : {}),
  };
}

function nextTaskOccurrence(occurrenceByContent: Map<string, number>, content: string): number {
  const normalized = normalizeTaskPlanContent(content);
  const occurrence = occurrenceByContent.get(normalized) ?? 0;
  occurrenceByContent.set(normalized, occurrence + 1);
  return occurrence;
}

const userMessage = defineMapping<Raw>({
  match: { type: "user" },
  emit: (raw) => emitUserMessage(raw as CcEnvelope),
});

function emitUserMessage(record: CcEnvelope): TrailEntryDraft[] {
  if (!gate(record)) return [];
  const drafts = userMessageDrafts(record);
  const attribution = attributionMeta(record);
  return attribution === undefined
    ? drafts
    : drafts.map((draft) => ({ ...draft, meta: { ...attribution, ...(draft.meta ?? {}) } }));
}

function userMessageDrafts(record: CcEnvelope): TrailEntryDraft[] {
  if (record.isCompactSummary === true) return compactUserDraft(record);
  const content = record.message?.content;
  if (typeof content === "string") return userTextDraft(record, content, "session_start");
  return userBlockDraftsWithImages(record, content);
}

function compactUserDraft(record: CcEnvelope): TrailEntryDraft[] {
  const text =
    stringValue(record.summary) ??
    stringValue(record.message?.content) ??
    jsonString(record.message?.content);
  return [
    {
      type: "context_compact",
      payload: { summary: text, trigger: "auto" },
      source: src(record, "user"),
      meta: meta(record),
    },
  ];
}

function userTextDraft(
  record: CcEnvelope,
  text: string,
  continuationKind: "session_start" | "x-claudecode/system",
  block?: Record<string, unknown>,
  blockIndex?: number,
): TrailEntryDraft[] {
  const source = src(record, block === undefined ? "user" : "text", block, blockIndex);
  const interrupt = isInterruptMarker(text);
  if (interrupt !== undefined) {
    return [
      { type: "user_interrupt", payload: { reason: interrupt.reason }, source, meta: meta(record) },
    ];
  }
  if (isContinuationPreamble(text)) {
    return [
      {
        type: "system_event",
        payload: { kind: continuationKind, text },
        source,
        meta: meta(record),
      },
    ];
  }
  return [{ type: "user_message", payload: { text }, source, meta: meta(record) }];
}

function userBlockDraftsWithImages(record: CcEnvelope, content: unknown): TrailEntryDraft[] {
  const images = imageAttachments(content);
  const drafts = userContentBlocks(content).flatMap((block, index) =>
    userBlockDraft(record, block, index),
  );
  return images.length === 0 ? drafts : attachImagesToUserDraft(record, drafts, images);
}

function userContentBlocks(content: unknown): Record<string, unknown>[] {
  return asBlocks(content).filter((block) => block.type === "text" || block.type === "tool_result");
}

function userBlockDraft(
  record: CcEnvelope,
  block: Record<string, unknown>,
  index: number,
): TrailEntryDraft[] {
  const envelopeRef = index > 0 ? "" : undefined;
  if (block.type === "text" && typeof block.text === "string") {
    const source = src(record, "text", block, index, { envelopeRef });
    return userTextDraft(record, block.text, "x-claudecode/system", block, index).map((draft) => ({
      ...draft,
      source,
    }));
  }
  if (block.type !== "tool_result") return [];
  const source = src(record, "tool_result", block, index, { envelopeRef });
  return [toolResultDraft(record, block, source)];
}

function toolResultDraft(
  record: CcEnvelope,
  block: Record<string, unknown>,
  source: TrailEntryDraft["source"],
): TrailEntryDraft {
  const callId = stringValue(block.tool_use_id);
  const ok = block.is_error !== true;
  const output = textFromToolResultContent(block.content);
  return {
    type: "tool_result",
    payload: {
      ok,
      ...(output.length > 0 ? { output } : {}),
      ...(!ok && output.length > 0 ? { error: output } : {}),
    },
    source,
    meta: meta(record, { callId }),
  };
}

function attachImagesToUserDraft(
  record: CcEnvelope,
  drafts: TrailEntryDraft[],
  images: ReturnType<typeof imageAttachments>,
): TrailEntryDraft[] {
  const index = drafts.findIndex((draft) => draft.type === "user_message");
  if (index < 0) {
    return [
      {
        type: "user_message",
        payload: { text: "", attachments: images },
        source: src(record, "user"),
        meta: meta(record),
      },
      ...drafts,
    ];
  }
  const owner = drafts[index];
  if (owner === undefined) return drafts;
  drafts[index] = {
    ...owner,
    payload: { ...(owner.payload ?? {}), attachments: images },
  };
  return drafts;
}

const assistantMessage = defineMapping<Raw>({
  match: { type: "assistant" },
  emit: (raw) => emitAssistantMessage(raw as CcEnvelope),
});

type AssistantContext = {
  record: CcEnvelope;
  model: string | undefined;
  consumeUsage: () => ReturnType<typeof mapAgentMessageUsage> | undefined;
  semantic: (extra?: Record<string, unknown>) => Record<string, unknown> | undefined;
};

function emitAssistantMessage(record: CcEnvelope): TrailEntryDraft[] {
  if (!gate(record)) return [];
  const context = assistantContext(record);
  return assistantBlocks(record).flatMap((block, index) =>
    assistantBlockDraft(context, block, index),
  );
}

function assistantBlocks(record: CcEnvelope): Record<string, unknown>[] {
  return asBlocks(record.message?.content).filter(
    (block) =>
      block.type === "text" ||
      block.type === "thinking" ||
      block.type === "redacted_thinking" ||
      block.type === "tool_use",
  );
}

function assistantContext(record: CcEnvelope): AssistantContext {
  const model = stringValue(record.message?.model);
  const usage = mapAgentMessageUsage(record.message?.usage);
  let usageEmitted = false;
  const groupId = stringValue(record.requestId);
  return {
    record,
    model,
    consumeUsage: () => {
      const blockUsage = !usageEmitted ? usage : undefined;
      if (blockUsage !== undefined) usageEmitted = true;
      return blockUsage;
    },
    semantic: (extra) => semanticWithGroup(groupId, extra),
  };
}

function semanticWithGroup(
  groupId: string | undefined,
  extra?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const semantic = { ...(groupId !== undefined ? { group_id: groupId } : {}), ...(extra ?? {}) };
  return Object.keys(semantic).length > 0 ? semantic : undefined;
}

function assistantBlockDraft(
  context: AssistantContext,
  block: Record<string, unknown>,
  index: number,
): TrailEntryDraft[] {
  const source = src(context.record, String(block.type), block, index, {
    envelopeRef: index > 0 ? "" : undefined,
  });
  if (block.type === "text" && typeof block.text === "string") {
    return [assistantTextDraft(context, block.text, source)];
  }
  if (block.type === "thinking" || block.type === "redacted_thinking") {
    return [assistantThinkingDraft(context, block, source)];
  }
  return block.type === "tool_use" ? assistantToolDraft(context, block, source) : [];
}

function assistantTextDraft(
  context: AssistantContext,
  text: string,
  source: TrailEntryDraft["source"],
): TrailEntryDraft {
  const blockUsage = context.consumeUsage();
  const semantic = context.semantic();
  return {
    type: "agent_message",
    payload: {
      text,
      ...optionalModel(context.model),
      ...(typeof context.record.message?.stop_reason === "string"
        ? { stop_reason: context.record.message.stop_reason }
        : {}),
      ...(blockUsage !== undefined ? { usage: blockUsage } : {}),
    },
    ...(semantic !== undefined ? { semantic } : {}),
    source,
    meta: meta(context.record, { model: context.model }),
  };
}

function assistantThinkingDraft(
  context: AssistantContext,
  block: Record<string, unknown>,
  source: TrailEntryDraft["source"],
): TrailEntryDraft {
  const text =
    stringValue(block.thinking) ??
    stringValue(block.data) ??
    (block.type === "redacted_thinking" ? "[redacted thinking]" : "");
  const blockUsage = context.consumeUsage();
  const semantic = context.semantic();
  return {
    type: "agent_thinking",
    payload: {
      text,
      ...optionalModel(context.model),
      ...(blockUsage !== undefined ? { usage: blockUsage } : {}),
    },
    ...(semantic !== undefined ? { semantic } : {}),
    source,
    meta: meta(context.record, { model: context.model }),
  };
}

function assistantToolDraft(
  context: AssistantContext,
  block: Record<string, unknown>,
  source: TrailEntryDraft["source"],
): TrailEntryDraft[] {
  return (
    taskPlanDraft(context, block, source) ??
    userQueryDraft(context, block, source) ?? [genericToolCallDraft(context, block, source)]
  );
}

function taskPlanDraft(
  context: AssistantContext,
  block: Record<string, unknown>,
  source: TrailEntryDraft["source"],
): TrailEntryDraft[] | undefined {
  const callId = stringValue(block.id);
  if (stringValue(block.name) !== "TodoWrite") return undefined;
  const items = taskPlanItemsFromTodoWrite(block.input);
  if (items === undefined) return undefined;
  const taskPlanCallId = isNonEmptyString(callId) ? callId : undefined;
  const semantic = context.semantic(
    taskPlanCallId !== undefined ? { call_id: taskPlanCallId } : undefined,
  );
  return [
    {
      type: "task_plan_update",
      payload: { items },
      ...(semantic !== undefined ? { semantic } : {}),
      source,
      meta: meta(context.record, { model: context.model, callId: taskPlanCallId }),
    } as TrailEntryDraft,
  ];
}

function userQueryDraft(
  context: AssistantContext,
  block: Record<string, unknown>,
  source: TrailEntryDraft["source"],
): TrailEntryDraft[] | undefined {
  const callId = stringValue(block.id);
  if (stringValue(block.name) !== "AskUserQuestion") return undefined;
  const payload = userQueryPayload(block.input);
  if (payload === undefined) return undefined;
  const queryCallId = isNonEmptyString(callId) ? callId : undefined;
  const semantic = context.semantic(
    queryCallId !== undefined ? { call_id: queryCallId } : undefined,
  );
  return [
    {
      type: "user_query",
      payload,
      ...(semantic !== undefined ? { semantic } : {}),
      source,
      meta: meta(context.record, { model: context.model, callId: queryCallId }),
    },
  ];
}

function genericToolCallDraft(
  context: AssistantContext,
  block: Record<string, unknown>,
  source: TrailEntryDraft["source"],
): TrailEntryDraft {
  const callId = stringValue(block.id);
  const mapped = toolKindAndArgs(stringValue(block.name), block.input);
  const blockUsage = context.consumeUsage();
  return {
    type: "tool_call",
    payload: { ...mapped, ...(blockUsage !== undefined ? { usage: blockUsage } : {}) },
    semantic: context.semantic({
      ...(callId !== undefined ? { call_id: callId } : {}),
      tool_kind: mapped.tool as ToolKind,
    }),
    source,
    meta: meta(context.record, { model: context.model, callId }),
  };
}

function optionalModel(model: string | undefined): Record<string, string> {
  return model === undefined ? {} : { model };
}

const summary = defineMapping<Raw>({
  match: { type: "summary" },
  emit: (raw) => {
    const record = raw as CcEnvelope;
    if (!gate(record)) return [];
    const text =
      stringValue(record.summary) ??
      stringValue(record.message?.content) ??
      jsonString(record.message?.content);
    if (text === undefined) return [];
    if (record.isCompactSummary === true) {
      return [
        {
          type: "context_compact",
          payload: { summary: text, trigger: "auto" },
          source: src(record, "summary"),
          meta: meta(record),
        },
      ];
    }
    return [
      {
        type: "session_summary",
        payload: { scope: "session", text },
        // v1 always emits a `semantic` object (empty when there is no leafUuid).
        semantic: typeof record.leafUuid === "string" ? { group_id: record.leafUuid } : {},
        source: src(record, "summary"),
        meta: meta(record),
      },
    ];
  },
});

export const messageMappings = [userMessage, assistantMessage, summary];
