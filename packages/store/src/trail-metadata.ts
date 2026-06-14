import type { CatalogTrailObject } from "@agent-trail/catalog";
import {
  computeContentHashes,
  type ParsedTrail,
  type ParsedTrailRecord,
  type SessionGroup,
} from "@agent-trail/core";
import type { FinalizedObjectIndexRow } from "./object-index-policy.js";

/**
 * @internal
 */
export type CatalogObjectMetadata = Pick<
  CatalogTrailObject,
  "agent_name" | "name" | "cwd" | "branch" | "session_date"
>;

/**
 * @internal
 */
export function catalogMetadataForObjectRow(
  trail: ParsedTrail,
  row: FinalizedObjectIndexRow,
): CatalogObjectMetadata {
  if (row.kind !== "session") return {};
  const group = sessionGroupForObjectRow(trail, row);
  if (group === undefined) return {};

  const header = group.header.record;
  const metadata: CatalogObjectMetadata = {
    agent_name: agentName(header),
    name: readString(header, "name") ?? null,
    cwd: readString(header, "cwd") ?? null,
    branch: headerBranch(header) ?? null,
    session_date: readString(header, "ts") ?? latestTimestamp([group.header, ...group.events]),
  };

  for (const event of group.events) {
    const update = metadataUpdate(event);
    if (update?.field === "name") metadata.name = update.value;
    if (update?.field === "vcs.branch") metadata.branch = update.value;
  }

  return metadata;
}

/**
 * @internal
 */
export function sessionGroupForObjectRow(
  trail: ParsedTrail,
  row: FinalizedObjectIndexRow,
): SessionGroup | undefined {
  if (row.kind !== "session") return;
  const hashes = computeContentHashes(trail).sessionHashes;
  const groupIndex = hashes.findIndex((hash) => hash.hash === row.contentHash);
  return trail.groups[groupIndex];
}

function metadataUpdate(event: ParsedTrailRecord): { field: string; value: string } | undefined {
  if (!isJsonObject(event.record) || event.record.type !== "session_metadata_update") return;
  const payload = event.record.payload;
  if (!isJsonObject(payload) || typeof payload.field !== "string") return;
  if (typeof payload.value !== "string") return;
  return { field: payload.field, value: payload.value };
}

function agentName(record: unknown): string | null {
  if (!isJsonObject(record)) return null;
  const agent = record.agent;
  if (!isJsonObject(agent)) return null;
  return readString(agent, "name") ?? null;
}

function headerBranch(record: unknown): string | undefined {
  if (!isJsonObject(record)) return;
  const vcs = record.vcs;
  if (!isJsonObject(vcs)) return;
  return readString(vcs, "branch");
}

function latestTimestamp(records: ParsedTrailRecord[]): string | null {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const ts = readString(records[index]?.record, "ts");
    if (ts !== undefined) return ts;
  }
  return null;
}

function readString(record: unknown, key: string): string | undefined {
  if (!isJsonObject(record)) return;
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
