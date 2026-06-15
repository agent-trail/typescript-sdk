import type { Entry, Header } from "@agent-trail/types";

export function applyHeaderMetadataUpdates(header: Header, entries: Entry[]): Header {
  for (const entry of entries) {
    if (entry.type !== "session_metadata_update") continue;
    const payload = entry.payload;
    if (payload === undefined || typeof payload !== "object" || payload === null) continue;

    if (
      payload.field === "name" &&
      header.name === undefined &&
      typeof payload.value === "string"
    ) {
      header.name = payload.value;
      continue;
    }
    if (
      payload.field === "description" &&
      header.description === undefined &&
      typeof payload.value === "string"
    ) {
      header.description = payload.value;
      continue;
    }
    if (payload.field === "tags" && header.tags === undefined && Array.isArray(payload.value)) {
      const value = payload.value as unknown[];
      const tags = value.filter((tag): tag is string => typeof tag === "string");
      if (tags.length === payload.value.length) header.tags = tags;
    }
  }
  return header;
}
