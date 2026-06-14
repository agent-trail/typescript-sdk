import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type CatalogDb,
  CatalogNotFoundError,
  catalogPath,
  findTrailObjectsBySessionUid,
  initializeCatalog,
  listCatalogSessions,
  markGistShared,
  markMissingSources,
  markTrailGenerated,
  upsertDiscoveredSessions,
  upsertTrailObject,
} from "../src/index.ts";
import { BunCatalogDb } from "./helpers.ts";

let root: string;
let rawDb: Database;
let db: CatalogDb;

function catalogTest(name: string, run: () => void | Promise<void>): void {
  test.serial(name, async () => {
    root = mkdtempSync(join(tmpdir(), "trail-catalog-"));
    rawDb = new Database(":memory:");
    db = new BunCatalogDb(rawDb);
    try {
      await run();
    } finally {
      rawDb.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
}

catalogTest("catalogPath resolves under the store root", () => {
  expect(catalogPath(root)).toBe(join(root, "catalog.sqlite"));
});

catalogTest("initializeCatalog creates schema and sets user_version", async () => {
  await initializeCatalog(db);

  expect(db.get<{ user_version: number }>("PRAGMA user_version")).toEqual({ user_version: 1 });
});

catalogTest("initializeCatalog persists schema in the catalog path", async () => {
  const path = catalogPath(root);
  const fileDb = new Database(path);
  try {
    await initializeCatalog(new BunCatalogDb(fileDb));
  } finally {
    fileDb.close();
  }

  const reopened = new Database(path);
  try {
    expect(new BunCatalogDb(reopened).get<{ user_version: number }>("PRAGMA user_version")).toEqual(
      { user_version: 1 },
    );
  } finally {
    reopened.close();
  }
});

catalogTest("initializeCatalog rejects newer catalog schema versions", async () => {
  db.exec("PRAGMA user_version = 99");

  await expect(initializeCatalog(db)).rejects.toThrow("newer than supported version 1");
});

catalogTest("upsertDiscoveredSessions lists nullable names newest first", async () => {
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

catalogTest("upsertDiscoveredSessions updates existing rows and clears missing state", async () => {
  await initializeCatalog(db);
  await upsertDiscoveredSessions(db, [
    {
      agent_name: "codex",
      source_id: "source",
      name: "Old",
      path: "/old.jsonl",
      session_date: "2026-05-17T14:00:00.000Z",
    },
  ]);
  await markMissingSources(db, []);

  await upsertDiscoveredSessions(db, [
    {
      agent_name: "codex",
      source_id: "source",
      name: null,
      path: "/new.jsonl",
      session_date: "2026-05-18T14:00:00.000Z",
    },
  ]);

  expect(await listCatalogSessions(db)).toEqual([
    expect.objectContaining({
      source_id: "source",
      name: null,
      path: "/new.jsonl",
      session_date: "2026-05-18T14:00:00.000Z",
    }),
  ]);
});

catalogTest("missing source sync marks old rows without deleting generated state", async () => {
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

catalogTest("markMissingSources respects agent scope", async () => {
  await initializeCatalog(db);
  await upsertDiscoveredSessions(db, [
    {
      agent_name: "codex",
      source_id: "codex-source",
      path: "/codex.jsonl",
      session_date: "2026-05-18T14:00:00.000Z",
    },
    {
      agent_name: "claude-code",
      source_id: "claude-source",
      path: "claude-db://source",
      session_date: "2026-05-17T14:00:00.000Z",
    },
  ]);

  await markMissingSources(db, [], { agent_name: "codex" });

  expect(await listCatalogSessions(db)).toEqual([
    expect.objectContaining({ agent_name: "claude-code", source_id: "claude-source" }),
  ]);
  expect(await listCatalogSessions(db, { include_missing: true })).toHaveLength(2);
});

catalogTest("listCatalogSessions filters by agent and limit", async () => {
  await initializeCatalog(db);
  await upsertDiscoveredSessions(db, [
    {
      agent_name: "codex",
      source_id: "older",
      path: "/older.jsonl",
      session_date: "2026-05-17T14:00:00.000Z",
    },
    {
      agent_name: "codex",
      source_id: "newer",
      path: "/newer.jsonl",
      session_date: "2026-05-18T14:00:00.000Z",
    },
    {
      agent_name: "claude-code",
      source_id: "other",
      path: "claude-db://other",
      session_date: "2026-05-19T14:00:00.000Z",
    },
  ]);

  expect(await listCatalogSessions(db, { agent_name: "codex", limit: 1 })).toEqual([
    expect.objectContaining({ agent_name: "codex", source_id: "newer" }),
  ]);
});

catalogTest(
  "trail generation derives trail state and replacing it clears stale gist fields",
  async () => {
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
  },
);

catalogTest("markTrailGenerated rejects unknown source sessions and objects", async () => {
  await initializeCatalog(db);

  await expect(
    markTrailGenerated(db, {
      agent_name: "codex",
      source_id: "missing",
      content_hash: "a".repeat(64),
    }),
  ).rejects.toThrow(CatalogNotFoundError);

  await upsertDiscoveredSessions(db, [
    {
      agent_name: "codex",
      source_id: "source",
      path: "/source.jsonl",
      session_date: "2026-05-17T14:00:00.000Z",
    },
  ]);

  await expect(
    markTrailGenerated(db, {
      agent_name: "codex",
      source_id: "source",
      content_hash: "b".repeat(64),
    }),
  ).rejects.toThrow("unknown trail object");
});

catalogTest("markGistShared rejects sources without generated trails", async () => {
  await initializeCatalog(db);
  await upsertDiscoveredSessions(db, [
    {
      agent_name: "codex",
      source_id: "source",
      path: "/source.jsonl",
      session_date: "2026-05-17T14:00:00.000Z",
    },
  ]);

  await expect(
    markGistShared(db, {
      agent_name: "codex",
      source_id: "source",
      gist_id: "gist-id",
    }),
  ).rejects.toThrow("has no generated trail");
});

catalogTest(
  "upsertTrailObject updates rows and findTrailObjectsBySessionUid orders by registration",
  async () => {
    await initializeCatalog(db);
    await upsertTrailObject(db, {
      content_hash: "b".repeat(64),
      kind: "session",
      object_path: "/objects/b.trail.jsonl",
      source_path: null,
      session_uid: "uid",
      registered_at: "2026-05-17T14:02:00.000Z",
    });
    await upsertTrailObject(db, {
      content_hash: "a".repeat(64),
      kind: "session",
      object_path: "/objects/a.trail.jsonl",
      source_path: null,
      session_uid: "uid",
      registered_at: "2026-05-17T14:01:00.000Z",
    });
    await upsertTrailObject(db, {
      content_hash: "a".repeat(64),
      kind: "trail",
      object_path: "/objects/a-new.trail.jsonl",
      source_path: "/source.jsonl",
      session_uid: "uid",
      registered_at: "2026-05-17T14:03:00.000Z",
    });

    expect(await findTrailObjectsBySessionUid(db, "uid")).toEqual([
      expect.objectContaining({ content_hash: "b".repeat(64), kind: "session" }),
      expect.objectContaining({
        content_hash: "a".repeat(64),
        kind: "trail",
        object_path: "/objects/a-new.trail.jsonl",
      }),
    ]);
  },
);

catalogTest("initializeCatalog surfaces driver errors", async () => {
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
