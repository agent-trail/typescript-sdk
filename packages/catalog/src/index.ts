/**
 * SQLite-backed catalog APIs for Agent Trail source sessions, stored trail
 * objects, generated trail links, and latest Gist share state.
 *
 * @packageDocumentation
 */

import { join } from "node:path";

const CATALOG_SCHEMA_VERSION = 1;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

/**
 * SQLite parameter value accepted by the catalog driver.
 *
 * @public
 */
export type CatalogValue = string | number | null | Uint8Array;

/**
 * Positional parameter list accepted by the catalog driver.
 *
 * @public
 */
export type CatalogParams = readonly CatalogValue[];

/**
 * Minimal SQLite driver contract. Production callers inject their runtime
 * driver; tests can adapt `bun:sqlite` or any compatible SQLite binding.
 *
 * @public
 */
export type CatalogDb = {
  exec(sql: string, params?: CatalogParams): void | Promise<void>;
  get<T = unknown>(
    sql: string,
    params?: CatalogParams,
  ): T | null | undefined | Promise<T | null | undefined>;
  all<T = unknown>(sql: string, params?: CatalogParams): T[] | Promise<T[]>;
};

/**
 * Source-session identity scoped by adapter or agent name.
 *
 * @public
 */
export type SourceSessionKey = {
  agent_name: string;
  source_id: string;
};

/**
 * Normalized source session discovered by an adapter.
 *
 * @public
 */
export type DiscoveredCatalogSession = SourceSessionKey & {
  name?: string | null;
  path: string;
  session_date: string;
};

/**
 * Options for discovered-session upserts.
 *
 * @public
 */
export type UpsertDiscoveredSessionsOptions = {
  now?: string;
};

/**
 * Options for marking previously seen source sessions missing.
 *
 * @public
 */
export type MarkMissingSourcesOptions = {
  agent_name?: string;
  now?: string;
};

/**
 * Kind of stored trail object represented in the catalog.
 *
 * @public
 */
export type TrailObjectKind = "session" | "trail";

/**
 * Catalog metadata for a content-addressed stored trail object.
 *
 * @public
 */
export type CatalogTrailObject = {
  content_hash: string;
  kind: TrailObjectKind;
  object_path: string;
  source_path: string | null;
  session_uid: string | null;
  registered_at: string;
};

/**
 * Input for linking a source session to its current generated trail object.
 *
 * @public
 */
export type MarkTrailGeneratedInput = SourceSessionKey & {
  content_hash: string;
  trail_generated_at?: string;
};

/**
 * Input for recording the latest Gist share for a generated trail.
 *
 * @public
 */
export type MarkGistSharedInput = SourceSessionKey & {
  gist_id: string;
  gist_shared_at?: string;
};

/**
 * Options for listing source sessions from the catalog.
 *
 * @public
 */
export type ListCatalogSessionsOptions = {
  include_missing?: boolean;
  agent_name?: string;
  limit?: number;
};

/**
 * Flat catalog row for source-session list views.
 *
 * @public
 */
export type CatalogSessionRow = {
  source_id: string;
  name: string | null;
  path: string;
  agent_name: string;
  has_generated_trail: boolean;
  trail_path: string | null;
  gist_id: string | null;
  session_date: string;
  trail_generated_at: string | null;
  gist_shared_at: string | null;
};

/**
 * Error thrown when a catalog operation references a missing source or object.
 *
 * @public
 */
export class CatalogNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogNotFoundError";
  }
}

/**
 * Return the default SQLite catalog file path under a store root.
 *
 * @public
 */
export function catalogPath(storeRoot: string): string {
  return join(storeRoot, "catalog.sqlite");
}

/**
 * Create or migrate the catalog schema for the provided SQLite driver.
 *
 * @public
 */
export async function initializeCatalog(db: CatalogDb): Promise<void> {
  await db.exec("PRAGMA foreign_keys = ON");
  const current = await db.get<{ user_version: number }>("PRAGMA user_version");
  const version = current?.user_version ?? 0;
  if (version > CATALOG_SCHEMA_VERSION) {
    throw new Error(
      `catalog schema version ${version} is newer than supported version ${CATALOG_SCHEMA_VERSION}`,
    );
  }
  if (version === 0) {
    await createCatalogSchemaV1(db);
  }
}

async function createCatalogSchemaV1(db: CatalogDb): Promise<void> {
  await db.exec("BEGIN IMMEDIATE");
  try {
    await db.exec(`
      CREATE TABLE source_sessions (
        agent_name TEXT NOT NULL,
        source_id TEXT NOT NULL,
        name TEXT,
        path TEXT NOT NULL,
        session_date TEXT NOT NULL,
        missing INTEGER NOT NULL DEFAULT 0,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (agent_name, source_id)
      );

      CREATE TABLE trail_objects (
        content_hash TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('session', 'trail')),
        object_path TEXT NOT NULL,
        source_path TEXT,
        session_uid TEXT,
        registered_at TEXT NOT NULL
      );

      CREATE TABLE source_trail_links (
        agent_name TEXT NOT NULL,
        source_id TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        trail_generated_at TEXT NOT NULL,
        gist_id TEXT,
        gist_shared_at TEXT,
        PRIMARY KEY (agent_name, source_id),
        FOREIGN KEY (agent_name, source_id)
          REFERENCES source_sessions(agent_name, source_id)
          ON DELETE CASCADE,
        FOREIGN KEY (content_hash)
          REFERENCES trail_objects(content_hash)
      );

      CREATE INDEX trail_objects_session_uid_idx
        ON trail_objects(session_uid);

      CREATE INDEX source_sessions_session_date_idx
        ON source_sessions(session_date);
    `);
    await db.exec(`PRAGMA user_version = ${CATALOG_SCHEMA_VERSION}`);
    await db.exec("COMMIT");
  } catch (error) {
    await db.exec("ROLLBACK");
    throw error;
  }
}

/**
 * Insert or update discovered source sessions and mark them present.
 *
 * @public
 */
export async function upsertDiscoveredSessions(
  db: CatalogDb,
  rows: readonly DiscoveredCatalogSession[],
  opts: UpsertDiscoveredSessionsOptions = {},
): Promise<void> {
  const now = opts.now ?? new Date().toISOString();
  for (const row of rows) {
    await db.exec(
      `INSERT INTO source_sessions (
        agent_name,
        source_id,
        name,
        path,
        session_date,
        missing,
        first_seen_at,
        last_seen_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
      ON CONFLICT(agent_name, source_id) DO UPDATE SET
        name = excluded.name,
        path = excluded.path,
        session_date = excluded.session_date,
        missing = 0,
        last_seen_at = excluded.last_seen_at,
        updated_at = excluded.updated_at`,
      [row.agent_name, row.source_id, row.name ?? null, row.path, row.session_date, now, now, now],
    );
  }
}

/**
 * Mark catalog source sessions missing when absent from the latest discovery set.
 *
 * @public
 */
export async function markMissingSources(
  db: CatalogDb,
  seenKeys: readonly SourceSessionKey[],
  opts: MarkMissingSourcesOptions = {},
): Promise<void> {
  const now = opts.now ?? new Date().toISOString();
  const allRows = await db.all<SourceSessionKey>(
    opts.agent_name === undefined
      ? "SELECT agent_name, source_id FROM source_sessions"
      : "SELECT agent_name, source_id FROM source_sessions WHERE agent_name = ?",
    opts.agent_name === undefined ? [] : [opts.agent_name],
  );
  const seen = new Set(seenKeys.map((key) => sourceKey(key.agent_name, key.source_id)));
  for (const row of allRows) {
    if (seen.has(sourceKey(row.agent_name, row.source_id))) continue;
    await db.exec(
      `UPDATE source_sessions
        SET missing = 1, updated_at = ?
        WHERE agent_name = ? AND source_id = ?`,
      [now, row.agent_name, row.source_id],
    );
  }
}

/**
 * Insert or update metadata for a stored trail object.
 *
 * @public
 */
export async function upsertTrailObject(db: CatalogDb, row: CatalogTrailObject): Promise<void> {
  assertContentHash(row.content_hash);
  await db.exec(
    `INSERT INTO trail_objects (
      content_hash,
      kind,
      object_path,
      source_path,
      session_uid,
      registered_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(content_hash) DO UPDATE SET
      kind = excluded.kind,
      object_path = excluded.object_path,
      source_path = excluded.source_path,
      session_uid = excluded.session_uid,
      registered_at = excluded.registered_at`,
    [
      row.content_hash,
      row.kind,
      row.object_path,
      row.source_path,
      row.session_uid,
      row.registered_at,
    ],
  );
}

/**
 * Link a source session to its current generated trail object.
 *
 * @public
 */
export async function markTrailGenerated(
  db: CatalogDb,
  input: MarkTrailGeneratedInput,
): Promise<void> {
  assertContentHash(input.content_hash);
  await assertSourceExists(db, input);
  await assertTrailObjectExists(db, input.content_hash);
  const generatedAt = input.trail_generated_at ?? new Date().toISOString();
  await db.exec(
    `INSERT INTO source_trail_links (
      agent_name,
      source_id,
      content_hash,
      trail_generated_at,
      gist_id,
      gist_shared_at
    ) VALUES (?, ?, ?, ?, NULL, NULL)
    ON CONFLICT(agent_name, source_id) DO UPDATE SET
      content_hash = excluded.content_hash,
      trail_generated_at = excluded.trail_generated_at,
      gist_id = NULL,
      gist_shared_at = NULL`,
    [input.agent_name, input.source_id, input.content_hash, generatedAt],
  );
}

/**
 * Record the latest Gist share for a source session's generated trail.
 *
 * @public
 */
export async function markGistShared(db: CatalogDb, input: MarkGistSharedInput): Promise<void> {
  const link = await db.get<{ content_hash: string }>(
    `SELECT content_hash
      FROM source_trail_links
      WHERE agent_name = ? AND source_id = ?`,
    [input.agent_name, input.source_id],
  );
  if (link == null) {
    throw new CatalogNotFoundError(
      `source session ${input.agent_name}/${input.source_id} has no generated trail`,
    );
  }
  await db.exec(
    `UPDATE source_trail_links
      SET gist_id = ?, gist_shared_at = ?
      WHERE agent_name = ? AND source_id = ?`,
    [
      input.gist_id,
      input.gist_shared_at ?? new Date().toISOString(),
      input.agent_name,
      input.source_id,
    ],
  );
}

/**
 * List source sessions with derived trail and share state.
 *
 * @public
 */
export async function listCatalogSessions(
  db: CatalogDb,
  opts: ListCatalogSessionsOptions = {},
): Promise<CatalogSessionRow[]> {
  const conditions: string[] = [];
  const params: CatalogValue[] = [];
  if (opts.include_missing !== true) conditions.push("s.missing = 0");
  if (opts.agent_name !== undefined) {
    conditions.push("s.agent_name = ?");
    params.push(opts.agent_name);
  }
  const where = conditions.length === 0 ? "" : `WHERE ${conditions.join(" AND ")}`;
  const limit = opts.limit === undefined ? "" : "LIMIT ?";
  if (opts.limit !== undefined) params.push(opts.limit);
  const rows = await db.all<{
    source_id: string;
    name: string | null;
    path: string;
    agent_name: string;
    has_generated_trail: 0 | 1;
    trail_path: string | null;
    gist_id: string | null;
    session_date: string;
    trail_generated_at: string | null;
    gist_shared_at: string | null;
  }>(
    `SELECT
      s.source_id,
      s.name,
      s.path,
      s.agent_name,
      CASE WHEN l.content_hash IS NULL THEN 0 ELSE 1 END AS has_generated_trail,
      o.object_path AS trail_path,
      l.gist_id,
      s.session_date,
      l.trail_generated_at,
      l.gist_shared_at
    FROM source_sessions s
    LEFT JOIN source_trail_links l
      ON l.agent_name = s.agent_name AND l.source_id = s.source_id
    LEFT JOIN trail_objects o
      ON o.content_hash = l.content_hash
    ${where}
    ORDER BY s.session_date DESC, s.agent_name ASC, s.source_id ASC
    ${limit}`,
    params,
  );
  return rows.map((row) => ({
    ...row,
    has_generated_trail: row.has_generated_trail === 1,
  }));
}

/**
 * Find stored trail objects associated with a session UID.
 *
 * @public
 */
export async function findTrailObjectsBySessionUid(
  db: CatalogDb,
  session_uid: string,
): Promise<CatalogTrailObject[]> {
  return await db.all<CatalogTrailObject>(
    `SELECT
      content_hash,
      kind,
      object_path,
      source_path,
      session_uid,
      registered_at
    FROM trail_objects
    WHERE session_uid = ?
    ORDER BY registered_at ASC, content_hash ASC`,
    [session_uid],
  );
}

async function assertSourceExists(db: CatalogDb, key: SourceSessionKey): Promise<void> {
  const source = await db.get<{ agent_name: string }>(
    `SELECT agent_name
      FROM source_sessions
      WHERE agent_name = ? AND source_id = ?`,
    [key.agent_name, key.source_id],
  );
  if (source == null) {
    throw new CatalogNotFoundError(`unknown source session ${key.agent_name}/${key.source_id}`);
  }
}

async function assertTrailObjectExists(db: CatalogDb, contentHash: string): Promise<void> {
  assertContentHash(contentHash);
  const object = await db.get<{ content_hash: string }>(
    "SELECT content_hash FROM trail_objects WHERE content_hash = ?",
    [contentHash],
  );
  if (object == null) {
    throw new CatalogNotFoundError(`unknown trail object ${contentHash}`);
  }
}

function assertContentHash(contentHash: string): void {
  if (!SHA256_HEX_PATTERN.test(contentHash)) {
    throw new Error(`invalid trail object content_hash: ${contentHash}`);
  }
}

function sourceKey(agentName: string, sourceId: string): string {
  return `${agentName}\u0000${sourceId}`;
}
