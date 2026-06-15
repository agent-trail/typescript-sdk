import type { MappingDef, TrailEntryDraft } from "@agent-trail/adapter-kit";
import { defineMapping } from "@agent-trail/adapter-kit";
import { isNonEmptyString } from "../../task-plan.js";
import { hookEventToKind, isSessionEndHookEvent } from "../envelope-mappers.js";
import { type CcEnvelope, isObject, jsonString, stringValue } from "../source.js";
import {
  gate,
  hookAdditionalContextContent,
  hookFailureDraft,
  meta,
  type Raw,
  src,
} from "./shared.js";

type CapabilityItem = { name: string; metadata?: Record<string, unknown> };
type CapabilityContext = {
  record: CcEnvelope;
  attachment: Record<string, unknown>;
  isLegacyAttachment: boolean;
  subtype: string;
  originalType: string;
};
type CapabilityHandler = (context: CapabilityContext) => TrailEntryDraft[];

const CAPABILITY_HANDLERS: Record<string, CapabilityHandler> = {
  hook_blocking_error: hookBlockingError,
  hook_non_blocking_error: hookNonBlockingError,
  deferred_tools_delta: deferredToolsDelta,
  skill_listing: skillListing,
  mcp_instructions_delta: mcpInstructionsDelta,
  hook_success: hookSuccess,
  hook_permission_decision: hookPermissionDecision,
  hook_additional_context: hookAdditionalContext,
  command_permissions: commandPermissions,
};

function emitCapabilityAttachment(record: CcEnvelope): TrailEntryDraft[] {
  if (!gate(record)) return [];
  const context = capabilityContext(record);
  if (context === undefined) return [];
  return CAPABILITY_HANDLERS[context.subtype]?.(context) ?? [];
}

function capabilityContext(record: CcEnvelope): CapabilityContext | undefined {
  const isLegacyAttachment = record.type === "attachment";
  const attachment = isLegacyAttachment && isObject(record.attachment) ? record.attachment : record;
  const subtype = isLegacyAttachment ? stringValue(attachment.type) : stringValue(record.type);
  if (subtype === undefined) return undefined;
  return {
    record,
    attachment,
    isLegacyAttachment,
    subtype,
    originalType: isLegacyAttachment ? `attachment.${subtype}` : subtype,
  };
}

function hookBlockingError(context: CapabilityContext): TrailEntryDraft[] {
  const { record, attachment, originalType } = context;
  const toolCallId = hookToolCallId(attachment);
  if (toolCallId === undefined) {
    return [hookFailureDraft(record, originalType, attachment, { fallbackBlocking: true })];
  }
  const hookName = stringValue(attachment.hook_name) ?? stringValue(attachment.hookName);
  return [
    {
      type: "tool_call_aborted",
      payload: {
        scope: "tool_call",
        reason: "hook_blocked",
        ...(hookName !== undefined ? { blocked_by: hookName } : {}),
      },
      source: src(record, originalType),
      meta: meta(record, { callId: toolCallId }),
    },
  ];
}

function hookNonBlockingError(context: CapabilityContext): TrailEntryDraft[] {
  return [
    hookFailureDraft(context.record, context.originalType, context.attachment, {
      fallbackBlocking: false,
    }),
  ];
}

function deferredToolsDelta(context: CapabilityContext): TrailEntryDraft[] {
  const { record, attachment, originalType } = context;
  return [
    ...toolCapabilityDelta(
      record,
      originalType,
      "registered",
      attachment.addedNames ?? attachment.added_names,
    ),
    ...toolCapabilityDelta(
      record,
      originalType,
      "deregistered",
      attachment.removedNames ?? attachment.removed_names,
    ),
  ];
}

function toolCapabilityDelta(
  record: CcEnvelope,
  originalType: string,
  reason: "registered" | "deregistered",
  value: unknown,
): TrailEntryDraft[] {
  const key = reason === "registered" ? "added" : "removed";
  const items = stringArray(value).map((name) => ({ name }));
  return items.length > 0
    ? [capabilityChange(record, originalType, { scope: "tool", reason, [key]: items })]
    : [];
}

function skillListing(context: CapabilityContext): TrailEntryDraft[] {
  const { record, attachment, originalType } = context;
  const snapshot = skillItems(attachment);
  if (snapshot.length > 0) {
    return [capabilityChange(record, originalType, { scope: "skill", reason: "loaded", snapshot })];
  }
  const text = listingText(attachment);
  if (text === undefined || text.length === 0) return [];
  return [
    capabilityChange(record, originalType, {
      scope: "skill",
      reason: "loaded",
      changed: [{ name: "skill_listing", field: "listing", to: text }],
    }),
  ];
}

function mcpInstructionsDelta(context: CapabilityContext): TrailEntryDraft[] {
  const { record, attachment, originalType } = context;
  const name =
    stringValue(attachment.serverName) ??
    stringValue(attachment.server) ??
    stringValue(attachment.name) ??
    "mcp_instructions";
  const content = listingText(attachment);
  return [
    capabilityChange(record, originalType, {
      scope: "mcp_server",
      reason: "instructions_updated",
      changed: [
        {
          name,
          field: "instructions",
          ...(content !== undefined && content.length > 0 ? { to: content } : {}),
        },
      ],
    }),
  ];
}

function hookSuccess(context: CapabilityContext): TrailEntryDraft[] {
  const { record, attachment, isLegacyAttachment, originalType } = context;
  const hookEvent = stringValue(attachment.hook_event) ?? stringValue(attachment.hookEvent);
  const hookName = stringValue(attachment.hook_name) ?? stringValue(attachment.hookName);
  const toolCallId = hookToolCallId(attachment);
  const source = src(hookSuccessSourceRecord(record, attachment, isLegacyAttachment), originalType);
  if (isSessionEndHookEvent(hookEvent)) {
    return [{ type: "session_end", payload: { reason: "complete" }, source, meta: meta(record) }];
  }
  return [
    {
      type: "system_event",
      payload: {
        kind: hookEventToKind(hookEvent),
        text: hookSuccessText(hookEvent, hookName),
        data: hookSuccessData(attachment),
      },
      ...(toolCallId !== undefined ? { semantic: { call_id: toolCallId } } : {}),
      source,
      meta: meta(record, { callId: toolCallId }),
    },
  ];
}

function hookPermissionDecision(context: CapabilityContext): TrailEntryDraft[] {
  const { record, attachment, originalType } = context;
  const decision = permissionDecision(attachment.decision);
  if (decision === undefined) return [];
  const toolCallId = hookToolCallId(attachment);
  const data: Record<string, unknown> = { decision };
  addValue(data, "tool_call_id", toolCallId);
  addString(data, "hook_event", attachment.hook_event ?? attachment.hookEvent);
  addString(data, "capability", attachment.capability);
  return [
    {
      type: "system_event",
      payload: { kind: "permission_decision", data },
      ...(toolCallId !== undefined ? { semantic: { call_id: toolCallId } } : {}),
      source: src(record, originalType),
      meta: meta(record, { callId: toolCallId }),
    },
  ];
}

function hookAdditionalContext(context: CapabilityContext): TrailEntryDraft[] {
  const { record, attachment, originalType } = context;
  const toolCallId = hookToolCallId(attachment);
  const safeContent = hookAdditionalContextContent(attachment.content);
  return [
    {
      type: "system_event",
      payload: {
        kind: "context_injected",
        ...textPayload(safeContent.text),
        data: hookAdditionalContextData(attachment, toolCallId, safeContent),
      },
      ...(toolCallId !== undefined ? { semantic: { call_id: toolCallId } } : {}),
      source: src(record, originalType),
      meta: meta(record, { callId: toolCallId }),
    },
  ];
}

function hookAdditionalContextData(
  attachment: Record<string, unknown>,
  toolCallId: string | undefined,
  safeContent: ReturnType<typeof hookAdditionalContextContent>,
): Record<string, unknown> {
  const data: Record<string, unknown> = { source_kind: "hook" };
  addString(data, "hook_event", attachment.hook_event ?? attachment.hookEvent);
  const hookName = stringValue(attachment.hook_name) ?? stringValue(attachment.hookName);
  if (hookName !== undefined) {
    data.name = hookName;
    data.hook_name = hookName;
  }
  addValue(data, "tool_call_id", toolCallId);
  addValue(data, "content", safeContent.content);
  addValue(data, "attachments", safeContent.attachments);
  return data;
}

function commandPermissions(context: CapabilityContext): TrailEntryDraft[] {
  const { record, attachment, originalType } = context;
  const data: Record<string, unknown> = {};
  const rawAllowedTools = attachment.allowed_tools ?? attachment.allowedTools;
  if (Array.isArray(rawAllowedTools)) data.allowed_tools = stringArray(rawAllowedTools);
  addString(data, "model", attachment.model);
  if (Object.keys(data).length === 0) return [];
  return [
    {
      type: "system_event",
      payload: { kind: "permission_request", data },
      source: src(record, originalType),
      meta: meta(record),
    },
  ];
}

function capabilityChange(
  record: CcEnvelope,
  originalType: string,
  payload: Record<string, unknown>,
): TrailEntryDraft {
  return {
    type: "capability_change",
    payload,
    source: src(record, originalType),
    meta: meta(record),
  };
}

function hookSuccessSourceRecord(
  record: CcEnvelope,
  attachment: Record<string, unknown>,
  isLegacyAttachment: boolean,
): CcEnvelope {
  const sanitizedAttachment = hookSuccessSourceAttachment(attachment);
  if (isLegacyAttachment) return { ...record, attachment: sanitizedAttachment };
  return { ...record, ...sanitizedAttachment };
}

function hookSuccessSourceAttachment(attachment: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...attachment };
  summarizeHookOutput(out, "stdout");
  summarizeHookOutput(out, "stderr");
  return out;
}

function summarizeHookOutput(out: Record<string, unknown>, key: "stdout" | "stderr"): void {
  const value = stringValue(out[key]);
  if (value === undefined) return;
  delete out[key];
  out[`${key}_elided`] = true;
  out[`${key}_chars`] = value.length;
}

function hookSuccessData(attachment: Record<string, unknown>): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  addString(data, "hook_event", attachment.hook_event ?? attachment.hookEvent);
  addString(data, "hook_name", attachment.hook_name ?? attachment.hookName);
  addValue(data, "tool_call_id", hookToolCallId(attachment));
  addTruncatedNumber(data, "exit_code", attachment.exit_code ?? attachment.exitCode);
  addTruncatedNumber(data, "duration_ms", attachment.duration_ms ?? attachment.durationMs);
  addString(data, "command", attachment.command);
  addValue(data, "stdout_excerpt", outputExcerpt(stringValue(attachment.stdout)));
  addValue(data, "stderr_excerpt", outputExcerpt(stringValue(attachment.stderr)));
  return data;
}

function hookToolCallId(attachment: Record<string, unknown>): string | undefined {
  const rawToolCallId =
    stringValue(attachment.tool_call_id) ??
    stringValue(attachment.toolCallId) ??
    stringValue(attachment.tool_use_id) ??
    stringValue(attachment.toolUseID);
  return isNonEmptyString(rawToolCallId) ? rawToolCallId.trim() : undefined;
}

function hookSuccessText(hookEvent: string | undefined, hookName: string | undefined): string {
  const event = hookEvent ?? "hook";
  return hookName?.trim() ? `Hook success: ${event} (${hookName})` : `Hook success: ${event}`;
}

const OUTPUT_EXCERPT_MAX_CHARS = 2048;

function outputExcerpt(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  if (text.length <= OUTPUT_EXCERPT_MAX_CHARS) return text;
  return `${text.slice(0, OUTPUT_EXCERPT_MAX_CHARS)}…`;
}

function permissionDecision(value: unknown): "allow" | "deny" | undefined {
  const normalized = stringValue(value)?.toLowerCase();
  if (normalized === "allow" || normalized === "allowed" || normalized === "approved") {
    return "allow";
  }
  if (DENY_DECISIONS.has(normalized ?? "")) return "deny";
  return undefined;
}

const DENY_DECISIONS = new Set(["deny", "denied", "reject", "rejected"]);

function skillItems(attachment: Record<string, unknown>): CapabilityItem[] {
  const skills = Array.isArray(attachment.skills) ? attachment.skills : undefined;
  if (skills !== undefined) return skills.flatMap(skillItem);
  return stringArray(attachment.skillNames ?? attachment.names).map((name) => ({ name }));
}

function skillItem(skill: unknown): CapabilityItem[] {
  if (typeof skill === "string") return [{ name: skill }];
  if (!isObject(skill)) return [];
  const name = stringValue(skill.name);
  if (name === undefined) return [];
  const description = stringValue(skill.description);
  return [{ name, ...(description !== undefined ? { metadata: { description } } : {}) }];
}

function listingText(attachment: Record<string, unknown>): string | undefined {
  const content = attachment.content ?? attachment.text;
  if (content === undefined) return undefined;
  if (typeof content === "string") return content;
  return jsonString(content);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function addString(out: Record<string, unknown>, key: string, value: unknown): void {
  addValue(out, key, stringValue(value));
}

function addTruncatedNumber(out: Record<string, unknown>, key: string, value: unknown): void {
  const number = numberValue(value);
  addValue(out, key, number === undefined ? undefined : Math.trunc(number));
}

function addValue(out: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined) out[key] = value;
}

function textPayload(text: string | undefined): Record<string, string> {
  return text !== undefined && text.length > 0 ? { text } : {};
}

const capabilityAttachment = defineMapping<Raw>({
  match: { type: "attachment" },
  emit: (raw) => emitCapabilityAttachment(raw as CcEnvelope),
});

const topLevelCommandPermissions = defineMapping<Raw>({
  match: { type: "command_permissions" },
  emit: (raw) => emitCapabilityAttachment(raw as CcEnvelope),
});

const topLevelHookPermissionDecision = defineMapping<Raw>({
  match: { type: "hook_permission_decision" },
  emit: (raw) => emitCapabilityAttachment(raw as CcEnvelope),
});

export const capabilityMappings: MappingDef<Raw>[] = [
  capabilityAttachment,
  topLevelCommandPermissions,
  topLevelHookPermissionDecision,
];
