import { createHash } from "node:crypto";
import { canonicalize } from "json-canonicalize";
import type { ContentHashes, ParsedTrail, ParsedTrailRecord, StampedTrail } from "./index.js";
import { buildParsedTrail } from "./parse.js";
import { cloneRecord, isEnvelope, isHeader } from "./shared.js";

export function computeContentHashes(trail: ParsedTrail): ContentHashes {
  const sessionHashes = trail.groups.flatMap((group) => {
    if (!isHeader(group.header.record)) return [];
    return [
      {
        line: group.header.line,
        header: group.header.record,
        hash: hashRecords([group.header, ...group.events], "session"),
      },
    ];
  });

  if (trail.envelope === undefined || !isEnvelope(trail.envelope.record)) {
    return { sessionHashes };
  }

  return {
    sessionHashes,
    fileHash: hashRecords(trail.records, "file"),
  };
}

export function stampContentHashes(trail: ParsedTrail): StampedTrail {
  const clonedRecords = trail.records.map(({ line, record }) => ({
    line,
    record: cloneRecord(record),
  }));
  const clonedTrail = buildParsedTrail(clonedRecords);
  const sessionHashes = clonedTrail.groups.flatMap((group) => {
    if (!isHeader(group.header.record)) return [];
    const hash = hashRecords([group.header, ...group.events], "session");
    group.header.record.content_hash = hash;
    return [{ line: group.header.line, header: group.header.record, hash }];
  });

  let fileHash: string | undefined;
  if (clonedTrail.envelope !== undefined && isEnvelope(clonedTrail.envelope.record)) {
    fileHash = hashRecords(clonedTrail.records, "file");
    clonedTrail.envelope.record.content_hash = fileHash;
  }

  const hashes = fileHash === undefined ? { sessionHashes } : { sessionHashes, fileHash };
  return { trail: clonedTrail, hashes, jsonl: serializeRecords(clonedTrail.records) };
}

export function hashRecords(records: ParsedTrailRecord[], tier: "session" | "file"): string {
  const fileEnvelopeIndex =
    tier === "file" ? records.findIndex(({ record }) => record.type === "trail") : -1;
  const bytes = records
    .map(({ record }, index) => {
      const cloned = cloneRecord(record);
      if (
        (tier === "session" && index === 0 && cloned.type === "session") ||
        (tier === "file" && index === fileEnvelopeIndex && cloned.type === "trail")
      ) {
        cloned.content_hash = "<pending>";
      }
      return canonicalize(cloned);
    })
    .join("\n");
  return createHash("sha256").update(`${bytes}\n`).digest("hex");
}

function serializeRecords(records: ParsedTrailRecord[]): string {
  return `${records.map(({ record }) => canonicalize(record)).join("\n")}\n`;
}
