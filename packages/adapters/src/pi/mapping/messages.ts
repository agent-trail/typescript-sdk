import type { MappingDef, TrailEntryDraft } from "@agent-trail/adapter-kit";
import { defineMapping } from "@agent-trail/adapter-kit";
import type { ToolKind } from "@agent-trail/types";
import { mapAgentMessageUsage } from "../../legacy-kit-helpers.js";
import {
  asBlocks,
  idValue,
  isObject,
  type PiBlock,
  type PiEnvelope,
  stringValue,
  textFromContent,
} from "../source.js";
import { toolKindAndArgs } from "../tools.js";
import type { PiMappingContext } from "./context.js";
import { metaFor } from "./shared.js";

export function messageMappings(ctx: PiMappingContext): MappingDef<PiEnvelope>[] {
  const userMessage = defineMapping<PiEnvelope>({
    match: { type: "message", message: { role: "user" } },
    emit: (record) => emitUserMessage(ctx, record),
  });

  const assistantMessage = defineMapping<PiEnvelope>({
    match: { type: "message", message: { role: "assistant" } },
    emit: (record) => emitAssistantMessage(ctx, record),
  });

  const toolResult = defineMapping<PiEnvelope>({
    match: { type: "message", message: { role: "toolResult" } },
    emit: (record) => emitToolResult(ctx, record),
  });

  const bashExecution = defineMapping<PiEnvelope>({
    match: { type: "message", message: { role: "bashExecution" } },
    emit: (record) => emitBashExecution(ctx, record),
  });

  return [userMessage, assistantMessage, toolResult, bashExecution];
}

function emitUserMessage(ctx: PiMappingContext, record: PiEnvelope): TrailEntryDraft[] {
  if (ctx.emittableTs(record) === null) return [];
  const msg = record.message as NonNullable<PiEnvelope["message"]>;
  const text = typeof msg.content === "string" ? msg.content : textFromContent(msg.content);
  return [
    {
      type: "user_message",
      payload: { text },
      source: ctx.src(record, "message"),
      meta: metaFor(record, "user_message_envelope"),
    },
  ];
}

function emitAssistantMessage(ctx: PiMappingContext, record: PiEnvelope): TrailEntryDraft[] {
  if (ctx.emittableTs(record) === null) return [];
  const msg = record.message as NonNullable<PiEnvelope["message"]>;
  const model = stringValue(msg.model);
  const stopReason = stringValue(msg.stopReason);
  const usage = mapAgentMessageUsage(msg.usage);
  const consumeUsage = once(() => usage);
  const out =
    typeof msg.content === "string"
      ? [assistantTextEntry(ctx, record, msg.content, model, stopReason, consumeUsage())]
      : assistantBlockEntries(ctx, record, asBlocks(msg.content), model, stopReason, consumeUsage);
  if (msg.stopReason === "aborted") out.push(abortedAssistantEntry(ctx, record, model));
  return out;
}

function assistantBlockEntries(
  ctx: PiMappingContext,
  record: PiEnvelope,
  blocks: PiBlock[],
  model: string | undefined,
  stopReason: string | undefined,
  consumeUsage: () => ReturnType<typeof mapAgentMessageUsage>,
): TrailEntryDraft[] {
  const out: TrailEntryDraft[] = [];
  for (const [emittedIndex, item] of emittableAssistantBlocks(blocks).entries()) {
    const envelopeRef = emittedIndex > 0 ? "" : undefined;
    const entry = assistantBlockEntry(
      ctx,
      record,
      item,
      model,
      stopReason,
      envelopeRef,
      consumeUsage,
    );
    if (entry !== undefined) out.push(entry);
  }
  return out;
}

function emittableAssistantBlocks(
  blocks: PiBlock[],
): Array<{ block: PiBlock; originalIndex: number }> {
  return blocks
    .map((block, originalIndex) => ({ block, originalIndex }))
    .filter(
      ({ block }) =>
        block.type === "text" || block.type === "toolCall" || block.type === "thinking",
    );
}

function assistantBlockEntry(
  ctx: PiMappingContext,
  record: PiEnvelope,
  item: { block: PiBlock; originalIndex: number },
  model: string | undefined,
  stopReason: string | undefined,
  envelopeRef: string | undefined,
  consumeUsage: () => ReturnType<typeof mapAgentMessageUsage>,
): TrailEntryDraft | undefined {
  const { block, originalIndex } = item;
  if (block.type === "text" && typeof block.text === "string") {
    return assistantTextEntry(ctx, record, block.text, model, stopReason, consumeUsage(), {
      block,
      originalIndex,
      envelopeRef,
    });
  }
  if (block.type === "thinking") {
    return assistantThinkingEntry(
      ctx,
      record,
      block,
      model,
      consumeUsage(),
      envelopeRef,
      originalIndex,
    );
  }
  if (block.type === "toolCall") {
    return assistantToolCallEntry(
      ctx,
      record,
      block,
      model,
      consumeUsage(),
      envelopeRef,
      originalIndex,
    );
  }
  return undefined;
}

function assistantTextEntry(
  ctx: PiMappingContext,
  record: PiEnvelope,
  text: string,
  model: string | undefined,
  stopReason: string | undefined,
  usage: ReturnType<typeof mapAgentMessageUsage>,
  sourceBlock?: { block: PiBlock; originalIndex: number; envelopeRef: string | undefined },
): TrailEntryDraft {
  return {
    type: "agent_message",
    payload: {
      text,
      ...(model !== undefined ? { model } : {}),
      ...(stopReason !== undefined ? { stop_reason: stopReason } : {}),
      ...(usage !== undefined ? { usage } : {}),
    },
    source:
      sourceBlock === undefined
        ? ctx.src(record, "message")
        : ctx.src(record, "text", sourceBlock.block, sourceBlock.originalIndex, {
            envelopeRef: sourceBlock.envelopeRef,
          }),
    meta: metaFor(
      record,
      sourceBlock === undefined ? "assistant_string_content" : "assistant_text_block",
      undefined,
      { model },
    ),
  };
}

function assistantThinkingEntry(
  ctx: PiMappingContext,
  record: PiEnvelope,
  block: PiBlock,
  model: string | undefined,
  usage: ReturnType<typeof mapAgentMessageUsage>,
  envelopeRef: string | undefined,
  originalIndex: number,
): TrailEntryDraft {
  const rawThinking = typeof block.thinking === "string" ? block.thinking : "";
  const redacted = block.redacted === true && rawThinking.length === 0;
  return {
    type: "agent_thinking",
    payload: {
      text: redacted ? "[redacted thinking]" : rawThinking,
      ...(model !== undefined ? { model } : {}),
      ...(usage !== undefined ? { usage } : {}),
    },
    source: ctx.src(record, "thinking", block, originalIndex, { envelopeRef }),
    meta: metaFor(
      record,
      redacted ? "assistant_redacted_thinking_block" : "assistant_thinking_block",
      undefined,
      { model },
    ),
  };
}

function assistantToolCallEntry(
  ctx: PiMappingContext,
  record: PiEnvelope,
  block: PiBlock,
  model: string | undefined,
  usage: ReturnType<typeof mapAgentMessageUsage>,
  envelopeRef: string | undefined,
  originalIndex: number,
): TrailEntryDraft {
  const name = stringValue(block.name);
  const callId = idValue(block.id);
  const mapped = toolKindAndArgs(name, block.arguments);
  return {
    type: "tool_call",
    payload: { ...mapped, ...(usage !== undefined ? { usage } : {}) },
    semantic: {
      ...(callId !== undefined ? { call_id: callId } : {}),
      tool_kind: mapped.tool as ToolKind,
    },
    source: ctx.src(record, "toolCall", block, originalIndex, { envelopeRef }),
    meta: {
      ...(callId !== undefined ? { linker: { call_id: callId } } : {}),
      ...metaFor(record, "assistant_toolcall_block", undefined, { model }),
    },
  };
}

function abortedAssistantEntry(
  ctx: PiMappingContext,
  record: PiEnvelope,
  model: string | undefined,
): TrailEntryDraft {
  return {
    type: "user_interrupt",
    payload: { reason: "stop_reason_aborted" },
    source: ctx.src(record, "assistant", undefined, undefined, { synthesized: true }),
    meta: metaFor(record, "aborted_assistant_synthetic", undefined, { model }),
  };
}

function emitToolResult(ctx: PiMappingContext, record: PiEnvelope): TrailEntryDraft[] {
  if (ctx.emittableTs(record) === null) return [];
  const msg = record.message as NonNullable<PiEnvelope["message"]>;
  const callId = idValue(msg.toolCallId);
  const ok = msg.isError !== true;
  const output = textFromContent(msg.content);
  const piMeta = toolResultPiMeta(msg);
  return [
    {
      type: "tool_result",
      payload: {
        ok,
        ...(output.length > 0 ? { output } : {}),
        ...(!ok && output.length > 0 ? { error: output } : {}),
      },
      source: ctx.src(record, "message"),
      meta: {
        ...(callId !== undefined ? { linker: { call_id: callId } } : {}),
        ...metaFor(record, "tool_result_envelope", nonEmpty(piMeta)),
      },
    },
  ];
}

function toolResultPiMeta(msg: NonNullable<PiEnvelope["message"]>): Record<string, unknown> {
  const details = isObject(msg.details) ? msg.details : undefined;
  const toolMetadata = isObject(details?.toolMetadata) ? details.toolMetadata : undefined;
  const contextAtCompletion = isObject(toolMetadata?.contextAtCompletion)
    ? toolMetadata.contextAtCompletion
    : undefined;
  const toolName = stringValue(msg.toolName);
  return {
    ...(contextAtCompletion !== undefined
      ? { "dev.pi.context_at_completion": contextAtCompletion }
      : {}),
    ...(toolName !== undefined ? { "dev.pi.tool_name": toolName } : {}),
  };
}

function emitBashExecution(ctx: PiMappingContext, record: PiEnvelope): TrailEntryDraft[] {
  if (ctx.emittableTs(record) === null) return [];
  const msg = record.message as NonNullable<PiEnvelope["message"]>;
  const command = stringValue(msg.command);
  if (command === undefined) return [];
  const callId = `x-pi/bash:${record.id}`;
  const call = bashToolCall(ctx, record, msg, command, callId);
  return msg.cancelled === true
    ? [call, bashToolAborted(ctx, record, msg, callId)]
    : [call, bashToolResult(ctx, record, msg, callId)];
}

function bashToolCall(
  ctx: PiMappingContext,
  record: PiEnvelope,
  msg: NonNullable<PiEnvelope["message"]>,
  command: string,
  callId: string,
): TrailEntryDraft {
  const callMeta: Record<string, unknown> = { "dev.pi.user_shell": true };
  if (msg.excludeFromContext === true) callMeta["dev.pi.exclude_from_context"] = true;
  return {
    type: "tool_call",
    payload: { tool: "shell_command", args: { command } },
    semantic: { call_id: callId, tool_kind: "shell_command" },
    source: ctx.src(record, "bashExecution"),
    meta: { linker: { call_id: callId }, ...metaFor(record, "bash_execution", callMeta) },
  };
}

function bashToolAborted(
  ctx: PiMappingContext,
  record: PiEnvelope,
  msg: NonNullable<PiEnvelope["message"]>,
  callId: string,
): TrailEntryDraft {
  return {
    type: "tool_call_aborted",
    payload: { scope: "tool_call", reason: "user_interrupt" },
    source: ctx.src(record, "bashExecution"),
    meta: {
      linker: { call_id: callId },
      ...metaFor(record, "bash_execution", nonEmpty(bashResultMeta(msg, true))),
    },
  };
}

function bashToolResult(
  ctx: PiMappingContext,
  record: PiEnvelope,
  msg: NonNullable<PiEnvelope["message"]>,
  callId: string,
): TrailEntryDraft {
  const exitCode = typeof msg.exitCode === "number" ? msg.exitCode : undefined;
  const output = stringValue(msg.output);
  return {
    type: "tool_result",
    payload: {
      ok: exitCode === undefined || exitCode === 0,
      ...(output !== undefined && output.length > 0 ? { output } : {}),
      ...(exitCode !== undefined ? { meta: { shell_command: { exit_code: exitCode } } } : {}),
    },
    semantic: { call_id: callId, tool_kind: "shell_command" },
    source: ctx.src(record, "bashExecution"),
    meta: {
      linker: { call_id: callId },
      ...metaFor(record, "bash_execution", nonEmpty(bashResultMeta(msg, false))),
    },
  };
}

function bashResultMeta(
  msg: NonNullable<PiEnvelope["message"]>,
  cancelled: boolean,
): Record<string, unknown> {
  const fullOutputPath = stringValue(msg.fullOutputPath);
  return {
    ...(msg.truncated === true ? { "dev.pi.truncated": true } : {}),
    ...(cancelled ? { "dev.pi.cancelled": true } : {}),
    ...(fullOutputPath !== undefined ? { "dev.pi.full_output_path": fullOutputPath } : {}),
  };
}

function once<T>(read: () => T | undefined): () => T | undefined {
  let consumed = false;
  return () => {
    if (consumed) return undefined;
    const value = read();
    if (value !== undefined) consumed = true;
    return value;
  };
}

function nonEmpty(value: Record<string, unknown>): Record<string, unknown> | undefined {
  return Object.keys(value).length > 0 ? value : undefined;
}
