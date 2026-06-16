import {
  initializeCatalog,
  markTrailGenerated,
  upsertDiscoveredSessions,
} from "@agent-trail/catalog";
import { reconcileIncomingSegment, resolveStoreRoot } from "@agent-trail/store";
import {
  findSourceRow,
  headerBranch,
  headerString,
  linkedSessionObject,
  missingLoadResult,
  reconcileWarnings,
  registerGeneratedTrail,
  resolveAdapters,
  stampTrailJsonl,
  trailFileJsonl,
} from "./shared.js";
import type { LoadSessionOptions, LoadSessionResult } from "./types.js";

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

  const trail = await adapter.parseSession({
    id: options.sourceId,
    adapter: options.adapter,
    path: source.path,
    cwd: source.cwd ?? undefined,
  });
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
  const stampedJsonl = await stampTrailJsonl(trailFileJsonl(trail));
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

  const linked = await linkedSessionObject(jsonl, storeRoot);
  if (linked === undefined) return missingLoadResult("invalid", options);

  await markTrailGenerated(options.catalogDb, {
    agent_name: options.adapter,
    source_id: options.sourceId,
    content_hash: linked.contentHash,
  });

  return {
    status: "loaded",
    adapter: options.adapter,
    sourceId: options.sourceId,
    contentHash: linked.contentHash,
    objectPath: linked.objectPath,
    registerStatus: registration.status,
    reconciliation: reconciled.kind,
    warnings: reconcileWarnings(reconciled),
  };
}
