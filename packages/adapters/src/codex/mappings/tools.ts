import type { MappingDef, TrailEntryDraft } from "@agent-trail/adapter-kit";
import { defineMapping } from "@agent-trail/adapter-kit";
import type { ToolKind } from "@agent-trail/types";
import { isNonEmptyString } from "../../shared/task-plan.js";
import { userQueryPayloadFromInput } from "../../shared/user-query.js";
import {
  canonicalCustomToolName,
  mapTool,
  parseFunctionArguments,
  patchFiles,
  patchSingleFilePath,
  stripSpinner,
} from "../parser.js";
import { isObject, numericValue, stringValue } from "../source.js";
import {
  emittable,
  meta,
  payloadOf,
  type Raw,
  source,
  taskPlanItemsFromUpdatePlan,
} from "./shared.js";

function userQueryPayload(args: Raw): { questions: Record<string, unknown>[] } | undefined {
  return userQueryPayloadFromInput(args, {
    fallbackId: (_question, fallbackIndex) =>
      fallbackIndex === 0 ? "question" : `question-${fallbackIndex}`,
    includeIsOther: true,
    stringValue,
    isNonEmptyString,
  });
}

function taskPlanUpdateDraft(
  parsedArgs: Raw,
  callId: string | undefined,
  raw: Raw | undefined,
): TrailEntryDraft | undefined {
  const taskPlanItems = taskPlanItemsFromUpdatePlan(parsedArgs);
  if (taskPlanItems === undefined) return undefined;
  const explanation = stringValue(parsedArgs.explanation);
  const taskPlanCallId = isNonEmptyString(callId) ? callId : undefined;
  return {
    type: "task_plan_update",
    payload: {
      ...(explanation !== undefined ? { explanation } : {}),
      items: taskPlanItems,
    },
    ...(taskPlanCallId !== undefined ? { semantic: { call_id: taskPlanCallId } } : {}),
    source: source("response_item.function_call", raw),
    meta: meta("response_item.function_call", taskPlanCallId),
  };
}

function userQueryDraft(
  parsedArgs: Raw,
  callId: string | undefined,
  raw: Raw | undefined,
): TrailEntryDraft | undefined {
  const payload = userQueryPayload(parsedArgs);
  if (payload === undefined) return undefined;
  const queryCallId = isNonEmptyString(callId) ? callId : undefined;
  return {
    type: "user_query",
    payload,
    ...(queryCallId !== undefined ? { semantic: { call_id: queryCallId } } : {}),
    source: source("response_item.function_call", raw),
    meta: meta("response_item.function_call", queryCallId),
  };
}

function functionToolCallDraft(
  name: string | undefined,
  parsedArgs: Raw,
  callId: string | undefined,
  raw: Raw | undefined,
): TrailEntryDraft {
  const mapping = mapTool(name, parsedArgs);
  return {
    type: "tool_call",
    payload: { tool: mapping.tool, args: mapping.args },
    semantic: { tool_kind: mapping.tool },
    source: source("response_item.function_call", raw),
    meta: meta("response_item.function_call", callId),
  };
}

const functionCall = defineMapping<Raw>({
  match: { type: "response_item", payload: { type: "function_call" } },
  emit: (record) => {
    if (!emittable(record)) return [];
    const p = payloadOf(record);
    const callId = stringValue(p.call_id);
    const parsed = parseFunctionArguments(p.arguments);
    const name = stringValue(p.name);
    const raw =
      parsed.rawUnparseable !== undefined ? { arguments: parsed.rawUnparseable } : undefined;
    const taskPlanDraft =
      name === "update_plan" ? taskPlanUpdateDraft(parsed.args, callId, raw) : undefined;
    if (taskPlanDraft !== undefined) return [taskPlanDraft];
    if (name === "request_user_input") {
      const draft = userQueryDraft(parsed.args, callId, raw);
      if (draft !== undefined) return [draft];
    }
    return [functionToolCallDraft(name, parsed.args, callId, raw)];
  },
});

const customToolCall = defineMapping<Raw>({
  match: { type: "response_item", payload: { type: "custom_tool_call" } },
  emit: (record) => {
    if (!emittable(record)) return [];
    const p = payloadOf(record);
    const callId = stringValue(p.call_id);
    const input = stringValue(p.input) ?? "";
    const canonicalName = canonicalCustomToolName(stringValue(p.name));
    let tool: ToolKind = "other";
    let args: Raw = { name: canonicalName, args: { input } };
    if (canonicalName === "apply_patch") {
      const files = patchFiles(input);
      if (files.length > 1) {
        tool = "file_patch";
        args = { files, atomic: true };
      } else if (files.length === 1) {
        tool = "file_edit";
        args = files[0] as { path: string; diff: string };
      } else {
        const path = patchSingleFilePath(input);
        if (path !== undefined) {
          tool = "file_edit";
          args = { path, diff: input };
        }
      }
    }
    return [
      {
        type: "tool_call",
        payload: { tool, args },
        semantic: { tool_kind: tool },
        source: source("response_item.custom_tool_call"),
        meta: meta("response_item.custom_tool_call", callId),
      },
    ];
  },
});

function functionCallOutputText(rawOutput: unknown): string {
  const body = isObject(rawOutput) && "body" in rawOutput ? rawOutput.body : rawOutput;
  if (typeof body === "string") return body;
  if (body === undefined) return "";
  return JSON.stringify(body);
}

function functionCallOutputOk(payload: Raw, rawOutput: unknown): boolean {
  if (isObject(rawOutput) && typeof rawOutput.success === "boolean") return rawOutput.success;
  return payload.success !== false;
}

function toolResult(
  payloadType: "function_call_output" | "custom_tool_call_output",
): MappingDef<Raw> {
  const rawType = `response_item.${payloadType}`;
  return defineMapping<Raw>({
    match: { type: "response_item", payload: { type: payloadType } },
    emit: (record) => {
      if (!emittable(record)) return [];
      const p = payloadOf(record);
      const callId = stringValue(p.call_id);
      const rawOutput = p.output;
      const output = stripSpinner(functionCallOutputText(rawOutput));
      const ok = functionCallOutputOk(p, rawOutput);
      return [
        {
          type: "tool_result",
          payload: {
            ok,
            output,
            ...(!ok && output.length > 0 ? { error: output } : {}),
          },
          source: source(rawType),
          meta: meta(rawType, callId),
        },
      ];
    },
  });
}

const webSearchCall = defineMapping<Raw>({
  match: { type: "response_item", payload: { type: "web_search_call" } },
  emit: (record) => {
    if (!emittable(record)) return [];
    const p = payloadOf(record);
    const action = isObject(p.action) ? p.action : {};
    const actionType = stringValue(action.type);
    const queries = Array.isArray(action.queries) ? action.queries : [];
    const firstQuery = queries.find((q): q is string => typeof q === "string");
    const query = firstQuery ?? stringValue(action.query);
    let tool: ToolKind;
    let payload: Raw;
    if (actionType === "search" && query !== undefined) {
      tool = "web_search";
      payload = { tool, args: { query } };
    } else if (actionType === "open_page" && stringValue(action.url) !== undefined) {
      tool = "web_fetch";
      payload = { tool, args: { url: stringValue(action.url) } };
    } else {
      tool = "other";
      payload = { tool, args: { name: "web_search_call", args: { action } } };
    }
    return [
      {
        type: "tool_call",
        payload,
        semantic: { tool_kind: tool },
        source: source("response_item.web_search_call"),
        meta: meta("response_item.web_search_call"),
      },
    ];
  },
});

const toolSearchCall = defineMapping<Raw>({
  match: { type: "response_item", payload: { type: "tool_search_call" } },
  emit: (record) => {
    if (!emittable(record)) return [];
    const p = payloadOf(record);
    const callId = stringValue(p.call_id);
    const parsed = parseFunctionArguments(p.arguments);
    const query = stringValue(parsed.args.query) ?? stringValue(parsed.args.q);
    const limit = numericValue(parsed.args.limit) ?? numericValue(parsed.args.top_k);
    const raw =
      parsed.rawUnparseable !== undefined ? { arguments: parsed.rawUnparseable } : undefined;
    const args: Raw = query !== undefined ? { query } : {};
    if (limit !== undefined) args.limit = Math.trunc(limit);
    const payload =
      query !== undefined
        ? { tool: "tool_search", args }
        : { tool: "other", args: { name: "tool_search", args: parsed.args } };
    const tool: ToolKind = query !== undefined ? "tool_search" : "other";
    return [
      {
        type: "tool_call",
        payload,
        semantic: { tool_kind: tool },
        source: source("response_item.tool_search_call", raw),
        meta: meta("response_item.tool_search_call", callId),
      },
    ];
  },
});

const toolSearchOutput = defineMapping<Raw>({
  match: { type: "response_item", payload: { type: "tool_search_output" } },
  emit: (record) => {
    if (!emittable(record)) return [];
    const p = payloadOf(record);
    const callId = stringValue(p.call_id);
    const output = Array.isArray(p.tools) ? JSON.stringify(p.tools) : (stringValue(p.output) ?? "");
    return [
      {
        type: "tool_result",
        payload: { ok: true, output },
        source: source("response_item.tool_search_output"),
        meta: meta("response_item.tool_search_output", callId),
      },
    ];
  },
});

export const toolMappings: MappingDef<Raw>[] = [
  functionCall,
  toolResult("function_call_output"),
  customToolCall,
  toolResult("custom_tool_call_output"),
  webSearchCall,
  toolSearchCall,
  toolSearchOutput,
];
