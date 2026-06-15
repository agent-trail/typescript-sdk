import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import type { RawRecord, SourcePointer, SourceReader } from "./types.js";

/** Prepared SQLite statement abstraction used by `SqliteReader`. */
export interface SqlitePreparedStatement {
  /** Return all matching rows. */
  all(params?: Record<string, string | number | boolean | null>): Record<string, unknown>[];
  /** Return the first matching row when supported by the driver. */
  get?(
    params?: Record<string, string | number | boolean | null>,
  ): Record<string, unknown> | undefined;
}

/** SQLite connection abstraction used by `SqliteReader`. */
export interface SqliteConnection {
  /** Prepare a SQL statement. */
  prepare(sql: string): SqlitePreparedStatement;
  /** Close the connection. */
  close(): void;
}

/** Driver abstraction for opening SQLite databases. */
export interface SqliteDriver {
  /** Open a SQLite database at `path`. */
  open(path: string): SqliteConnection;
}

/** Options for `SqliteReader`. */
export interface SqliteReaderOptions {
  /** Named SQL queries, run in declared order. */
  queries: Record<string, string>;
  /** Project one result row into a raw source record. */
  rowToRecord: (queryName: string, row: Record<string, unknown>) => RawRecord;
  /** SQLite driver. Inject `bunSqliteDriver` under Bun or a Node wrapper. */
  driver: SqliteDriver;
}

/** Reads SQLite-backed sources through an injected driver. */
export class SqliteReader implements SourceReader {
  /** Create a SQLite source reader. */
  constructor(private readonly options: SqliteReaderOptions) {}

  /** Stream query results as raw source records. */
  async *records(source: SourcePointer): AsyncIterable<RawRecord> {
    const db = this.options.driver.open(source.path);
    try {
      for (const [queryName, sql] of Object.entries(this.options.queries)) {
        for (const row of db.prepare(sql).all()) {
          yield this.options.rowToRecord(queryName, row);
        }
      }
    } finally {
      db.close();
    }
  }

  /** Return the SQLite `PRAGMA user_version` as a source schema version. */
  async schemaVersion(source: SourcePointer): Promise<string | undefined> {
    const db = this.options.driver.open(source.path);
    try {
      const row = db.prepare("PRAGMA user_version").all()[0];
      const version = row?.user_version;
      return version === undefined ? undefined : String(version);
    } finally {
      db.close();
    }
  }

  /** Return a SHA-256 hash of the SQLite database bytes. */
  async identityHash(source: SourcePointer): Promise<string> {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(source.path)) {
      hash.update(chunk);
    }
    return hash.digest("hex");
  }
}
