import type { Entry } from "@agent-trail/types";
import { createSourceFor, type SourceForOptions } from "../entries.js";
import { decodeCappedBase64, sha256Ref } from "../inline-media.js";
import type { CcBlock, CcEnvelope } from "./source.js";

export type { SourceForOptions };

const sourceForRaw = createSourceFor<CcEnvelope, CcBlock>({
  agent: "claude-code",
  resolveSchemaVersion: (envelope) => envelope.version,
});

export function sourceFor(
  envelope: CcEnvelope,
  originalType: string | undefined,
  block?: CcBlock,
  blockIndex?: number,
  options?: SourceForOptions,
): NonNullable<Entry["source"]> {
  return sourceForRaw(
    sanitizeInlineMediaInRaw(envelope) as CcEnvelope,
    originalType,
    block !== undefined ? (sanitizeInlineMediaInRaw(block) as CcBlock) : undefined,
    blockIndex,
    options,
  );
}

function sanitizeInlineMediaInRaw(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeInlineMediaInRaw);
  if (!isRecord(value)) return value;
  const media = sanitizedInlineMedia(value);
  if (media !== undefined) return media;
  return sanitizeRecordChildren(value);
}

function sanitizedInlineMedia(value: Record<string, unknown>): Record<string, unknown> | undefined {
  const source = inlineMediaSource(value);
  if (source === undefined) return undefined;
  return { ...value, source: safeInlineSource(source.source, source.data) };
}

type InlineMediaSource = {
  source: Record<string, unknown>;
  data: string;
};

function inlineMediaSource(value: Record<string, unknown>): InlineMediaSource | undefined {
  const source = isRecord(value.source) ? value.source : undefined;
  const data = typeof source?.data === "string" ? source.data : undefined;
  return isInlineMediaType(value.type) && source?.type === "base64" && data !== undefined
    ? { source, data }
    : undefined;
}

function isInlineMediaType(value: unknown): value is "image" | "document" {
  return value === "image" || value === "document";
}

function safeInlineSource(source: Record<string, unknown>, data: string): Record<string, unknown> {
  const decoded = decodeCappedBase64(data);
  const safeSource: Record<string, unknown> = { ...source };
  delete safeSource.data;
  if (decoded.bytes !== undefined) {
    safeSource.uri = sha256Ref(decoded.bytes);
  } else {
    safeSource.oversized = true;
  }
  return safeSource;
}

function sanitizeRecordChildren(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, sanitizeInlineMediaInRaw(child)]),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}
