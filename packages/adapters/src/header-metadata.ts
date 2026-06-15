import type { Entry, Header } from "@agent-trail/types";

const STRING_METADATA_FIELDS = ["name", "description"] as const;

export function applyHeaderMetadataUpdates(header: Header, entries: Entry[]): Header {
  for (const entry of entries) {
    if (entry.type !== "session_metadata_update") continue;
    const payload = entry.payload;
    if (payload === undefined || typeof payload !== "object" || payload === null) continue;

    applyStringMetadataField(header, payload);
    applyTagsMetadataField(header, payload);
  }
  return header;
}

function applyStringMetadataField(header: Header, payload: Record<string, unknown>): void {
  if (typeof payload.value !== "string") return;
  for (const field of STRING_METADATA_FIELDS) {
    if (payload.field === field && header[field] === undefined) {
      header[field] = payload.value;
    }
  }
}

function applyTagsMetadataField(header: Header, payload: Record<string, unknown>): void {
  if (payload.field !== "tags" || header.tags !== undefined || !Array.isArray(payload.value)) {
    return;
  }
  const tags = payload.value.filter((tag): tag is string => typeof tag === "string");
  if (tags.length === payload.value.length) header.tags = tags;
}
