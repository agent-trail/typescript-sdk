import { initializeCatalog, listCatalogEntries } from "@agent-trail/catalog";
import { discoverSessions } from "./discover.js";
import { listCatalogOptions } from "./shared.js";
import type { DiscoverSessionsOptions, ListSessionsOptions, ListSessionsResult } from "./types.js";

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

function refreshDiscoverOptions(options: ListSessionsOptions): DiscoverSessionsOptions {
  const discoverOptions: DiscoverSessionsOptions = { ...options };
  if (options.refresh !== true && options.refresh !== false && options.refresh !== undefined) {
    discoverOptions.detect = options.refresh;
  }
  return discoverOptions;
}
