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
  if (value.type === "image" || value.type === "document") {
    const source = isRecord(value.source) ? value.source : undefined;
    const data = typeof source?.data === "string" ? source.data : undefined;
    if (source?.type === "base64" && data !== undefined) {
      const decoded = decodeCappedBase64(data);
      const safeSource: Record<string, unknown> = { ...source };
      delete safeSource.data;
      if (decoded.bytes !== undefined) {
        safeSource.uri = sha256Ref(decoded.bytes);
      } else {
        safeSource.oversized = true;
      }
      return { ...value, source: safeSource };
    }
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, sanitizeInlineMediaInRaw(child)]),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}
