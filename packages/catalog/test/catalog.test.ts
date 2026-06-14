import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type CatalogDb,
  catalogPath,
  initializeCatalog,
  listCatalogSessions,
  markGistShared,
  markMissingSources,
  markTrailGenerated,
  upsertDiscoveredSessions,
  upsertTrailObject,
} from "../src/index.ts";

class BunCatalogDb implements CatalogDb {
  constructor(private readonly db: Database) {}

  exec(sql: string, params: readonly (string | number | null | Uint8Array)[] = []): void {
    if (params.length === 0) {
      this.db.exec(sql);
      return;
    }
    this.db.query(sql).run(...params);
  }

  get<T>(
    sql: string,
    params: readonly (string | number | null | Uint8Array)[] = [],
  ): T | undefined {
    return this.db.query(sql).get(...params) as T | undefined;
  }

  all<T>(sql: string, params: readonly (string | number | null | Uint8Array)[] = []): T[] {
    return this.db.query(sql).all(...params) as T[];
  }
}

let root: string;
let rawDb: Database;
let db: CatalogDb;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "trail-catalog-"));
  rawDb = new Database(":memory:");
  db = new BunCatalogDb(rawDb);
});

afterEach(() => {
  rawDb.close();
  rmSync(root, { recursive: true, force: true });
});

test("catalogPath resolves under the store root", () => {
  expect(catalogPath(root)).toBe(join(root, "catalog.sqlite"));
});

test("initializeCatalog creates schema and sets user_version", async () => {
  await initializeCatalog(db);

  expect(db.get<{ user_version: number }>("PRAGMA user_version")).toEqual({ user_version: 1 });
});

test("upsertDiscoveredSessions lists nullable names newest first", async () => {
  await initializeCatalog(db);
  await upsertDiscoveredSessions(
    db,
    [
      {
        agent_name: "codex",
        source_id: "older",
        name: "Older",
        path: "/sessions/older.jsonl",
        session_date: "2026-05-17T14:00:00.000Z",
      },
      {
        agent_name: "claude-code",
        source_id: "newer",
        path: "claude-db://session/newer",
        session_date: "2026-05-18T14:00:00.000Z",
      },
    ],
    { now: "2026-05-19T14:00:00.000Z" },
  );

  expect(await listCatalogSessions(db)).toEqual([
    {
      source_id: "newer",
      name: null,
      path: "claude-db://session/newer",
      agent_name: "claude-code",
      has_generated_trail: false,
      trail_path: null,
      gist_id: null,
      session_date: "2026-05-18T14:00:00.000Z",
      trail_generated_at: null,
      gist_shared_at: null,
    },
    {
      source_id: "older",
      name: "Older",
      path: "/sessions/older.jsonl",
      agent_name: "codex",
      has_generated_trail: false,
      trail_path: null,
      gist_id: null,
      session_date: "2026-05-17T14:00:00.000Z",
      trail_generated_at: null,
      gist_shared_at: null,
    },
  ]);
});

test("missing source sync marks old rows without deleting generated state", async () => {
  await initializeCatalog(db);
  await upsertDiscoveredSessions(db, [
    {
      agent_name: "codex",
      source_id: "kept",
      path: "/sessions/kept.jsonl",
      session_date: "2026-05-18T14:00:00.000Z",
    },
    {
      agent_name: "codex",
      source_id: "missing",
      path: "/sessions/missing.jsonl",
      session_date: "2026-05-17T14:00:00.000Z",
    },
  ]);
  await upsertTrailObject(db, {
    content_hash: "a".repeat(64),
    kind: "session",
    object_path: "/store/objects/a.trail.jsonl",
    source_path: "/sessions/missing.jsonl",
    session_uid: "session-uid",
    registered_at: "2026-05-19T14:00:00.000Z",
  });
  await markTrailGenerated(db, {
    agent_name: "codex",
    source_id: "missing",
    content_hash: "a".repeat(64),
    trail_generated_at: "2026-05-19T14:01:00.000Z",
  });

  await markMissingSources(db, [{ agent_name: "codex", source_id: "kept" }], {
    agent_name: "codex",
  });

  expect(await listCatalogSessions(db)).toHaveLength(1);
  expect(await listCatalogSessions(db, { include_missing: true })).toContainEqual(
    expect.objectContaining({
      source_id: "missing",
      has_generated_trail: true,
      trail_path: "/store/objects/a.trail.jsonl",
    }),
  );
});

test("trail generation derives trail state and replacing it clears stale gist fields", async () => {
  await initializeCatalog(db);
  await upsertDiscoveredSessions(db, [
    {
      agent_name: "codex",
      source_id: "source",
      path: "/sessions/source.jsonl",
      session_date: "2026-05-17T14:00:00.000Z",
    },
  ]);
  await upsertTrailObject(db, {
    content_hash: "a".repeat(64),
    kind: "session",
    object_path: "/store/objects/a.trail.jsonl",
    source_path: "/sessions/source.jsonl",
    session_uid: "uid-a",
    registered_at: "2026-05-17T14:01:00.000Z",
  });
  await upsertTrailObject(db, {
    content_hash: "b".repeat(64),
    kind: "session",
    object_path: "/store/objects/b.trail.jsonl",
    source_path: "/sessions/source.jsonl",
    session_uid: "uid-b",
    registered_at: "2026-05-17T14:02:00.000Z",
  });
  await markTrailGenerated(db, {
    agent_name: "codex",
    source_id: "source",
    content_hash: "a".repeat(64),
    trail_generated_at: "2026-05-17T14:03:00.000Z",
  });
  await markGistShared(db, {
    agent_name: "codex",
    source_id: "source",
    gist_id: "gist-a",
    gist_shared_at: "2026-05-17T14:04:00.000Z",
  });

  expect(await listCatalogSessions(db)).toEqual([
    expect.objectContaining({
      has_generated_trail: true,
      trail_path: "/store/objects/a.trail.jsonl",
      gist_id: "gist-a",
      gist_shared_at: "2026-05-17T14:04:00.000Z",
    }),
  ]);

  await markTrailGenerated(db, {
    agent_name: "codex",
    source_id: "source",
    content_hash: "b".repeat(64),
    trail_generated_at: "2026-05-17T14:05:00.000Z",
  });

  expect(await listCatalogSessions(db)).toEqual([
    expect.objectContaining({
      trail_path: "/store/objects/b.trail.jsonl",
      trail_generated_at: "2026-05-17T14:05:00.000Z",
      gist_id: null,
      gist_shared_at: null,
    }),
  ]);
});

test("initializeCatalog surfaces driver errors", async () => {
  const failing: CatalogDb = {
    exec() {
      throw new Error("database disk image is malformed");
    },
    get() {
      return undefined;
    },
    all() {
      return [];
    },
  };

  await expect(initializeCatalog(failing)).rejects.toThrow("database disk image is malformed");
});
