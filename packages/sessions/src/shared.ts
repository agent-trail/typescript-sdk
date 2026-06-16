import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SessionRef, TrailAdapter, TrailFile } from "@agent-trail/adapters";
import { createDefaultTrailAdapters } from "@agent-trail/adapters";
import { type CatalogEntryRow, initializeCatalog, listCatalogEntries } from "@agent-trail/catalog";
import { parseTrailJsonl, stampContentHashes } from "@agent-trail/core";
import {
  objectPath,
  type reconcileIncomingSegment,
  registerTrail,
  resolveStoreRoot,
} from "@agent-trail/store";
import type {
  DiscoveredSession,
  ListSessionsOptions,
  LoadSessionResult,
  SessionsOptions,
  SessionsWarning,
  SourceSessionSelector,
} from "./types.js";

export function resolveAdapters(
  options: Pick<SessionsOptions, "adapters" | "defaultAdapterOptions">,
): readonly TrailAdapter[] {
  return options.adapters ?? createDefaultTrailAdapters(options.defaultAdapterOptions);
}

export function listCatalogOptions(options: ListSessionsOptions) {
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

export function discoveredCatalogRow(agentName: string, ref: SessionRef) {
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

export function discoveredSessionFromCatalogRow(
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

export async function healthWarnings(adapter: TrailAdapter): Promise<SessionsWarning[]> {
  const health = await adapter.sourceHealth();
  return health.warnings.map((message) => ({
    adapter: adapter.name,
    code: "source_health_warning",
    message,
  }));
}

export async function findSourceRow(
  options: SessionsOptions & SourceSessionSelector,
): Promise<CatalogEntryRow | undefined> {
  const rows = await listCatalogEntries(options.catalogDb, {
    include_missing: true,
    states: ["source", "source+registered"],
    agent_name: options.adapter,
  });
  return rows.find((row) => row.source_id === options.sourceId);
}

export async function findGeneratedTrail(
  options: SessionsOptions & SourceSessionSelector,
): Promise<
  | { status: "found"; contentHash: string; path: string }
  | { status: "source_not_found" | "no_generated_trail" }
> {
  await initializeCatalog(options.catalogDb);
  const row = await findSourceRow(options);
  if (row === undefined) return { status: "source_not_found" };
  if (row.content_hash === null) return { status: "no_generated_trail" };
  const linked = await verifyLinkedSessionObject(options, row);
  if (linked === undefined) {
    return { status: "no_generated_trail" };
  }
  return {
    status: "found",
    contentHash: linked.contentHash,
    path: linked.objectPath,
  };
}

async function verifyLinkedSessionObject(
  options: SessionsOptions & SourceSessionSelector,
  row: CatalogEntryRow,
): Promise<{ contentHash: string; objectPath: string } | undefined> {
  const adapter = resolveAdapters(options).find((candidate) => candidate.name === options.adapter);
  if (adapter === undefined || row.path === null || row.content_hash === null) return undefined;
  const trail = await adapter.parseSession({
    id: options.sourceId,
    adapter: options.adapter,
    path: row.path,
    cwd: row.cwd ?? undefined,
  });
  const linked = await linkedSessionObject(
    await stampTrailJsonl(trailFileJsonl(trail)),
    resolveStoreRoot(options.storeRoot),
  );
  return linked?.contentHash === row.content_hash ? linked : undefined;
}

export function trailFileJsonl(trail: TrailFile): string {
  return `${Array.from(trailFileRecords(trail), (record) => JSON.stringify(record)).join("\n")}\n`;
}

export function headerString(trail: TrailFile, key: string): string | null {
  const value = trail.groups[0]?.header[key as keyof (typeof trail.groups)[number]["header"]];
  return typeof value === "string" ? value : null;
}

export function headerBranch(trail: TrailFile): string | null {
  const vcs = trail.groups[0]?.header.vcs;
  if (typeof vcs !== "object" || vcs === null || Array.isArray(vcs)) return null;
  const branch = (vcs as Record<string, unknown>).branch;
  return typeof branch === "string" ? branch : null;
}

export async function stampTrailJsonl(jsonl: string): Promise<string> {
  return stampContentHashes(await parseTrailJsonl(jsonl)).jsonl;
}

export async function linkedSessionObject(
  jsonl: string,
  storeRoot: string,
): Promise<{ contentHash: string; objectPath: string } | undefined> {
  const parsed = await parseTrailJsonl(jsonl);
  const contentHash = parsed.groups[0]?.header.record.content_hash;
  return typeof contentHash === "string"
    ? { contentHash, objectPath: objectPath(storeRoot, contentHash) }
    : undefined;
}

export async function registerGeneratedTrail(
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

export function missingLoadResult(
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

export function reconcileWarnings(
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

function setDefined<TObject extends object, TKey extends keyof TObject>(
  target: TObject,
  key: TKey,
  value: TObject[TKey] | undefined,
): void {
  if (value !== undefined) target[key] = value;
}

function* trailFileRecords(trail: TrailFile): Iterable<object> {
  if (trail.envelope !== undefined) yield trail.envelope;
  for (const group of trail.groups) yield* [group.header, ...group.entries];
}
