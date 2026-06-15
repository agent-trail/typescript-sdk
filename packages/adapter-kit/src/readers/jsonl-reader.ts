import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { RawRecord, SourcePointer, SourceReader } from "./types.js";

/** Options for `JsonlReader`. */
export interface JsonlReaderOptions {
  /** Derives the source schema version from the first parsed record. */
  versionFrom?: (first: RawRecord) => string | undefined;
  /** Parsing mode for malformed or non-object JSONL lines. */
  mode?: "tolerant" | "strict";
}

function parseLine(
  line: string,
  lineNumber: number,
  mode: "tolerant" | "strict",
): RawRecord | undefined {
  const trimmedLine = line.trim();
  if (trimmedLine.length === 0) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(trimmedLine);
  } catch {
    if (mode === "strict") {
      throw new Error(`JsonlReader: malformed JSON on line ${lineNumber}`);
    }
    return undefined;
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as RawRecord;
  }
  if (mode === "strict") {
    throw new Error(`JsonlReader: expected JSON object on line ${lineNumber}`);
  }
  return undefined;
}

/** Reads newline-delimited JSON sources. */
export class JsonlReader implements SourceReader {
  /** Create a JSONL reader. */
  constructor(private readonly options: JsonlReaderOptions = {}) {}

  /** Stream JSON object records from a JSONL source. */
  async *records(source: SourcePointer): AsyncIterable<RawRecord> {
    const text = await readFile(source.path, "utf8");
    const mode = this.options.mode ?? "tolerant";
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      const record = parseLine(lines[i] ?? "", i + 1, mode);
      if (record !== undefined) yield record;
    }
  }

  /** Return the source schema version derived from the first record. */
  async schemaVersion(source: SourcePointer): Promise<string | undefined> {
    if (this.options.versionFrom === undefined) return undefined;
    for await (const record of this.records(source)) {
      return this.options.versionFrom(record);
    }
    return undefined;
  }

  /** Return a SHA-256 hash of the source bytes. */
  async identityHash(source: SourcePointer): Promise<string> {
    const bytes = await readFile(source.path);
    return createHash("sha256").update(bytes).digest("hex");
  }
}
