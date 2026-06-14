import { lstat, readFile } from "node:fs/promises";
import {
  type CatalogDb,
  findTrailObjectsBySessionUid,
  initializeCatalog,
} from "@agent-trail/catalog";
import {
  computeContentHashes,
  type ParsedTrail,
  parseTrailJsonl,
  reconcileSegments,
  serializeTrailJsonl,
} from "@agent-trail/core";
import { objectPath } from "./paths.js";

/**
 * Outcome of attempting to reconcile an incoming segment trail against the
 * local store. `passthrough` means the caller should register the original
 * incoming bytes unchanged; `merged` means the caller should register the
 * merged canonical bytes instead.
 *
 * On `passthrough`, `reason` distinguishes intentional non-merge cases from
 * failures:
 *   - `"no_session_uid"`: incoming trail has no `session_uid`, so it can't
 *     be matched against priors. Intentional, not an error.
 *   - `"invalid_incoming"`: incoming bytes failed to parse. The store was
 *     never accessed.
 *   - `"store_error"`: the catalog could not be queried.
 *     Reconciliation could not run.
 *   - `"corrupt_prior"`: a matching prior was found but no usable prior
 *     records could be loaded (all reads/parses failed).
 *   - `undefined`: no priors matched, or only the incoming segment survived
 *     reconciliation. Intentional, not an error.
 *
 * @public
 */
export type ReconcileIncomingResult =
  | {
      kind: "passthrough";
      reason?: "no_session_uid" | "invalid_incoming" | "store_error" | "corrupt_prior";
    }
  | {
      kind: "merged";
      canonical: string;
      sessionUid: string;
      segmentCount: number;
      warnings: string[];
    };

/**
 * Given an incoming trail's JSONL bytes and a local store root, find any
 * prior segments that share the incoming trail's `header.session_uid` and
 * reconcile them per spec §9.5. When matches are found the merged trail's
 * canonical bytes are returned for the caller to register; otherwise the
 * caller should register the incoming bytes unchanged.
 *
 * Never throws: failures degrade to a `passthrough` result with `reason`
 * set so the caller can surface the cause. See `ReconcileIncomingResult`
 * for the full list of reasons.
 *
 * @public
 */
export async function reconcileIncomingSegment(
  storeRoot: string,
  incomingJsonl: string,
  catalogDb: CatalogDb,
): Promise<ReconcileIncomingResult> {
  const incomingTrail = await parseTrailJsonl(incomingJsonl);
  if (hasParseError(incomingTrail)) {
    return { kind: "passthrough", reason: "invalid_incoming" };
  }
  const incomingUid = headerSessionUid(incomingTrail);
  if (incomingUid === null) return { kind: "passthrough", reason: "no_session_uid" };

  let matches: Awaited<ReturnType<typeof findTrailObjectsBySessionUid>>;
  try {
    await initializeCatalog(catalogDb);
    matches = await findTrailObjectsBySessionUid(catalogDb, incomingUid);
  } catch {
    return { kind: "passthrough", reason: "store_error" };
  }
  const incomingContentHash = sessionContentHash(incomingTrail, incomingUid);
  const priorMatches = matches.filter((match) => match.content_hash !== incomingContentHash);
  if (priorMatches.length === 0) return { kind: "passthrough" };

  const inputs = [incomingTrail];
  for (const match of priorMatches) {
    try {
      const raw = await readStoreObjectFile(objectPath(storeRoot, match.content_hash));
      const trail = await parseTrailJsonl(raw);
      if (!hasParseError(trail)) {
        inputs.push(...trailsForSessionUid(trail, incomingUid));
      }
    } catch {
      // Skip unreadable / corrupted store entries; reconcile still proceeds
      // with whatever segments are intact.
    }
  }

  // Matches existed but every prior failed to load: surface as corrupt_prior
  // so the caller can warn the user that reconciliation was supposed to run.
  if (inputs.length < 2) return { kind: "passthrough", reason: "corrupt_prior" };

  const result = reconcileSegments(inputs);
  const merged = result.trails.find((trail) => headerSessionUid(trail) === incomingUid);
  if (merged === undefined || result.trails.length >= inputs.length) return { kind: "passthrough" };
  return {
    kind: "merged",
    canonical: serializeTrailJsonl(merged),
    sessionUid: incomingUid,
    segmentCount: inputs.length,
    warnings: result.diagnostics.map((diagnostic) => diagnostic.code),
  };
}

function headerSessionUid(trail: ParsedTrail): string | null {
  const uid = trail.groups[0]?.header.record.session_uid;
  return typeof uid === "string" ? uid : null;
}

function hasParseError(trail: ParsedTrail): boolean {
  return trail.records.some((record) => record.record.type === "x-parse-error");
}

function sessionContentHash(trail: ParsedTrail, sessionUid: string): string | undefined {
  const groupIndex = trail.groups.findIndex(
    (group) => group.header.record.session_uid === sessionUid,
  );
  if (groupIndex < 0) return undefined;
  return computeContentHashes(trail).sessionHashes[groupIndex]?.hash;
}

async function readStoreObjectFile(path: string): Promise<string> {
  const info = await lstat(path);
  if (!info.isFile()) throw new Error(`store object is not a regular file: ${path}`);
  return readFile(path, "utf8");
}

function trailsForSessionUid(trail: ParsedTrail, sessionUid: string): ParsedTrail[] {
  if (trail.groups.length <= 1) {
    return headerSessionUid(trail) === sessionUid ? [trail] : [];
  }
  return trail.groups
    .filter((group) => group.header.record.session_uid === sessionUid)
    .map((group) => ({
      groups: [group],
      records: [group.header, ...group.events],
    }));
}
