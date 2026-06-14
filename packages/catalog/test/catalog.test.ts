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
  listCatalogEntries,
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

async function upsertSessionObject(contentHash: string, sourcePath: string): Promise<void> {
  await upsertTrailObject(db, {
    content_hash: contentHash,
    kind: "session",
    object_path: `/store/objects/${contentHash[0]}.trail.jsonl`,
    source_path: sourcePath,
    session_uid: `uid-${contentHash[0]}`,
    registered_at: `2026-05-17T14:0${contentHash[0] === "a" ? "1" : "2"}:00.000Z`,
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

catalogTest("listCatalogEntries returns empty rows for an empty catalog", async () => {
  await initializeCatalog(db);

  expect(await listCatalogEntries(db)).toEqual([]);
});

catalogTest("listCatalogEntries lists source rows newest first", async () => {
  await initializeCatalog(db);
  await upsertDiscoveredSessions(
    db,
    [
      {
        agent_name: "codex",
        source_id: "older",
        name: "Older",
        path: "/sessions/older.jsonl",
        cwd: "/work/project",
        branch: "main",
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

  expect(await listCatalogEntries(db)).toEqual([
    {
      state: "source",
      source_id: "newer",
      content_hash: null,
      agent_name: "claude-code",
      name: null,
      path: "claude-db://session/newer",
      cwd: null,
      branch: null,
      session_date: "2026-05-18T14:00:00.000Z",
      latest_at: "2026-05-18T14:00:00.000Z",
      trail_path: null,
      registered_at: null,
      trail_generated_at: null,
      gist_id: null,
      gist_shared_at: null,
    },
    {
      state: "source",
      source_id: "older",
      content_hash: null,
      agent_name: "codex",
      name: "Older",
      path: "/sessions/older.jsonl",
      cwd: "/work/project",
      branch: "main",
      session_date: "2026-05-17T14:00:00.000Z",
      latest_at: "2026-05-17T14:00:00.000Z",
      trail_path: null,
      registered_at: null,
      trail_generated_at: null,
      gist_id: null,
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
      cwd: "/old",
      branch: "old",
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
      cwd: "/new",
      branch: null,
      session_date: "2026-05-18T14:00:00.000Z",
    },
  ]);

  expect(await listCatalogEntries(db)).toEqual([
    expect.objectContaining({
      state: "source",
      source_id: "source",
      name: null,
      path: "/new.jsonl",
      cwd: "/new",
      branch: null,
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

  expect(await listCatalogEntries(db)).toHaveLength(1);
  expect(await listCatalogEntries(db, { include_missing: true })).toContainEqual(
    expect.objectContaining({
      source_id: "missing",
      state: "source+registered",
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

  expect(await listCatalogEntries(db)).toEqual([
    expect.objectContaining({ agent_name: "claude-code", source_id: "claude-source" }),
  ]);
  expect(await listCatalogEntries(db, { include_missing: true })).toHaveLength(2);
});

catalogTest("listCatalogEntries filters by metadata and limit", async () => {
  await initializeCatalog(db);
  await upsertDiscoveredSessions(db, [
    {
      agent_name: "codex",
      source_id: "older",
      name: "Older Codex",
      path: "/older.jsonl",
      cwd: "/work/project",
      branch: "main",
      session_date: "2026-05-17T14:00:00.000Z",
    },
    {
      agent_name: "codex",
      source_id: "newer",
      name: "Newer Codex",
      path: "/newer.jsonl",
      cwd: "/work/project",
      branch: "feature",
      session_date: "2026-05-18T14:00:00.000Z",
    },
    {
      agent_name: "claude-code",
      source_id: "other",
      name: "Other Agent",
      path: "claude-db://other",
      cwd: "/work/other",
      branch: "feature",
      session_date: "2026-05-19T14:00:00.000Z",
    },
  ]);

  expect(
    await listCatalogEntries(db, { agent_name: "codex", branch: "feature", limit: 1 }),
  ).toEqual([expect.objectContaining({ agent_name: "codex", source_id: "newer" })]);
  expect(await listCatalogEntries(db, { cwd: "/work" })).toEqual([]);
  expect(await listCatalogEntries(db, { cwd: "/work/project" })).toHaveLength(2);
  expect(
    await listCatalogEntries(db, {
      date_from: "2026-05-18T14:00:00.000Z",
      date_to: "2026-05-19T14:00:00.000Z",
    }),
  ).toEqual([expect.objectContaining({ source_id: "newer" })]);
});

catalogTest("listCatalogEntries validates list options", async () => {
  await initializeCatalog(db);

  await expect(listCatalogEntries(db, { limit: 0 })).rejects.toThrow("limit");
  await expect(listCatalogEntries(db, { date_from: "bad-date" })).rejects.toThrow("date_from");
  await expect(listCatalogEntries(db, { date_to: "bad-date" })).rejects.toThrow("date_to");
});

catalogTest("listCatalogEntries query matches metadata only", async () => {
  await initializeCatalog(db);
  await upsertDiscoveredSessions(db, [
    {
      agent_name: "codex",
      source_id: "source",
      name: "Catalog Filters",
      path: "/sessions/source.jsonl",
      cwd: "/work/project",
      branch: "Feature/Catalog",
      session_date: "2026-05-18T14:00:00.000Z",
    },
  ]);
  await upsertTrailObject(db, {
    content_hash: "a".repeat(64),
    kind: "session",
    object_path: "/store/objects/a.trail.jsonl",
    source_path: "/objects/orphan.trail.jsonl",
    session_uid: "orphan",
    registered_at: "2026-05-19T14:00:00.000Z",
    agent_name: "claude-code",
    name: "Registered Import",
    cwd: "/work/import",
    branch: "main",
    session_date: "2026-05-17T14:00:00.000Z",
  });

  expect(await listCatalogEntries(db, { query: "catalog" })).toEqual([
    expect.objectContaining({ source_id: "source" }),
  ]);
  expect(await listCatalogEntries(db, { query: "Catalog", case_sensitive: true })).toHaveLength(1);
  expect(await listCatalogEntries(db, { query: "catalog", case_sensitive: true })).toHaveLength(0);
  expect(await listCatalogEntries(db, { query: "not-indexed-message-text" })).toEqual([]);
});

catalogTest(
  "trail generation derives source+registered state and replacing it clears stale gist fields",
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
    await upsertSessionObject("a".repeat(64), "/sessions/source.jsonl");
    await upsertSessionObject("b".repeat(64), "/sessions/source.jsonl");
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

    expect(await listCatalogEntries(db, { states: ["source+registered"] })).toEqual([
      expect.objectContaining({
        state: "source+registered",
        content_hash: "a".repeat(64),
        trail_path: "/store/objects/a.trail.jsonl",
        latest_at: "2026-05-17T14:03:00.000Z",
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

    expect(await listCatalogEntries(db, { states: ["source+registered"] })).toEqual([
      expect.objectContaining({
        content_hash: "b".repeat(64),
        trail_path: "/store/objects/b.trail.jsonl",
        trail_generated_at: "2026-05-17T14:05:00.000Z",
        gist_id: null,
        gist_shared_at: null,
      }),
    ]);
  },
);

catalogTest("listCatalogEntries does not collapse source rows by path without a link", async () => {
  await initializeCatalog(db);
  await upsertDiscoveredSessions(db, [
    {
      agent_name: "codex",
      source_id: "source",
      path: "/sessions/source.jsonl",
      session_date: "2026-05-17T14:00:00.000Z",
    },
  ]);
  await upsertSessionObject("a".repeat(64), "/sessions/source.jsonl");

  expect((await listCatalogEntries(db)).map((row) => row.state)).toEqual(["registered", "source"]);
});

catalogTest(
  "listCatalogEntries includes orphan session objects but not trail duplicates",
  async () => {
    await initializeCatalog(db);
    await upsertTrailObject(db, {
      content_hash: "a".repeat(64),
      kind: "session",
      object_path: "/store/objects/a.trail.jsonl",
      source_path: null,
      session_uid: "uid-a",
      registered_at: "2026-05-17T14:01:00.000Z",
      agent_name: "codex",
      name: "Orphan session",
      cwd: "/work/project",
      branch: "main",
      session_date: "2026-05-17T14:00:00.000Z",
    });
    await upsertTrailObject(db, {
      content_hash: "b".repeat(64),
      kind: "trail",
      object_path: "/store/objects/b.trail.jsonl",
      source_path: null,
      session_uid: null,
      registered_at: "2026-05-17T14:02:00.000Z",
      agent_name: "codex",
      name: "File-level trail",
    });

    expect(await listCatalogEntries(db)).toEqual([
      expect.objectContaining({
        state: "registered",
        source_id: null,
        content_hash: "a".repeat(64),
        agent_name: "codex",
        name: "Orphan session",
        trail_path: "/store/objects/a.trail.jsonl",
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

catalogTest("upsertTrailObject rejects invalid content hashes", async () => {
  await initializeCatalog(db);

  await expect(
    upsertTrailObject(db, {
      content_hash: "../escape",
      kind: "session",
      object_path: "/tmp/escape.trail.jsonl",
      source_path: null,
      session_uid: "session-uid",
      registered_at: "2026-05-17T14:00:00.000Z",
    }),
  ).rejects.toThrow("invalid trail object content_hash");
});

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
