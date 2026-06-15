/**
 * Workflow orchestration for Agent Trail source sessions.
 *
 * `@agent-trail/sessions` coordinates source adapters, catalog rows, local
 * store registration, redaction, and injected sharing transports. Consumers
 * inject runtime-specific capabilities such as SQLite drivers and transports.
 *
 * @packageDocumentation
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  DefaultTrailAdaptersOptions,
  DetectOptions,
  SessionRef,
  TrailAdapter,
  TrailFile,
} from "@agent-trail/adapters";
import { createDefaultTrailAdapters } from "@agent-trail/adapters";
import {
  type CatalogDb,
  type CatalogEntryRow,
  initializeCatalog,
  listCatalogEntries,
  markGistShared,
  markMissingSources,
  markTrailGenerated,
  upsertDiscoveredSessions,
} from "@agent-trail/catalog";
import { parseTrailJsonl, stampContentHashes } from "@agent-trail/core";
import {
  type RedactionSummary,
  type RedactTrailOptions,
  redactTrailJsonl,
} from "@agent-trail/redact";
import {
  objectPath,
  type RegisterStatus,
  reconcileIncomingSegment,
  registerTrail,
  resolveStoreRoot,
} from "@agent-trail/store";

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
  defaultAdapterOptions?: DefaultTrailAdaptersOptions;
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

/**
 * Create a workflow client with shared dependencies bound once.
 *
 * @public
 */
export function createSessionsClient(options: SessionsOptions): SessionsClient {
  return {
    discover: (operationOptions = {}) => discoverSessions({ ...options, ...operationOptions }),
    list: (operationOptions = {}) => listSessions({ ...options, ...operationOptions }),
    load: (operationOptions) => loadSession({ ...options, ...operationOptions }),
    share: (operationOptions) => shareSession({ ...options, ...operationOptions }),
    export: (operationOptions) => exportSession({ ...options, ...operationOptions }),
  };
}

/**
 * Discover source sessions and persist source rows in the catalog.
 *
 * @public
 */
export async function discoverSessions(
  options: DiscoverSessionsOptions,
): Promise<DiscoverSessionsResult> {
  await initializeCatalog(options.catalogDb);
  const warnings: SessionsWarning[] = [];
  const sessions: DiscoveredSession[] = [];

  for (const adapter of resolveAdapters(options)) {
    const refs = await adapter.detectSessions(options.detect);
    const rows = refs.flatMap((ref) => discoveredCatalogRow(adapter.name, ref));
    await upsertDiscoveredSessions(options.catalogDb, rows);
    if (options.markMissing !== false) {
      await markMissingSources(
        options.catalogDb,
        rows.map((row) => ({ agent_name: row.agent_name, source_id: row.source_id })),
        { agent_name: adapter.name },
      );
    }
    sessions.push(...rows.map(discoveredSessionFromCatalogRow));
    warnings.push(...(await healthWarnings(adapter)));
  }

  return { sessions, warnings };
}

/**
 * List catalog-backed source and registered sessions.
 *
 * @public
 */
export async function listSessions(options: ListSessionsOptions): Promise<ListSessionsResult> {
  await initializeCatalog(options.catalogDb);
  const warnings =
    options.refresh === undefined || options.refresh === false
      ? []
      : (await discoverSessions(refreshDiscoverOptions(options))).warnings;
  const rows = await listCatalogEntries(options.catalogDb, listCatalogOptions(options));
  return { rows, warnings };
}

/**
 * Convert, reconcile, store, and catalog-link a source session.
 *
 * @public
 */
export async function loadSession(options: LoadSessionOptions): Promise<LoadSessionResult> {
  await initializeCatalog(options.catalogDb);
  const adapter = resolveAdapters(options).find((candidate) => candidate.name === options.adapter);
  if (adapter === undefined) {
    return missingLoadResult("adapter_not_found", options);
  }
  const source = await findSourceRow(options);
  if (source === undefined || source.path === null) {
    return missingLoadResult("source_not_found", options);
  }

  const ref: SessionRef = {
    id: options.sourceId,
    adapter: options.adapter,
    path: source.path,
    cwd: source.cwd ?? undefined,
  };
  const trail = await adapter.parseSession(ref);
  await upsertDiscoveredSessions(options.catalogDb, [
    {
      agent_name: options.adapter,
      source_id: options.sourceId,
      name: headerString(trail, "name") ?? source.name,
      path: source.path,
      cwd: headerString(trail, "cwd") ?? source.cwd,
      branch: headerBranch(trail) ?? source.branch,
      session_date: headerString(trail, "ts") ?? source.session_date ?? new Date(0).toISOString(),
    },
  ]);
  const rawJsonl = trailFileJsonl(trail);
  const stampedJsonl = await stampTrailJsonl(rawJsonl);
  const storeRoot = resolveStoreRoot(options.storeRoot);
  const reconciled = await reconcileIncomingSegment(storeRoot, stampedJsonl, options.catalogDb);
  const jsonl = await stampTrailJsonl(
    reconciled.kind === "merged" ? reconciled.canonical : stampedJsonl,
  );
  const registration = await registerGeneratedTrail(jsonl, source.path, options);
  if (registration.status === "invalid" || registration.contentHash === null) {
    return missingLoadResult("invalid", options);
  }
  if (registration.status === "skipped_pending" || registration.objectPath === null) {
    return missingLoadResult("skipped_pending", options);
  }

  await markTrailGenerated(options.catalogDb, {
    agent_name: options.adapter,
    source_id: options.sourceId,
    content_hash: registration.contentHash,
  });

  return {
    status: "loaded",
    adapter: options.adapter,
    sourceId: options.sourceId,
    contentHash: registration.contentHash,
    objectPath: registration.objectPath,
    registerStatus: registration.status,
    reconciliation: reconciled.kind,
    warnings: reconcileWarnings(reconciled),
  };
}

/**
 * Redact and share a generated trail through an injected transport.
 *
 * @public
 */
export async function shareSession(options: ShareSessionOptions): Promise<ShareSessionResult> {
  if (options.transport === undefined) {
    return { status: "transport_missing", adapter: options.adapter, sourceId: options.sourceId };
  }
  const generated = await findGeneratedTrail(options);
  if (generated.status !== "found") {
    return { status: generated.status, adapter: options.adapter, sourceId: options.sourceId };
  }
  const raw = await readFile(generated.path, "utf8");
  const redacted = await redactTrailJsonl(raw, options.redaction);
  const shared = await options.transport.share({
    adapter: options.adapter,
    sourceId: options.sourceId,
    contentHash: generated.contentHash,
    filename: `${generated.contentHash}.trail.jsonl`,
    jsonl: redacted.jsonl,
    redactionSummary: redacted.summary,
  });
  await markGistShared(options.catalogDb, {
    agent_name: options.adapter,
    source_id: options.sourceId,
    gist_id: shared.gistId,
  });
  const result: ShareSessionResult = {
    status: "shared",
    adapter: options.adapter,
    sourceId: options.sourceId,
    contentHash: generated.contentHash,
    gistId: shared.gistId,
    redactionSummary: redacted.summary,
  };
  if (shared.url !== undefined) result.url = shared.url;
  return result;
}

/**
 * Export raw finalized stored trail bytes.
 *
 * @public
 */
export async function exportSession(options: ExportSessionOptions): Promise<ExportSessionResult> {
  const generated = await findGeneratedTrail(options);
  if (generated.status !== "found") {
    return { status: generated.status, adapter: options.adapter, sourceId: options.sourceId };
  }
  const jsonl = await readFile(generated.path, "utf8");
  if (options.toPath !== undefined) {
    await mkdir(dirname(options.toPath), { recursive: true });
    await writeFile(options.toPath, jsonl, "utf8");
    return {
      status: "exported",
      adapter: options.adapter,
      sourceId: options.sourceId,
      contentHash: generated.contentHash,
      path: options.toPath,
    };
  }
  return {
    status: "exported",
    adapter: options.adapter,
    sourceId: options.sourceId,
    contentHash: generated.contentHash,
    jsonl,
  };
}

function resolveAdapters(
  options: Pick<SessionsOptions, "adapters" | "defaultAdapterOptions">,
): readonly TrailAdapter[] {
  return options.adapters ?? createDefaultTrailAdapters(options.defaultAdapterOptions);
}

function refreshDiscoverOptions(options: ListSessionsOptions): DiscoverSessionsOptions {
  const discoverOptions: DiscoverSessionsOptions = { ...options };
  if (options.refresh !== true && options.refresh !== false && options.refresh !== undefined) {
    discoverOptions.detect = options.refresh;
  }
  return discoverOptions;
}

function listCatalogOptions(options: ListSessionsOptions) {
  const catalogOptions: Parameters<typeof listCatalogEntries>[1] = {};
  setDefined(catalogOptions, "include_missing", options.includeMissing);
  setDefined(catalogOptions, "states", options.states);
  setDefined(catalogOptions, "agent_name", options.adapter);
  setDefined(catalogOptions, "cwd", options.cwd);
  setDefined(catalogOptions, "branch", options.branch);
  setDefined(catalogOptions, "date_from", options.dateFrom);
  setDefined(catalogOptions, "date_to", options.dateTo);
  setDefined(catalogOptions, "query", options.query);
  setDefined(catalogOptions, "case_sensitive", options.caseSensitive);
  setDefined(catalogOptions, "limit", options.limit);
  return catalogOptions;
}

function setDefined<TObject extends object, TKey extends keyof TObject>(
  target: TObject,
  key: TKey,
  value: TObject[TKey] | undefined,
): void {
  if (value !== undefined) target[key] = value;
}

function discoveredCatalogRow(agentName: string, ref: SessionRef) {
  if (ref.path === undefined) return [];
  return [
    {
      agent_name: agentName,
      source_id: ref.id,
      name: ref.id,
      path: ref.path,
      cwd: ref.cwd ?? null,
      branch: null,
      session_date: ref.modifiedAt ?? new Date(0).toISOString(),
    },
  ];
}

function discoveredSessionFromCatalogRow(
  row: ReturnType<typeof discoveredCatalogRow>[number],
): DiscoveredSession {
  return {
    adapter: row.agent_name,
    sourceId: row.source_id,
    path: row.path,
    cwd: row.cwd,
    sessionDate: row.session_date,
  };
}

async function healthWarnings(adapter: TrailAdapter): Promise<SessionsWarning[]> {
  const health = await adapter.sourceHealth();
  return health.warnings.map((message) => ({
    adapter: adapter.name,
    code: "source_health_warning",
    message,
  }));
}

async function findSourceRow(
  options: SessionsOptions & SourceSessionSelector,
): Promise<CatalogEntryRow | undefined> {
  const rows = await listCatalogEntries(options.catalogDb, {
    include_missing: true,
    states: ["source", "source+registered"],
    agent_name: options.adapter,
  });
  return rows.find((row) => row.source_id === options.sourceId);
}

async function findGeneratedTrail(
  options: SessionsOptions & SourceSessionSelector,
): Promise<
  | { status: "found"; contentHash: string; path: string }
  | { status: "source_not_found" | "no_generated_trail" }
> {
  await initializeCatalog(options.catalogDb);
  const row = await findSourceRow(options);
  if (row === undefined) return { status: "source_not_found" };
  if (row.content_hash === null) return { status: "no_generated_trail" };
  return {
    status: "found",
    contentHash: row.content_hash,
    path: row.trail_path ?? objectPath(resolveStoreRoot(options.storeRoot), row.content_hash),
  };
}

function trailFileJsonl(trail: TrailFile): string {
  return `${Array.from(trailFileRecords(trail), (record) => JSON.stringify(record)).join("\n")}\n`;
}

function* trailFileRecords(trail: TrailFile): Iterable<object> {
  if (trail.envelope !== undefined) yield trail.envelope;
  for (const group of trail.groups) yield* [group.header, ...group.entries];
}

function headerString(trail: TrailFile, key: string): string | null {
  const value = trail.groups[0]?.header[key as keyof (typeof trail.groups)[number]["header"]];
  return typeof value === "string" ? value : null;
}

function headerBranch(trail: TrailFile): string | null {
  const vcs = trail.groups[0]?.header.vcs;
  if (typeof vcs !== "object" || vcs === null || Array.isArray(vcs)) return null;
  const branch = (vcs as Record<string, unknown>).branch;
  return typeof branch === "string" ? branch : null;
}

async function stampTrailJsonl(jsonl: string): Promise<string> {
  return stampContentHashes(await parseTrailJsonl(jsonl)).jsonl;
}

async function registerGeneratedTrail(
  jsonl: string,
  sourcePath: string,
  options: SessionsOptions,
): ReturnType<typeof registerTrail> {
  const storeRoot = resolveStoreRoot(options.storeRoot);
  const parent = join(storeRoot, ".tmp");
  await mkdir(parent, { recursive: true });
  const scratch = await mkdtemp(join(parent, "sessions-"));
  try {
    const path = join(scratch, "generated.trail.jsonl");
    await writeFile(path, jsonl, "utf8");
    return await registerTrail(path, {
      storeRoot,
      catalogDb: options.catalogDb,
      sourcePath,
    });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

function missingLoadResult(
  status: Exclude<LoadSessionResult["status"], "loaded">,
  options: SourceSessionSelector,
): LoadSessionResult {
  return {
    status,
    adapter: options.adapter,
    sourceId: options.sourceId,
    warnings: [],
  };
}

function reconcileWarnings(
  reconciled: Awaited<ReturnType<typeof reconcileIncomingSegment>>,
): SessionsWarning[] {
  if (reconciled.kind === "passthrough" && reconciled.reason !== undefined) {
    return [
      {
        code: reconciled.reason,
        message: `reconcile passthrough: ${reconciled.reason}`,
      },
    ];
  }
  if (reconciled.kind === "merged") {
    return reconciled.warnings.map((code) => ({
      code,
      message: `reconcile warning: ${code}`,
    }));
  }
  return [];
}
