/**
 * SQLite-backed catalog APIs for Agent Trail source sessions, stored trail
 * objects, generated trail links, and latest Gist share state.
 *
 * @packageDocumentation
 */

import { join } from "node:path";

const CATALOG_SCHEMA_VERSION = 1;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;
const CATALOG_INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS trail_objects_session_uid_idx
    ON trail_objects(session_uid);

  CREATE INDEX IF NOT EXISTS source_sessions_session_date_idx
    ON source_sessions(session_date);

  CREATE INDEX IF NOT EXISTS source_sessions_agent_name_idx
    ON source_sessions(agent_name);

  CREATE INDEX IF NOT EXISTS source_sessions_cwd_idx
    ON source_sessions(cwd);

  CREATE INDEX IF NOT EXISTS source_sessions_branch_idx
    ON source_sessions(branch);

  CREATE INDEX IF NOT EXISTS trail_objects_agent_name_idx
    ON trail_objects(agent_name);

  CREATE INDEX IF NOT EXISTS trail_objects_session_date_idx
    ON trail_objects(session_date);
`;

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
  cwd?: string | null;
  branch?: string | null;
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
  agent_name?: string | null;
  name?: string | null;
  cwd?: string | null;
  branch?: string | null;
  session_date?: string | null;
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
 * Catalog row state for session-centric list views.
 *
 * @public
 */
export type CatalogEntryState = "source" | "source+registered" | "registered";

/**
 * Options for listing source and registered session entries from the catalog.
 *
 * @public
 */
export type ListCatalogEntriesOptions = {
  include_missing?: boolean;
  states?: readonly CatalogEntryState[];
  agent_name?: string;
  cwd?: string;
  branch?: string;
  date_from?: string;
  date_to?: string;
  query?: string;
  case_sensitive?: boolean;
  limit?: number;
};

/**
 * Flat catalog row for session-centric source and registered object list views.
 *
 * @public
 */
export type CatalogEntryRow = {
  state: CatalogEntryState;
  source_id: string | null;
  content_hash: string | null;
  agent_name: string | null;
  name: string | null;
  path: string | null;
  cwd: string | null;
  branch: string | null;
  session_date: string | null;
  latest_at: string | null;
  trail_path: string | null;
  registered_at: string | null;
  trail_generated_at: string | null;
  gist_id: string | null;
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
    await createCatalogSchema(db);
  }
}

async function createCatalogSchema(db: CatalogDb): Promise<void> {
  await db.exec("BEGIN IMMEDIATE");
  try {
    await db.exec(`
      CREATE TABLE source_sessions (
        agent_name TEXT NOT NULL,
        source_id TEXT NOT NULL,
        name TEXT,
        path TEXT NOT NULL,
        cwd TEXT,
        branch TEXT,
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
        registered_at TEXT NOT NULL,
        agent_name TEXT,
        name TEXT,
        cwd TEXT,
        branch TEXT,
        session_date TEXT
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

    `);
    await db.exec(CATALOG_INDEX_SQL);
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
        cwd,
        branch,
        session_date,
        missing,
        first_seen_at,
        last_seen_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
      ON CONFLICT(agent_name, source_id) DO UPDATE SET
        name = excluded.name,
        path = excluded.path,
        cwd = excluded.cwd,
        branch = excluded.branch,
        session_date = excluded.session_date,
        missing = 0,
        last_seen_at = excluded.last_seen_at,
        updated_at = excluded.updated_at`,
      [
        row.agent_name,
        row.source_id,
        row.name ?? null,
        row.path,
        row.cwd ?? null,
        row.branch ?? null,
        row.session_date,
        now,
        now,
        now,
      ],
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
      registered_at,
      agent_name,
      name,
      cwd,
      branch,
      session_date
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(content_hash) DO UPDATE SET
      kind = excluded.kind,
      object_path = excluded.object_path,
      source_path = excluded.source_path,
      session_uid = excluded.session_uid,
      registered_at = excluded.registered_at,
      agent_name = excluded.agent_name,
      name = excluded.name,
      cwd = excluded.cwd,
      branch = excluded.branch,
      session_date = excluded.session_date`,
    [
      row.content_hash,
      row.kind,
      row.object_path,
      row.source_path,
      row.session_uid,
      row.registered_at,
      row.agent_name ?? null,
      row.name ?? null,
      row.cwd ?? null,
      row.branch ?? null,
      row.session_date ?? null,
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
 * List source sessions and registered session objects with derived trail and share state.
 *
 * @public
 */
export async function listCatalogEntries(
  db: CatalogDb,
  opts: ListCatalogEntriesOptions = {},
): Promise<CatalogEntryRow[]> {
  validateListCatalogEntriesOptions(opts);
  const rows = [...(await sourceEntryRows(db, opts)), ...(await registeredEntryRows(db, opts))];
  const filtered = rows.filter((row) => entryMatches(row, opts));
  filtered.sort(compareEntries);
  return opts.limit === undefined ? filtered : filtered.slice(0, opts.limit);
}

async function sourceEntryRows(
  db: CatalogDb,
  opts: ListCatalogEntriesOptions,
): Promise<CatalogEntryRow[]> {
  if (
    opts.states !== undefined &&
    !opts.states.includes("source") &&
    !opts.states.includes("source+registered")
  ) {
    return [];
  }
  const conditions: string[] = [];
  const params: CatalogValue[] = [];
  if (opts.include_missing !== true) conditions.push("s.missing = 0");
  if (opts.agent_name !== undefined) {
    conditions.push("s.agent_name = ?");
    params.push(opts.agent_name);
  }
  if (opts.cwd !== undefined) {
    conditions.push("s.cwd = ?");
    params.push(opts.cwd);
  }
  if (opts.branch !== undefined) {
    conditions.push("s.branch = ?");
    params.push(opts.branch);
  }
  const where = conditions.length === 0 ? "" : `WHERE ${conditions.join(" AND ")}`;
  const sourceRows = await db.all<{
    source_id: string;
    name: string | null;
    path: string;
    agent_name: string;
    cwd: string | null;
    branch: string | null;
    session_date: string;
    content_hash: string | null;
    trail_path: string | null;
    registered_at: string | null;
    trail_generated_at: string | null;
    gist_id: string | null;
    gist_shared_at: string | null;
  }>(
    `SELECT
      s.source_id,
      s.name,
      s.path,
      s.agent_name,
      s.cwd,
      s.branch,
      s.session_date,
      l.content_hash,
      o.object_path AS trail_path,
      o.registered_at,
      l.trail_generated_at,
      l.gist_id,
      l.gist_shared_at
    FROM source_sessions s
    LEFT JOIN source_trail_links l
      ON l.agent_name = s.agent_name AND l.source_id = s.source_id
    LEFT JOIN trail_objects o
      ON o.content_hash = l.content_hash
    ${where}`,
    params,
  );
  return sourceRows.map((row) => ({
    state: row.content_hash === null ? "source" : "source+registered",
    source_id: row.source_id,
    content_hash: row.content_hash,
    agent_name: row.agent_name,
    name: row.name,
    path: row.path,
    cwd: row.cwd,
    branch: row.branch,
    session_date: row.session_date,
    latest_at: latestTimestamp(row.session_date, row.registered_at, row.trail_generated_at),
    trail_path: row.trail_path,
    registered_at: row.registered_at,
    trail_generated_at: row.trail_generated_at,
    gist_id: row.gist_id,
    gist_shared_at: row.gist_shared_at,
  }));
}

async function registeredEntryRows(
  db: CatalogDb,
  opts: ListCatalogEntriesOptions,
): Promise<CatalogEntryRow[]> {
  if (opts.states !== undefined && !opts.states.includes("registered")) return [];
  const conditions = ["o.kind = 'session'"];
  const params: CatalogValue[] = [];
  if (opts.agent_name !== undefined) {
    conditions.push("o.agent_name = ?");
    params.push(opts.agent_name);
  }
  if (opts.cwd !== undefined) {
    conditions.push("o.cwd = ?");
    params.push(opts.cwd);
  }
  if (opts.branch !== undefined) {
    conditions.push("o.branch = ?");
    params.push(opts.branch);
  }
  const objectRows = await db.all<{
    content_hash: string;
    object_path: string;
    source_path: string | null;
    registered_at: string;
    agent_name: string | null;
    name: string | null;
    cwd: string | null;
    branch: string | null;
    session_date: string | null;
  }>(
    `SELECT
      o.content_hash,
      o.object_path,
      o.source_path,
      o.registered_at,
      o.agent_name,
      o.name,
      o.cwd,
      o.branch,
      o.session_date
    FROM trail_objects o
    WHERE ${conditions.join(" AND ")}
      AND NOT EXISTS (
        SELECT 1
        FROM source_trail_links l
        WHERE l.content_hash = o.content_hash
      )`,
    params,
  );
  return objectRows.map((row) => ({
    state: "registered",
    source_id: null,
    content_hash: row.content_hash,
    agent_name: row.agent_name,
    name: row.name,
    path: row.source_path,
    cwd: row.cwd,
    branch: row.branch,
    session_date: row.session_date,
    latest_at: latestTimestamp(row.session_date, row.registered_at),
    trail_path: row.object_path,
    registered_at: row.registered_at,
    trail_generated_at: null,
    gist_id: null,
    gist_shared_at: null,
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

function entryMatches(row: CatalogEntryRow, opts: ListCatalogEntriesOptions): boolean {
  return [
    stateMatches(row.state, opts.states),
    exactMatch(row.agent_name, opts.agent_name),
    exactMatch(row.cwd, opts.cwd),
    exactMatch(row.branch, opts.branch),
    boundedBy(row.latest_at, opts.date_from, opts.date_to),
    queryMatches(row, opts),
  ].every(Boolean);
}

function validateListCatalogEntriesOptions(opts: ListCatalogEntriesOptions): void {
  if (opts.limit !== undefined && (!Number.isInteger(opts.limit) || opts.limit < 1)) {
    throw new Error(`invalid limit: expected positive integer, got ${opts.limit}`);
  }
  assertDateOption("date_from", opts.date_from);
  assertDateOption("date_to", opts.date_to);
}

function assertDateOption(name: string, value: string | undefined): void {
  if (value === undefined) return;
  if (Number.isNaN(Date.parse(value))) {
    throw new Error(`invalid ${name}: ${value}`);
  }
}

function stateMatches(
  state: CatalogEntryState,
  allowed: readonly CatalogEntryState[] | undefined,
): boolean {
  return allowed === undefined || allowed.includes(state);
}

function exactMatch(actual: string | null, expected: string | undefined): boolean {
  return expected === undefined || actual === expected;
}

function queryMatches(row: CatalogEntryRow, opts: ListCatalogEntriesOptions): boolean {
  return opts.query === undefined || matchesQuery(row, opts.query, opts.case_sensitive === true);
}

function boundedBy(
  value: string | null,
  from: string | undefined,
  to: string | undefined,
): boolean {
  const fromMs = timestampMs(from);
  const toMs = timestampMs(to);
  if (fromMs === null && toMs === null) return true;
  const valueMs = timestampMs(value);
  return valueMs !== null && lowerBoundMatches(valueMs, fromMs) && upperBoundMatches(valueMs, toMs);
}

function timestampMs(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function lowerBoundMatches(value: number, from: number | null): boolean {
  return from === null || value >= from;
}

function upperBoundMatches(value: number, to: number | null): boolean {
  return to === null || value < to;
}

function matchesQuery(row: CatalogEntryRow, query: string, caseSensitive: boolean): boolean {
  const haystack = [row.name, row.path, row.agent_name, row.cwd, row.branch, row.content_hash]
    .filter((value): value is string => value !== null)
    .join("\n");
  if (caseSensitive) return haystack.includes(query);
  return haystack.toLowerCase().includes(query.toLowerCase());
}

function compareEntries(left: CatalogEntryRow, right: CatalogEntryRow): number {
  const byLatest = compareNullableTimestamps(right.latest_at, left.latest_at);
  if (byLatest !== 0) return byLatest;
  return entryIdentity(left).localeCompare(entryIdentity(right));
}

function entryIdentity(row: CatalogEntryRow): string {
  return row.source_id ?? row.content_hash ?? "";
}

function latestTimestamp(...values: (string | null)[]): string | null {
  return values.reduce<string | null>((latest, value) => {
    return compareNullableTimestamps(value, latest) > 0 ? value : latest;
  }, null);
}

function compareNullableTimestamps(left: string | null, right: string | null): number {
  if (left === null && right === null) return 0;
  if (left === null) return -1;
  if (right === null) return 1;
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  if (Number.isNaN(leftMs) && Number.isNaN(rightMs)) return left.localeCompare(right);
  if (Number.isNaN(leftMs)) return -1;
  if (Number.isNaN(rightMs)) return 1;
  return leftMs - rightMs;
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
