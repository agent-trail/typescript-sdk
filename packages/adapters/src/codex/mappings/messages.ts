import { Buffer } from "node:buffer";
import type { MappingDef, TrailEntryDraft } from "@agent-trail/adapter-kit";
import { defineMapping } from "@agent-trail/adapter-kit";
import type { Attachment } from "@agent-trail/types";
import {
  decodeCappedBase64,
  INLINE_MEDIA_MAX_DECODED_BYTES,
  sha256Ref,
} from "../../inline-media.js";
import { isObject, stringValue } from "../source.js";
import { emittable, meta, payloadOf, RAW_TYPE, type Raw, source } from "./shared.js";

export const IMAGE_CARRIER = "x-codex/_images";
export const INLINE_IMAGE_MAX_DECODED_BYTES = INLINE_MEDIA_MAX_DECODED_BYTES;

type CarriedImages = { role?: string | undefined; text: string; attachments: Attachment[] };

type ParsedDataUri = {
  mediaType?: string | undefined;
  bytes?: Buffer | undefined;
  oversized?: true;
};

type AttachmentRef = { mediaType?: string; uri?: string };
type AttachmentCandidate = {
  ref?: AttachmentRef;
  mediaType?: string;
};

type DataUriParts = {
  mediaType?: string | undefined;
  parameters: string;
  data: string;
};

function message(payloadType: "user_message" | "agent_message"): MappingDef<Raw> {
  const rawType = `event_msg.${payloadType}`;
  const emit = messageEmitter(payloadType, rawType);
  return defineMapping<Raw>({
    match: { type: "event_msg", payload: { type: payloadType } },
    emit,
  });
}

function messageEmitter(payloadType: "user_message" | "agent_message", rawType: string) {
  return (record: Raw) => {
    if (!emittable(record)) return [];
    const p = payloadOf(record);
    // Canonical surface is `payload.message` (User/AgentMessageEvent.message);
    // no `text` fallback (drift-defense: audited single source).
    const text = stringValue(p.message);
    if (text === undefined || text.length === 0) return [];
    const draft: TrailEntryDraft = {
      type: payloadType === "user_message" ? "user_message" : "agent_message",
      payload: { text },
      source: source(rawType),
      meta: meta(rawType),
    };
    return [draft];
  };
}

function parseBase64Image(mediaType: string | undefined, data: string): ParsedDataUri {
  const decoded = decodeCappedBase64(data);
  if (decoded.oversized === true) {
    return { ...(mediaType !== undefined ? { mediaType } : {}), oversized: true };
  }
  return {
    ...(mediaType !== undefined ? { mediaType } : {}),
    bytes: decoded.bytes,
  };
}

function parsedDataUriParts(uri: string): DataUriParts | undefined {
  const match = /^data:([^;,]+)?((?:;[^,]*)*),(.*)$/s.exec(uri);
  if (match === null) return undefined;
  return {
    mediaType: match[1],
    parameters: match[2] as string,
    data: match[3] as string,
  };
}

function oversizedParsedData(mediaType: string | undefined): ParsedDataUri {
  return { ...(mediaType !== undefined ? { mediaType } : {}), oversized: true };
}

function parsedTextData(mediaType: string | undefined, data: string): ParsedDataUri {
  if (Buffer.byteLength(data, "utf8") > INLINE_IMAGE_MAX_DECODED_BYTES) {
    return oversizedParsedData(mediaType);
  }
  return { ...(mediaType !== undefined ? { mediaType } : {}), bytes: Buffer.from(data, "utf8") };
}

// Pull bytes + media type out of a `data:<media-type>;base64,...` URI.
function parseDataUri(uri: string): ParsedDataUri | undefined {
  const parts = parsedDataUriParts(uri);
  if (parts === undefined) return undefined;
  if (parts.parameters.split(";").includes("base64")) {
    return parseBase64Image(parts.mediaType, parts.data);
  }
  if (parts.data.length > INLINE_IMAGE_MAX_DECODED_BYTES * 3) {
    return oversizedParsedData(parts.mediaType);
  }
  try {
    const decoded = decodeURIComponent(parts.data);
    if (Buffer.byteLength(decoded, "utf8") > INLINE_IMAGE_MAX_DECODED_BYTES) {
      return oversizedParsedData(parts.mediaType);
    }
    return parsedTextData(parts.mediaType, decoded);
  } catch {
    return parsedTextData(parts.mediaType, parts.data);
  }
}

function attachmentRef(uri: string): AttachmentRef | undefined {
  if (/^(https:|file:|sha256:)/.test(uri)) return { uri };
  const parsed = parseDataUri(uri);
  if (parsed === undefined) return undefined;
  return {
    ...(parsed.mediaType !== undefined ? { mediaType: parsed.mediaType } : {}),
    ...(parsed.bytes !== undefined ? { uri: sha256Ref(parsed.bytes) } : {}),
  };
}

function sourceDataAttachmentRef(
  sourceBlock: Record<string, unknown> | undefined,
  mediaType: string | undefined,
): AttachmentCandidate {
  if (sourceBlock === undefined) {
    return mediaType === undefined ? {} : { mediaType };
  }
  const data = stringValue(sourceBlock.data);
  const parsed = data !== undefined ? parseBase64Image(mediaType, data) : undefined;
  if (parsed === undefined) {
    return mediaType === undefined ? {} : { mediaType };
  }
  const finalMediaType = parsed.mediaType ?? mediaType;
  return {
    ...(finalMediaType !== undefined ? { mediaType: finalMediaType } : {}),
    ref: parsed.bytes !== undefined ? { uri: sha256Ref(parsed.bytes) } : {},
  };
}

function imageSourceBlock(block: Record<string, unknown>): Record<string, unknown> | undefined {
  return isObject(block.source) ? block.source : undefined;
}

function imageBlockUri(
  block: Record<string, unknown>,
  sourceBlock: Record<string, unknown> | undefined,
): string | undefined {
  const imageUrl = stringValue(block.image_url);
  if (imageUrl !== undefined) return imageUrl;
  return sourceBlock === undefined ? undefined : stringValue(sourceBlock.url);
}

function imageBlockMediaType(
  ref: AttachmentRef,
  sourceBlock: Record<string, unknown> | undefined,
): string | undefined {
  if (ref.mediaType !== undefined) return ref.mediaType;
  return sourceBlock === undefined ? undefined : stringValue(sourceBlock.media_type);
}

function imageUriCandidate(
  block: Record<string, unknown>,
  sourceBlock: Record<string, unknown> | undefined,
): AttachmentCandidate | undefined {
  const uri = imageBlockUri(block, sourceBlock);
  if (uri === undefined) return undefined;
  const uriRef = attachmentRef(uri);
  if (uriRef === undefined) return undefined;
  const mediaType = imageBlockMediaType(uriRef, sourceBlock);
  return {
    ref: uriRef,
    ...(mediaType !== undefined ? { mediaType } : {}),
  };
}

function imageBlockCandidate(block: Record<string, unknown>): AttachmentCandidate {
  const sourceBlock = imageSourceBlock(block);
  const uriCandidate = imageUriCandidate(block, sourceBlock);
  const mediaType = sourceBlock === undefined ? undefined : stringValue(sourceBlock.media_type);
  return uriCandidate ?? sourceDataAttachmentRef(sourceBlock, mediaType);
}

function attachmentFromCandidate(candidate: AttachmentCandidate): Attachment | undefined {
  const { ref, mediaType } = candidate;
  if (ref?.uri === undefined) return undefined;
  return {
    kind: "image",
    ...(mediaType !== undefined ? { media_type: mediaType } : {}),
    uri: ref.uri,
  };
}

function attachmentFromImageBlock(block: Record<string, unknown>): Attachment | undefined {
  return attachmentFromCandidate(imageBlockCandidate(block));
}

// Build spec `attachments[]` from a response_item.message content array. Codex
// images appear as `input_image` (Responses API, `image_url` is a data: URI) or
// `image` (`{ source: { media_type, data } }`). Non-image blocks are ignored.
function imageAttachments(content: unknown): Attachment[] {
  if (!Array.isArray(content)) return [];
  const out: Attachment[] = [];
  for (const block of content) {
    if (!isObject(block)) continue;
    const type = stringValue(block.type);
    if (type !== "input_image" && type !== "image") continue;
    const attachment = attachmentFromImageBlock(block);
    if (attachment !== undefined) out.push(attachment);
  }
  return out;
}

function textFromMessageContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(isObject)
    .map((b) => (/text/.test(String(b.type)) ? (stringValue(b.text) ?? "") : ""))
    .join("");
}

// `response_item.message` is the Responses-API conversation item. Its text
// duplicates the `event_msg.{user,agent}_message` the adapter already emits, so
// text-only ones are suppressed. Image-bearing ones carry content that is NOT in
// the (text-only) event_msg echo, so they map to a transient IMAGE_CARRIER whose
// attachments `codexImageRollup` folds into the matching message.
const responseItemMessage = defineMapping<Raw>({
  match: { type: "response_item", payload: { type: "message" } },
  emit: (record) => {
    if (!emittable(record)) return [];
    const p = payloadOf(record);
    const attachments = imageAttachments(p.content);
    if (attachments.length === 0) return []; // text-only -> suppress (duplicate)
    const carried: CarriedImages = {
      attachments,
      text: textFromMessageContent(p.content),
      ...(stringValue(p.role) !== undefined ? { role: stringValue(p.role) } : {}),
    };
    return [
      {
        type: "system_event",
        payload: { kind: IMAGE_CARRIER, text: "" },
        source: source("response_item.message"),
        meta: { [RAW_TYPE]: "response_item.message", [IMAGE_CARRIER]: carried },
      },
    ];
  },
});

export const messageMappings: MappingDef<Raw>[] = [
  message("user_message"),
  message("agent_message"),
  responseItemMessage,
];
