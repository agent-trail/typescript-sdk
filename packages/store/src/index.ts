/**
 * Agent Trail local content-addressed object store.
 *
 * Finalized trail artifacts live under
 * `<storeRoot>/objects/sha256/<content_hash>.trail.jsonl`. Mutable query
 * metadata belongs to `@agent-trail/catalog`. `storeRoot` defaults to
 * `~/.local/share/trail` and is overridable via the `AGENT_TRAIL_HOME` env var
 * or an explicit `storeRoot` option.
 *
 * - `registerTrail` — validate + hash + write a trail to the store.
 *   Downstream CLI verbs (`trail share`, `trail load`, `trail handoff`,
 *   `trail view`) call this directly so users never type
 *   `trail register`.
 * - `rebuildObjectCatalog` — regenerate catalog object rows from on-disk
 *   objects after manual edits.
 * - `resolveStoreRoot` — resolve the effective store root for the
 *   current call site.
 */

export type { CatalogDb, CatalogParams, CatalogValue } from "@agent-trail/catalog";
export type { TrailDiagnostic } from "@agent-trail/core";
export { objectPath, resolveStoreRoot } from "./paths.js";
export type { RebuildObjectCatalogOptions, RebuildObjectCatalogResult } from "./rebuild.js";
export { rebuildObjectCatalog } from "./rebuild.js";
export type { ReconcileIncomingResult } from "./reconcile-incoming.js";
export { reconcileIncomingSegment } from "./reconcile-incoming.js";
export type { RegisterOptions, RegisterResult, RegisterStatus } from "./register.js";
export { registerTrail } from "./register.js";
