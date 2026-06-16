import type { SqliteDriver } from "@agent-trail/adapter-kit";
import type { DetectOptions, TrailAdapter } from "@agent-trail/adapters";
import type { CatalogDb, CatalogEntryRow } from "@agent-trail/catalog";
import type { RedactionSummary, RedactTrailOptions } from "@agent-trail/redact";
import type { RegisterStatus } from "@agent-trail/store";

/**
 * Base dependencies shared by sessions operations.
 *
 * @public
 */
export type SessionsOptions = {
  /** Catalog database driver supplied by the caller runtime. */
  catalogDb: CatalogDb;
  /** Local Agent Trail store root. Defaults through `@agent-trail/store`. */
  storeRoot?: string;
  /** Concrete adapters. Defaults to `createDefaultTrailAdapters`. */
  adapters?: readonly TrailAdapter[];
  /** Options used when default adapters are constructed. */
  defaultAdapterOptions?: SessionsDefaultAdapterOptions;
};

/**
 * Options used when sessions constructs the default adapter set.
 *
 * @public
 */
export type SessionsDefaultAdapterOptions = {
  "claude-code"?: { env?: NodeJS.ProcessEnv };
  codex?: { env?: NodeJS.ProcessEnv };
  opencode?: {
    env?: NodeJS.ProcessEnv;
    storageDir?: string;
    dbPath?: string;
    sqliteDriver?: SqliteDriver;
  };
  pi?: { env?: NodeJS.ProcessEnv };
};

/**
 * Warning returned by a sessions workflow.
 *
 * @public
 */
export type SessionsWarning = {
  adapter?: string;
  code: string;
  message: string;
};

/**
 * Normalized source session discovered by adapters.
 *
 * @public
 */
export type DiscoveredSession = {
  adapter: string;
  sourceId: string;
  path: string;
  cwd: string | null;
  sessionDate: string;
};

/**
 * Options for discovering source sessions.
 *
 * @public
 */
export type DiscoverSessionsOptions = SessionsOptions & {
  detect?: DetectOptions;
  markMissing?: boolean;
};

/**
 * Result of source-session discovery.
 *
 * @public
 */
export type DiscoverSessionsResult = {
  sessions: DiscoveredSession[];
  warnings: SessionsWarning[];
};

/**
 * Options for listing catalog-backed sessions.
 *
 * @public
 */
export type ListSessionsOptions = SessionsOptions & {
  refresh?: boolean | DetectOptions;
  includeMissing?: boolean;
  states?: readonly ("source" | "source+registered" | "registered")[];
  adapter?: string;
  cwd?: string;
  branch?: string;
  dateFrom?: string;
  dateTo?: string;
  query?: string;
  caseSensitive?: boolean;
  limit?: number;
};

/**
 * Result of listing catalog-backed sessions.
 *
 * @public
 */
export type ListSessionsResult = {
  rows: CatalogEntryRow[];
  warnings: SessionsWarning[];
};

/**
 * Source session key used by load, share, and export workflows.
 *
 * @public
 */
export type SourceSessionSelector = {
  adapter: string;
  sourceId: string;
};

/**
 * Options for loading a source session into the local store.
 *
 * @public
 */
export type LoadSessionOptions = SessionsOptions & SourceSessionSelector;

/**
 * Result of loading a source session into the local store.
 *
 * @public
 */
export type LoadSessionResult =
  | {
      status: "loaded";
      adapter: string;
      sourceId: string;
      contentHash: string;
      objectPath: string;
      registerStatus: Exclude<RegisterStatus, "invalid" | "skipped_pending">;
      reconciliation: "passthrough" | "merged";
      warnings: SessionsWarning[];
    }
  | {
      status: "adapter_not_found" | "source_not_found" | "invalid" | "skipped_pending";
      adapter: string;
      sourceId: string;
      warnings: SessionsWarning[];
    };

/**
 * Input passed to an injected share transport.
 *
 * @public
 */
export type SessionsShareInput = {
  adapter: string;
  sourceId: string;
  contentHash: string;
  filename: string;
  jsonl: string;
  redactionSummary: RedactionSummary;
};

/**
 * Gist-shaped sharing transport injected by the consumer.
 *
 * @public
 */
export type SessionsShareTransport = {
  share(input: SessionsShareInput): Promise<{ gistId: string; url?: string }>;
};

/**
 * Options for redacting and sharing a generated trail.
 *
 * @public
 */
export type ShareSessionOptions = SessionsOptions &
  SourceSessionSelector & {
    transport?: SessionsShareTransport;
    redaction?: RedactTrailOptions;
  };

/**
 * Result of sharing a generated trail.
 *
 * @public
 */
export type ShareSessionResult =
  | {
      status: "shared";
      adapter: string;
      sourceId: string;
      contentHash: string;
      gistId: string;
      url?: string;
      redactionSummary: RedactionSummary;
    }
  | {
      status: "source_not_found" | "no_generated_trail" | "transport_missing";
      adapter: string;
      sourceId: string;
    };

/**
 * Options for exporting a generated trail.
 *
 * @public
 */
export type ExportSessionOptions = SessionsOptions &
  SourceSessionSelector & {
    toPath?: string;
  };

/**
 * Result of exporting a generated trail.
 *
 * @public
 */
export type ExportSessionResult =
  | {
      status: "exported";
      adapter: string;
      sourceId: string;
      contentHash: string;
      path?: string;
      jsonl?: string;
    }
  | {
      status: "source_not_found" | "no_generated_trail";
      adapter: string;
      sourceId: string;
    };

/**
 * Bound sessions workflow client.
 *
 * @public
 */
export type SessionsClient = {
  discover(
    options?: Omit<DiscoverSessionsOptions, keyof SessionsOptions>,
  ): Promise<DiscoverSessionsResult>;
  list(options?: Omit<ListSessionsOptions, keyof SessionsOptions>): Promise<ListSessionsResult>;
  load(options: SourceSessionSelector): Promise<LoadSessionResult>;
  share(
    options: SourceSessionSelector & Pick<ShareSessionOptions, "transport" | "redaction">,
  ): Promise<ShareSessionResult>;
  export(
    options: SourceSessionSelector & Pick<ExportSessionOptions, "toPath">,
  ): Promise<ExportSessionResult>;
};
