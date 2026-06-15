/** Raw source record as parsed by a source reader. */
export type RawRecord = Record<string, unknown>;

/** In-memory source records plus optional source-format version. */
export interface SourceSnapshot {
  /** Records in source order. */
  records: RawRecord[];
  /** Upstream source-format version when known. */
  sourceVersion?: string | undefined;
}

/** Points at one source artifact. */
export interface SourcePointer {
  /** Filesystem path or adapter-defined source locator. */
  path: string;
}

/** Storage-layer boundary for adapter source records. */
export interface SourceReader {
  /** Stream raw records from the source pointer. */
  records(source: SourcePointer): AsyncIterable<RawRecord>;
  /** Detect the source-format version for the source pointer. */
  schemaVersion(source: SourcePointer): Promise<string | undefined>;
  /** Hash source identity bytes or equivalent stable source identity. */
  identityHash(source: SourcePointer): Promise<string>;
}
