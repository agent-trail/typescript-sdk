import type { MappingDef, TrailEntryDraft } from "@agent-trail/adapter-kit";
import { defineMapping } from "@agent-trail/adapter-kit";
import { isObject, numericValue, type PiEnvelope, stringValue } from "../source.js";
import type { PiMappingContext } from "./context.js";
import { type Meta, metaFor } from "./shared.js";

function emitCustom(
  ctx: PiMappingContext,
  record: PiEnvelope,
  args: {
    customType: string | undefined;
    content: unknown;
    data: unknown;
    display: unknown;
    isMessage: boolean;
  },
  originalType: string,
  rawType: string,
): TrailEntryDraft[] {
  if (args.isMessage && args.customType === "interactive-shell-transfer") {
    return [interactiveShellTransferEntry(ctx, record, args, originalType, rawType)];
  }
  return [genericCustomEntry(ctx, record, args, originalType, rawType)];
}

function interactiveShellTransferEntry(
  ctx: PiMappingContext,
  record: PiEnvelope,
  args: {
    customType: string | undefined;
    content: unknown;
    data: unknown;
    display: unknown;
  },
  originalType: string,
  rawType: string,
): TrailEntryDraft {
  const inner = isObject(args.data) ? args.data : undefined;
  const content = stringValue(args.content);
  return {
    type: "system_event",
    payload: {
      kind: "x-pi/interactive_shell_transfer",
      text: nonBlankText(content) ?? "Interactive shell transfer",
      data: interactiveShellTransferData(inner),
    },
    source: ctx.src(record, originalType),
    meta: metaFor(record, rawType, displayMeta(args.display)),
  };
}

function interactiveShellTransferData(
  inner: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const data: Record<string, unknown> = { custom_type: "interactive-shell-transfer" };
  add(data, "session_id", stringValue(inner?.sessionId));
  add(data, "duration", stringValue(inner?.duration));
  if ("exitCode" in (inner ?? {})) data.exit_code = inner?.exitCode ?? null;
  addBoolean(data, "timed_out", inner?.timedOut);
  addBoolean(data, "cancelled", inner?.cancelled);
  addCompletionOutputData(data, inner);
  return data;
}

function addCompletionOutputData(
  data: Record<string, unknown>,
  inner: Record<string, unknown> | undefined,
): void {
  const completionOutput = isObject(inner?.completionOutput) ? inner.completionOutput : undefined;
  add(data, "output_total_lines", numericValue(completionOutput?.totalLines));
  addBoolean(data, "output_truncated", completionOutput?.truncated);
  if (Array.isArray(completionOutput?.lines))
    data.output_line_count = completionOutput.lines.length;
}

function genericCustomEntry(
  ctx: PiMappingContext,
  record: PiEnvelope,
  args: {
    customType: string | undefined;
    content: unknown;
    data: unknown;
    display: unknown;
    isMessage: boolean;
  },
  originalType: string,
  rawType: string,
): TrailEntryDraft {
  const { customType, isMessage } = args;
  const inner = isObject(args.data) ? args.data : undefined;
  const content = stringValue(args.content);
  const data: Record<string, unknown> = {};
  if (customType !== undefined) data.custom_type = customType;
  if (inner !== undefined) data.custom_data = inner;
  return {
    type: "system_event",
    payload: {
      kind: isMessage ? "x-pi/custom_message" : "x-pi/custom",
      text: nonBlankText(content) ?? fallbackCustomText(customType, isMessage),
      ...(Object.keys(data).length > 0 ? { data } : {}),
    },
    source: ctx.src(record, originalType),
    meta: metaFor(record, rawType, displayMeta(args.display)),
  };
}

function nonBlankText(value: string | undefined): string | undefined {
  return value !== undefined && value.trim().length > 0 ? value : undefined;
}

function fallbackCustomText(customType: string | undefined, isMessage: boolean): string {
  if (customType !== undefined) return `${isMessage ? "Custom message" : "Custom"}: ${customType}`;
  return isMessage ? "Custom message" : "Custom event";
}

function displayMeta(display: unknown): Meta | undefined {
  return typeof display === "boolean" ? { "dev.pi.display": display } : undefined;
}

function add(data: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined) data[key] = value;
}

function addBoolean(data: Record<string, unknown>, key: string, value: unknown): void {
  if (typeof value === "boolean") data[key] = value;
}

export function customVariantMappings(ctx: PiMappingContext): MappingDef<PiEnvelope>[] {
  const customMessageVariant = defineMapping<PiEnvelope>({
    match: { type: "message", message: { role: "custom" } },
    emit: (record) => {
      if (ctx.emittableTs(record) === null) return [];
      const msg = record.message as NonNullable<PiEnvelope["message"]>;
      return emitCustom(
        ctx,
        record,
        {
          customType: stringValue(msg.customType),
          content: msg.content,
          data: msg.details,
          display: msg.display,
          isMessage: true,
        },
        "custom_message_variant",
        "custom_message_variant",
      );
    },
  });

  return [customMessageVariant];
}

export function customMappings(ctx: PiMappingContext): MappingDef<PiEnvelope>[] {
  const custom = defineMapping<PiEnvelope>({
    match: { type: "custom" },
    emit: (record) => {
      if (ctx.emittableTs(record) === null) return [];
      return emitCustom(
        ctx,
        record,
        {
          customType: stringValue(record.customType),
          content: record.content,
          data: record.data,
          display: undefined,
          isMessage: false,
        },
        "custom",
        "custom_envelope",
      );
    },
  });

  const customMessage = defineMapping<PiEnvelope>({
    match: { type: "custom_message" },
    emit: (record) => {
      if (ctx.emittableTs(record) === null) return [];
      return emitCustom(
        ctx,
        record,
        {
          customType: stringValue(record.customType),
          content: record.content,
          data: record.details,
          display: record.display,
          isMessage: true,
        },
        "custom_message",
        "custom_message_envelope",
      );
    },
  });

  return [custom, customMessage];
}
