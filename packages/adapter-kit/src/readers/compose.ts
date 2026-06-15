import { createHash } from "node:crypto";
import type { RawRecord, SourcePointer, SourceReader } from "./types.js";

async function combinedHash(readers: SourceReader[], source: SourcePointer): Promise<string> {
  const hashes = await Promise.all(readers.map((r) => r.identityHash(source)));
  return createHash("sha256").update(hashes.join("\n")).digest("hex");
}

function firstVersion(readers: SourceReader[], source: SourcePointer): Promise<string | undefined> {
  const first = readers[0];
  return first === undefined ? Promise.resolve(undefined) : first.schemaVersion(source);
}

/** Combine readers by draining each reader sequentially. */
export function chainReaders(readers: SourceReader[]): SourceReader {
  return {
    async *records(source: SourcePointer): AsyncIterable<RawRecord> {
      for (const reader of readers) yield* reader.records(source);
    },
    schemaVersion: (source) => firstVersion(readers, source),
    identityHash: (source) => combinedHash(readers, source),
  };
}

/** Options for `mergeByTimestamp`. */
export interface MergeByTimestampOptions {
  /** Extract a sortable numeric timestamp from a raw record. */
  timestampFrom?: (record: RawRecord) => number | undefined;
}

function defaultTimestamp(record: RawRecord): number | undefined {
  const value = record.timestamp;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** Combine readers by interleaving records in timestamp order. */
export function mergeByTimestamp(
  readers: SourceReader[],
  options: MergeByTimestampOptions = {},
): SourceReader {
  const tsOf = options.timestampFrom ?? defaultTimestamp;
  return {
    async *records(source: SourcePointer): AsyncIterable<RawRecord> {
      const collected: RawRecord[] = [];
      for (const reader of readers) {
        for await (const record of reader.records(source)) collected.push(record);
      }
      const keyed = collected.map((record, index) => ({
        record,
        index,
        ts: tsOf(record),
      }));
      keyed.sort((a, b) => {
        const at = a.ts ?? Number.NEGATIVE_INFINITY;
        const bt = b.ts ?? Number.NEGATIVE_INFINITY;
        if (at !== bt) return at - bt;
        return a.index - b.index;
      });
      for (const entry of keyed) yield entry.record;
    },
    schemaVersion: (source) => firstVersion(readers, source),
    identityHash: (source) => combinedHash(readers, source),
  };
}
