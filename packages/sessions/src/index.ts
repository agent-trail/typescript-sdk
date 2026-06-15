/**
 * Workflow orchestration for Agent Trail source sessions.
 *
 * `@agent-trail/sessions` coordinates source adapters, catalog rows, local
 * store registration, redaction, and injected sharing transports. Consumers
 * inject runtime-specific capabilities such as SQLite drivers and transports.
 *
 * @packageDocumentation
 */

export type {
  AdapterSourceHealth,
  ClaudeCodeAdapterOptions,
  CodexAdapterOptions,
  DefaultTrailAdaptersOptions,
  DetectOptions,
  OpenCodeAdapterOptions,
  PiAdapterOptions,
  ResumeCommand,
  ResumeSessionResult,
  SessionRef,
  TrailAdapter,
  TrailFile,
  TrailSessionGroup,
} from "@agent-trail/adapters";
export type {
  CatalogDb,
  CatalogEntryRow,
  CatalogEntryState,
  CatalogParams,
  CatalogValue,
} from "@agent-trail/catalog";
export type {
  LoadedRedactionPack,
  PiiConfig,
  RedactionPackSource,
  RedactionPackSummary,
  RedactionPattern,
  RedactionSample,
  RedactionSummary,
  RedactTrailOptions,
} from "@agent-trail/redact";
export type { RegisterStatus } from "@agent-trail/store";
export { createSessionsClient } from "./client.js";
export { discoverSessions } from "./discover.js";
export { exportSession } from "./export.js";
export { listSessions } from "./list.js";
export { loadSession } from "./load.js";
export { shareSession } from "./share.js";
export type {
  DiscoveredSession,
  DiscoverSessionsOptions,
  DiscoverSessionsResult,
  ExportSessionOptions,
  ExportSessionResult,
  ListSessionsOptions,
  ListSessionsResult,
  LoadSessionOptions,
  LoadSessionResult,
  SessionsClient,
  SessionsOptions,
  SessionsShareInput,
  SessionsShareTransport,
  SessionsWarning,
  ShareSessionOptions,
  ShareSessionResult,
  SourceSessionSelector,
} from "./types.js";
