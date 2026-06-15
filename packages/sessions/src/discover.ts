import {
  initializeCatalog,
  markMissingSources,
  upsertDiscoveredSessions,
} from "@agent-trail/catalog";
import {
  discoveredCatalogRow,
  discoveredSessionFromCatalogRow,
  healthWarnings,
  resolveAdapters,
} from "./shared.js";
import type { DiscoverSessionsOptions, DiscoverSessionsResult, SessionsWarning } from "./types.js";

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
  const sessions = [];

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
