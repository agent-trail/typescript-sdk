import type { AgentMessageUsage, Attachment, Entry, Header, ToolKind } from "@agent-trail/types";
import { deriveSynthesizedEntryId, OPENCODE_ENTRY_ID_NAMESPACE } from "../shared/session-uid.js";
import { mapAgentMessageUsage } from "../shared/usage.js";
import { attachmentFrom, attachmentsFrom } from "./attachments.js";
import {
  compactDiffs,
  todoItemsFrom,
  tokenTotalsFromSession,
  worktreeFromProject,
} from "./metadata.js";
import {
  arrayValue,
  type LoadedSession,
  metaFor,
  numberValue,
  objectValue,
  partTimestamp,
  type Raw,
  SOURCE_SCHEMA_VERSION,
  sourceFor,
  sourceId,
  stringValue,
  timestampToIso,
} from "./source.js";
import { mapTool } from "./tools.js";

const KNOWN_PART_TYPES = new Set([
  "text",
  "subtask",
  "reasoning",
  "file",
  "tool",
  "step-start",
  "step-finish",
  "snapshot",
  "patch",
  "agent",
  "retry",
  "compaction",
]);
const USAGE_CAPABLE_PART_TYPES = new Set(["text", "reasoning", "tool", "subtask"]);

type EntryDraft = Omit<Entry, "id" | "parent_id">;
type PushEntry = (draft: EntryDraft, sourceKey: string) => Entry;
type UsageConsumer = (part?: Raw) => AgentMessageUsage | undefined;

type MappingContext = {
  loaded: LoadedSession;
  header: Header;
  entries: Entry[];
  push: PushEntry;
  openCalls: Map<string, string>;
  schemaVersion: string;
  sessionModel: string | undefined;
};

function usageFrom(raw: Raw): AgentMessageUsage | undefined {
  const tokens = objectValue(raw.tokens);
  const cache = objectValue(tokens?.cache);
  const usage = mapAgentMessageUsage(usageFields(raw, tokens, cache));
  if (usage === undefined) return undefined;
  return compactUsage(usage);
}

function usageFields(raw: Raw, tokens: Raw | undefined, cache: Raw | undefined): Raw {
  return {
    input: firstNumber(tokens?.input, raw.tokens_input),
    output: firstNumber(tokens?.output, raw.tokens_output),
    total: firstNumber(tokens?.total, raw.tokens_total),
    reasoning_tokens: firstNumber(tokens?.reasoning, raw.tokens_reasoning),
    cache_read_tokens: firstNumber(cache?.read, raw.tokens_cache_read),
    cache_creation_tokens: firstNumber(cache?.write, raw.tokens_cache_write),
  };
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const n = numberValue(value);
    if (n !== undefined) return n;
  }
  return undefined;
}

function compactUsage(
  usage: NonNullable<ReturnType<typeof mapAgentMessageUsage>>,
): AgentMessageUsage {
  const out: Record<string, unknown> = {};
  for (const field of [
    "input_tokens",
    "output_tokens",
    "total_tokens",
    "reasoning_tokens",
    "cache_read_tokens",
    "cache_creation_tokens",
  ] as const) {
    if (usage[field] !== undefined) out[field] = usage[field];
  }
  return out as AgentMessageUsage;
}

export function entriesFromLoaded(loaded: LoadedSession, header: Header): Entry[] {
  const entries: Entry[] = [];
  const openCalls = new Map<string, string>();
  const schemaVersion = SOURCE_SCHEMA_VERSION;
  const sessionModel = header.agent.model_default;

  function push(draft: EntryDraft, sourceKey: string): Entry {
    const id = deriveSynthesizedEntryId(OPENCODE_ENTRY_ID_NAMESPACE, [
      header.session_uid ?? header.id,
      sourceKey,
      String(draft.type),
    ]);
    const entry = { ...draft, id } as Entry;
    entries.push(entry);
    return entry;
  }

  const context = { loaded, header, entries, push, openCalls, schemaVersion, sessionModel };
  pushSessionMetadata(context);
  pushPermissions(context);
  pushMessages(context);

  pushTodos(context);
  pushSessionMessages(context);
  pushOpenToolTermination(context);

  return entries;
}

function pushTodos(context: MappingContext): void {
  const [first] = context.loaded.todos;
  if (first === undefined) return;
  context.push(
    {
      type: "task_plan_update",
      ts: partTimestamp(first),
      payload: { items: todoItemsFrom(context.loaded.todos) },
      source: sourceFor({ todos: context.loaded.todos }, "todo", context.schemaVersion),
      meta: metaFor("todo"),
    },
    "todo",
  );
}

function pushSessionMessages(context: MappingContext): void {
  for (const record of context.loaded.sessionMessages) pushSessionMessage(context, record);
}

function pushSessionMessage(context: MappingContext, record: Raw): void {
  const type = stringValue(record.type);
  const rawType = `session_message.${type ?? "unknown"}`;
  const base = {
    ts: partTimestamp(record),
    source: sourceFor(record, rawType, context.schemaVersion),
    meta: metaFor(rawType),
  };
  const modelChange = type === "model-switched" ? modelChangePayload(record) : undefined;
  if (modelChange !== undefined) {
    context.push(
      { ...base, type: "model_change", payload: modelChange },
      sourceId(record, rawType),
    );
    return;
  }
  context.push(
    {
      ...base,
      type: "system_event",
      payload: { kind: "x-opencode/unknown_record", data: { raw: { ...record } } },
    },
    sourceId(record, rawType),
  );
}

function modelChangePayload(record: Raw): Raw | undefined {
  const toModel =
    stringValue(record.to) ?? stringValue(record.to_model) ?? stringValue(record.model);
  if (toModel === undefined) return undefined;
  return {
    to_model: toModel,
    ...(stringValue(record.from) !== undefined ? { from_model: stringValue(record.from) } : {}),
    ...(stringValue(record.provider) !== undefined
      ? { to_provider: stringValue(record.provider) }
      : {}),
    trigger: "external",
  };
}

function pushOpenToolTermination(context: MappingContext): void {
  if (context.openCalls.size === 0) return;
  context.push(
    {
      type: "session_terminated",
      ts: context.entries.at(-1)?.ts ?? context.header.ts,
      payload: {
        reason: "eof_with_open_tool_calls",
        open_call_ids: [...context.openCalls.values()],
      },
      source: { agent: "opencode", synthesized: true },
      meta: metaFor("session_terminated.eof_with_open_tool_calls"),
    },
    "session-terminated",
  );
}

function pushSessionMetadata(context: MappingContext): void {
  pushMetadata(context, "name", stringValue(context.loaded.session.title), "title");
  pushMetadata(context, "agent.model_default", context.header.agent.model_default, "model");
  pushMetadata(
    context,
    "x-opencode/share_url",
    stringValue(context.loaded.session.share_url),
    "share_url",
  );
  pushMetadata(
    context,
    "x-opencode/token_totals",
    tokenTotalsFromSession(context.loaded.session),
    "token_totals",
  );
  pushNonEmptyMetadata(
    context,
    "x-opencode/session_summary",
    sessionSummary(context.loaded.session),
    "summary",
  );
  pushMetadata(context, "x-opencode/revert", objectValue(context.loaded.session.revert), "revert");
  pushMetadata(
    context,
    "x-opencode/session_permission",
    context.loaded.session.permission,
    "permission",
  );
  pushNonEmptyMetadata(
    context,
    "x-opencode/session_state",
    sessionState(context.loaded.session),
    "state",
  );
  pushProjectWorktree(context);
}

function pushMetadata(
  context: MappingContext,
  field: string,
  value: unknown,
  sourceKey: string,
): void {
  if (value === undefined || value === null) return;
  context.push(
    {
      type: "session_metadata_update",
      ts: context.header.ts,
      payload: { field, value, reason: "external" },
      source: sourceFor(context.loaded.session, `session.${sourceKey}`, context.schemaVersion),
      meta: metaFor(`session.${sourceKey}`),
    },
    `session:${sourceKey}`,
  );
}

function pushNonEmptyMetadata(
  context: MappingContext,
  field: string,
  value: Raw,
  sourceKey: string,
): void {
  if (Object.keys(value).length > 0) pushMetadata(context, field, value, sourceKey);
}

function sessionSummary(session: Raw): Raw {
  const additions = numberValue(session.summary_additions);
  const deletions = numberValue(session.summary_deletions);
  const files = numberValue(session.summary_files);
  const diffs = compactDiffs(session.summary_diffs);
  return {
    ...(additions !== undefined ? { additions } : {}),
    ...(deletions !== undefined ? { deletions } : {}),
    ...(files !== undefined ? { files } : {}),
    ...(diffs !== undefined ? { diffs } : {}),
  };
}

function sessionState(session: Raw): Raw {
  const archivedAt = timestampToIso(session.time_archived);
  const compactingAt = timestampToIso(session.time_compacting);
  const agent = stringValue(session.agent);
  const cost = numberValue(session.cost);
  const metadata = objectValue(session.metadata);
  return {
    ...(archivedAt !== undefined ? { archived_at: archivedAt } : {}),
    ...(compactingAt !== undefined ? { compacting_at: compactingAt } : {}),
    ...(agent !== undefined ? { agent } : {}),
    ...(cost !== undefined ? { cost } : {}),
    ...(metadata !== undefined ? { metadata } : {}),
  };
}

function pushProjectWorktree(context: MappingContext): void {
  const projectWorktree =
    context.header.vcs?.worktree ?? worktreeFromProject(context.loaded.project);
  if (projectWorktree === undefined) return;
  context.push(
    {
      type: "session_metadata_update",
      ts: context.header.ts,
      payload: { field: "vcs.worktree", value: projectWorktree, reason: "runtime_inferred" },
      source: sourceFor(
        context.loaded.project ?? context.loaded.session,
        "project.worktree",
        context.schemaVersion,
      ),
      meta: metaFor("project.worktree"),
    },
    "project:worktree",
  );
}

function pushPermissions(context: MappingContext): void {
  const { loaded, push, schemaVersion } = context;
  for (const permission of loaded.permissions) {
    push(
      {
        type: "system_event",
        ts: partTimestamp(permission),
        payload: {
          kind: "x-opencode/permission_ruleset",
          data: {
            project_id: stringValue(permission.project_id),
            rules: permission.data,
          },
        },
        source: sourceFor(permission, "permission", schemaVersion),
        meta: metaFor("permission"),
      },
      sourceId(permission, `permission:${context.entries.length}`),
    );
  }
}

function pushMessages(context: MappingContext): void {
  for (const message of context.loaded.messages) {
    pushMessageParts(context, message);
  }
}

function pushMessageParts(context: MappingContext, message: Raw & { id: string }): void {
  const role = stringValue(message.role);
  const messageParts = context.loaded.partsByMessage.get(message.id) ?? [];
  const messageAttachments = fileAttachments(messageParts);
  const consumeUsage = createUsageConsumer(role, message, messageParts);
  for (const part of messageParts) {
    pushPart(context, { message, role, messageAttachments, consumeUsage }, part);
  }
}

function fileAttachments(parts: Raw[]): Attachment[] {
  return parts.filter((part) => stringValue(part.type) === "file").flatMap(attachmentList);
}

function attachmentList(part: Raw): Attachment[] {
  const attachment = attachmentFrom(part);
  return attachment === undefined ? [] : [attachment];
}

function createUsageConsumer(role: string | undefined, message: Raw, parts: Raw[]): UsageConsumer {
  const messageUsage = role === "assistant" ? usageFrom(message) : undefined;
  const firstPartWithUsage = parts.find(hasPartUsage);
  let emitted = false;
  return (part?: Raw) => {
    if (emitted || shouldSkipMessageUsage(messageUsage, firstPartWithUsage, part)) return undefined;
    const usage = mergedUsage(messageUsage, part === undefined ? undefined : usageFrom(part));
    if (usage === undefined) return undefined;
    emitted = true;
    return usage;
  };
}

function hasPartUsage(part: Raw): boolean {
  const type = stringValue(part.type);
  return type !== undefined && USAGE_CAPABLE_PART_TYPES.has(type) && usageFrom(part) !== undefined;
}

function shouldSkipMessageUsage(
  messageUsage: AgentMessageUsage | undefined,
  firstPartWithUsage: Raw | undefined,
  part: Raw | undefined,
): boolean {
  return (
    messageUsage !== undefined && firstPartWithUsage !== undefined && part !== firstPartWithUsage
  );
}

function mergedUsage(
  messageUsage: AgentMessageUsage | undefined,
  partUsage: AgentMessageUsage | undefined,
): AgentMessageUsage | undefined {
  return messageUsage !== undefined && partUsage !== undefined
    ? ({ ...partUsage, ...messageUsage } as AgentMessageUsage)
    : (messageUsage ?? partUsage);
}

type MessagePartContext = {
  message: Raw;
  role: string | undefined;
  messageAttachments: Attachment[];
  consumeUsage: UsageConsumer;
};

type PartHandler = (
  context: MappingContext,
  messageContext: MessagePartContext,
  base: EntryDraft,
  part: Raw & { id: string },
  type: string,
) => void;

const PART_HANDLERS: Record<string, PartHandler> = {
  text: (context, messageContext, base, part) => pushTextPart(context, messageContext, base, part),
  reasoning: (context, messageContext, base, part) =>
    pushReasoningPart(context, messageContext, base, part),
  tool: (context, messageContext, base, part) => pushToolPart(context, messageContext, base, part),
  subtask: (context, messageContext, base, part) =>
    pushSubtaskPart(context, messageContext, base, part),
  compaction: (_context, _messageContext, base, part) =>
    pushCompactionPart(_context.push, base, part),
  "step-start": (_context, _messageContext, base, part, type) =>
    pushStepPart(_context.push, base, part, type),
  "step-finish": (_context, _messageContext, base, part, type) =>
    pushStepPart(_context.push, base, part, type),
  patch: (_context, _messageContext, base, part) => pushPatchPart(_context.push, base, part),
  snapshot: (_context, _messageContext, base, part) => pushSnapshotPart(_context.push, base, part),
  agent: (_context, _messageContext, base, part) => pushAgentPart(_context.push, base, part),
  retry: (_context, _messageContext, base, part) => pushRetryPart(_context.push, base, part),
};

function pushPart(
  context: MappingContext,
  messageContext: MessagePartContext,
  part: Raw & { id: string },
): void {
  const type = stringValue(part.type);
  if (type === "file") return;
  const base = partBase(context, messageContext.message, part, type);
  if (type === undefined) {
    pushFallbackPart(context.push, base, part, type);
    return;
  }
  const handler = PART_HANDLERS[type];
  if (handler === undefined) {
    pushFallbackPart(context.push, base, part, type);
    return;
  }
  handler(context, messageContext, base, part, type);
}

function partBase(
  context: MappingContext,
  message: Raw,
  part: Raw,
  type: string | undefined,
): EntryDraft {
  const rawType = `part.${type ?? "unknown"}`;
  return {
    ts: partTimestamp(part, message),
    source: sourceFor(part, rawType, context.schemaVersion),
    meta: metaFor(rawType),
  } as EntryDraft;
}

function pushTextPart(
  context: MappingContext,
  messageContext: MessagePartContext,
  base: EntryDraft,
  part: Raw & { id: string },
): void {
  const text = stringValue(part.text);
  if (text === undefined) return;
  if (messageContext.role === "user") {
    context.push(
      {
        ...base,
        type: "user_message",
        payload: {
          text,
          ...(messageContext.messageAttachments.length > 0
            ? { attachments: messageContext.messageAttachments }
            : {}),
        },
      },
      part.id,
    );
    return;
  }
  const model = stringValue(messageContext.message.modelID) ?? context.sessionModel;
  const usage = messageContext.consumeUsage(part);
  context.push(
    {
      ...base,
      type: "agent_message",
      payload: {
        text,
        ...(model !== undefined ? { model } : {}),
        ...(usage !== undefined ? { usage } : {}),
        ...(messageContext.messageAttachments.length > 0
          ? { attachments: messageContext.messageAttachments }
          : {}),
      },
    },
    part.id,
  );
}

function pushReasoningPart(
  context: MappingContext,
  messageContext: MessagePartContext,
  base: EntryDraft,
  part: Raw & { id: string },
): void {
  const text = reasoningText(part);
  if (text === undefined) return;
  const model = stringValue(messageContext.message.modelID) ?? context.sessionModel;
  const usage = messageContext.consumeUsage(part);
  context.push(
    {
      ...base,
      type: "agent_thinking",
      payload: {
        text,
        ...(model !== undefined ? { model } : {}),
        ...(usage !== undefined ? { usage } : {}),
      },
    },
    part.id,
  );
}

function reasoningText(part: Raw): string | undefined {
  return (
    stringValue(part.text) ??
    (part.encrypted === true || part.encryptedReasoning === true
      ? "[encrypted reasoning]"
      : undefined)
  );
}

function pushToolPart(
  context: MappingContext,
  messageContext: MessagePartContext,
  base: EntryDraft,
  part: Raw & { id: string },
): void {
  const callID = toolCallId(part);
  const state = toolState(part);
  const input = toolInput(part, state);
  const name = toolName(part, state);
  const toolBase = toolEntryBase(context, base, part, name);
  if (pushSpecialTool(context.push, toolBase, part, name, input, state)) return;
  const mapped = mapTool(name, input);
  const forId = ensureToolCall(context, messageContext, toolBase, part, callID, mapped);
  pushToolTerminalEvent(context, base, toolBase, part, callID, forId, mapped, state);
}

function toolCallId(part: Raw & { id: string }): string {
  return stringValue(part.callID) ?? stringValue(part.call_id) ?? part.id;
}

function toolState(part: Raw): Raw {
  return objectValue(part.state) ?? part;
}

function toolInput(part: Raw, state: Raw): Raw {
  return objectValue(state.input) ?? objectValue(part.input) ?? {};
}

function toolName(part: Raw, state: Raw): string {
  return stringValue(part.tool) ?? stringValue(part.name) ?? stringValue(state.tool) ?? "unknown";
}

function toolEntryBase(
  context: MappingContext,
  base: EntryDraft,
  part: Raw,
  name: string,
): EntryDraft {
  const toolRawType = `tool.${name}`;
  return {
    ...base,
    source: sourceFor(part, toolRawType, context.schemaVersion),
    meta: metaFor(toolRawType),
  };
}

function pushSpecialTool(
  push: PushEntry,
  toolBase: EntryDraft,
  part: Raw & { id: string },
  name: string,
  input: Raw,
  state: Raw,
): boolean {
  if (name === "todowrite") return pushTodoWriteTool(push, toolBase, part, input);
  if (name === "lsp_diagnostics")
    return pushDiagnosticTool(push, toolBase, part, name, input, state);
  return false;
}

function pushTodoWriteTool(
  push: PushEntry,
  toolBase: EntryDraft,
  part: Raw & { id: string },
  input: Raw,
): boolean {
  const items = todoItemsFrom(input.todos);
  if (items.length === 0) return false;
  push({ ...toolBase, type: "task_plan_update", payload: { items } }, `${part.id}:todos`);
  return true;
}

function pushDiagnosticTool(
  push: PushEntry,
  toolBase: EntryDraft,
  part: Raw & { id: string },
  name: string,
  input: Raw,
  state: Raw,
): boolean {
  push(
    {
      ...toolBase,
      type: "system_event",
      payload: { kind: "x-opencode/diagnostic", data: { tool: name, input, output: state.output } },
    },
    `${part.id}:diagnostic`,
  );
  return true;
}

function ensureToolCall(
  context: MappingContext,
  messageContext: MessagePartContext,
  toolBase: EntryDraft,
  part: Raw & { id: string },
  callID: string,
  mapped: { tool: ToolKind; args: Raw },
): string {
  const existingCallId = context.openCalls.get(callID);
  if (existingCallId !== undefined) return existingCallId;
  const usage = messageContext.consumeUsage(part);
  const call = context.push(
    {
      ...toolBase,
      type: "tool_call",
      payload: { ...mapped, ...(usage !== undefined ? { usage } : {}) },
      semantic: { call_id: callID, tool_kind: mapped.tool },
    },
    `${part.id}:call`,
  );
  return call.id;
}

function pushToolTerminalEvent(
  context: MappingContext,
  base: EntryDraft,
  toolBase: EntryDraft,
  part: Raw & { id: string },
  callID: string,
  forId: string,
  mapped: { tool: ToolKind; args: Raw },
  state: Raw,
): void {
  const status = stringValue(state.status) ?? stringValue(part.status);
  if (status === "completed" || status === "error" || status === "failed") {
    context.openCalls.delete(callID);
    pushToolResult(context.push, base, toolBase, part, callID, forId, mapped, state, status);
    return;
  }
  if (status === "cancelled" || status === "canceled") {
    context.openCalls.delete(callID);
    pushAbortedTool(context.push, base, toolBase, part, callID, forId, mapped);
    return;
  }
  context.openCalls.set(callID, forId);
}

function pushToolResult(
  push: PushEntry,
  base: EntryDraft,
  toolBase: EntryDraft,
  part: Raw & { id: string },
  callID: string,
  forId: string,
  mapped: { tool: ToolKind; args: Raw },
  state: Raw,
  status: string,
): void {
  push(
    {
      ...base,
      source: toolBase.source,
      meta: toolBase.meta,
      type: "tool_result",
      payload: toolResultPayload(forId, mapped, state, status),
      semantic: { call_id: callID, tool_kind: mapped.tool },
    },
    `${part.id}:result`,
  );
}

function toolResultPayload(
  forId: string,
  mapped: { tool: ToolKind; args: Raw },
  state: Raw,
  status: string,
): Raw {
  const attachments = attachmentsFrom(state.attachments);
  const meta = toolResultMeta(mapped, state);
  return {
    for_id: forId,
    ok: status === "completed",
    ...(stringValue(state.output) !== undefined ? { output: stringValue(state.output) } : {}),
    ...(stringValue(state.error) !== undefined ? { error: stringValue(state.error) } : {}),
    ...(attachments.length > 0 ? { attachments } : {}),
    ...(Object.keys(meta).length > 0 ? { meta } : {}),
  };
}

function toolResultMeta(mapped: { tool: ToolKind; args: Raw }, state: Raw): Raw {
  return {
    ...fileReadResultMeta(mapped),
    ...openCodeToolMeta(state),
  };
}

function fileReadResultMeta(mapped: { tool: ToolKind; args: Raw }): Raw {
  return mapped.tool === "file_read" && Array.isArray(mapped.args.range)
    ? { file_read: { range: mapped.args.range } }
    : {};
}

function openCodeToolMeta(state: Raw): Raw {
  const title = stringValue(state.title);
  const metadata = objectValue(state.metadata);
  const time = objectValue(state.time);
  if (title === undefined && metadata === undefined && time === undefined) return {};
  return {
    "x-opencode/tool": {
      ...(title !== undefined ? { title } : {}),
      ...(metadata !== undefined ? { metadata } : {}),
      ...(time !== undefined ? { time } : {}),
    },
  };
}

function pushAbortedTool(
  push: PushEntry,
  base: EntryDraft,
  toolBase: EntryDraft,
  part: Raw & { id: string },
  callID: string,
  forId: string,
  mapped: { tool: ToolKind; args: Raw },
): void {
  push(
    {
      ...base,
      source: toolBase.source,
      meta: toolBase.meta,
      type: "tool_call_aborted",
      payload: { scope: "tool_call", for_id: forId, reason: "user_interrupt" },
      semantic: { call_id: callID, tool_kind: mapped.tool },
    },
    `${part.id}:aborted`,
  );
}

function pushSubtaskPart(
  context: MappingContext,
  messageContext: MessagePartContext,
  base: EntryDraft,
  part: Raw & { id: string },
): void {
  const prompt = stringValue(part.prompt) ?? stringValue(part.description);
  if (prompt === undefined) {
    context.push(
      { ...base, type: "system_event", payload: { kind: "x-opencode/subtask", data: { ...part } } },
      part.id,
    );
    return;
  }
  const usage = messageContext.consumeUsage(part);
  context.push(
    {
      ...base,
      type: "tool_call",
      payload: {
        tool: "subagent_invoke",
        args: {
          task: prompt,
          ...(stringValue(part.agent) !== undefined ? { agent_type: stringValue(part.agent) } : {}),
        },
        ...(usage !== undefined ? { usage } : {}),
      },
      semantic: { call_id: part.id, tool_kind: "subagent_invoke" },
    },
    part.id,
  );
}

function pushCompactionPart(push: PushEntry, base: EntryDraft, part: Raw & { id: string }): void {
  const summary = stringValue(part.summary) ?? stringValue(part.text);
  const draft: EntryDraft =
    summary === undefined
      ? {
          ...base,
          type: "system_event",
          payload: { kind: "x-opencode/compaction", data: { ...part } },
        }
      : { ...base, type: "context_compact", payload: { summary, trigger: "auto" } };
  push(draft, part.id);
}

function pushStepPart(
  push: PushEntry,
  base: EntryDraft,
  part: Raw & { id: string },
  type: string,
): void {
  push(
    {
      ...base,
      type: "system_event",
      payload: { kind: type === "step-start" ? "turn_start" : "turn_end", data: { ...part } },
    },
    part.id,
  );
}

function pushPatchPart(push: PushEntry, base: EntryDraft, part: Raw & { id: string }): void {
  push(
    {
      ...base,
      type: "system_event",
      payload: {
        kind: "x-opencode/patch",
        data: {
          ...(stringValue(part.hash) !== undefined ? { hash: stringValue(part.hash) } : {}),
          ...(arrayValue(part.files) !== undefined ? { files: arrayValue(part.files) } : {}),
        },
      },
    },
    part.id,
  );
}

function pushSnapshotPart(push: PushEntry, base: EntryDraft, part: Raw & { id: string }): void {
  push(
    {
      ...base,
      type: "system_event",
      payload: { kind: "x-opencode/snapshot", data: { snapshot: stringValue(part.snapshot) } },
    },
    part.id,
  );
}

function pushAgentPart(push: PushEntry, base: EntryDraft, part: Raw & { id: string }): void {
  push(
    {
      ...base,
      type: "system_event",
      payload: { kind: "x-opencode/agent", data: { name: stringValue(part.name) } },
    },
    part.id,
  );
}

function pushRetryPart(push: PushEntry, base: EntryDraft, part: Raw & { id: string }): void {
  push(
    {
      ...base,
      type: "system_event",
      payload: {
        kind: "x-opencode/retry",
        data: {
          ...(numberValue(part.attempt) !== undefined
            ? { attempt: numberValue(part.attempt) }
            : {}),
          ...(part.error !== undefined ? { error: part.error } : {}),
        },
      },
    },
    part.id,
  );
}

function pushFallbackPart(
  push: PushEntry,
  base: EntryDraft,
  part: Raw & { id: string },
  type: string | undefined,
): void {
  const payload =
    type === undefined || !KNOWN_PART_TYPES.has(type)
      ? { kind: "x-opencode/unknown_record", data: { raw: { ...part } } }
      : { kind: `x-opencode/${type}`, data: { ...part } };
  push({ ...base, type: "system_event", payload }, part.id);
}
