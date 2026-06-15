import type { Attachment } from "@agent-trail/types";
import { arrayValue, objectValue, type Raw, stringValue } from "./source.js";

export function attachmentFrom(raw: Raw): Attachment | undefined {
  const mime = stringValue(raw.mime) ?? stringValue(raw.mediaType);
  const url = stringValue(raw.url) ?? stringValue(raw.uri);
  const filename = stringValue(raw.filename) ?? stringValue(raw.name);
  const uri = url !== undefined && /^(https:|file:|sha256:)/.test(url) ? url : undefined;
  if (uri === undefined && filename === undefined) return undefined;
  const base = {
    kind: attachmentKind(mime),
    ...(mime !== undefined ? { media_type: mime } : {}),
  };
  if (uri !== undefined)
    return { ...base, uri, ...(filename !== undefined ? { name: filename } : {}) };
  return {
    ...base,
    name: filename as string,
  };
}

function attachmentKind(mime: string | undefined): Attachment["kind"] {
  if (mime === undefined) return "other";
  return mime.startsWith("image/") ? "image" : "file";
}

export function attachmentsFrom(value: unknown): Attachment[] {
  const rawItems = arrayValue(value);
  if (rawItems === undefined) return [];
  return rawItems.flatMap((item) => {
    const raw = objectValue(item);
    if (raw === undefined) return [];
    const attachment = attachmentFrom(raw);
    return attachment === undefined ? [] : [attachment];
  });
}
