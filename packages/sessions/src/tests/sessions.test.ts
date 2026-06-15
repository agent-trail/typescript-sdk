import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionRef, TrailAdapter, TrailFile } from "@agent-trail/adapters";
import type { CatalogDb } from "@agent-trail/catalog";
import { listCatalogEntries } from "@agent-trail/catalog";
import { BunCatalogDb } from "../../../catalog/src/tests/helpers.ts";
import { objectPath } from "../../../store/src/index.ts";
import {
  createSessionsClient,
  discoverSessions,
  exportSession,
  listSessions,
  loadSession,
  type SessionsShareTransport,
  shareSession,
} from "../index.ts";

const SESSION_ID = "session-a";
const SESSION_UID = "11111111-1111-4111-8111-111111111111";
const SESSION_TS = "2026-05-17T14:00:00.000Z";
const SESSION_PATH = "/tmp/source/session-a.jsonl";

type Harness = {
  catalogDb: CatalogDb;
  rawDb: Database;
  storeRoot: string;
  adapter: TrailAdapter;
};

function sessionsTest(name: string, run: (harness: Harness) => Promise<void>): void {
  test.serial(name, async () => {
    const storeRoot = mkdtempSync(join(tmpdir(), "agent-trail-sessions-"));
    const rawDb = new Database(":memory:");
    const catalogDb = new BunCatalogDb(rawDb);
    const adapter = fakeAdapter([sourceRef()]);
    try {
      await run({ catalogDb, rawDb, storeRoot, adapter });
    } finally {
      rawDb.close();
      rmSync(storeRoot, { recursive: true, force: true });
    }
  });
}

sessionsTest("discover persists source sessions and marks missing prior rows", async (harness) => {
  const first = await discoverSessions({
    catalogDb: harness.catalogDb,
    adapters: [harness.adapter],
  });

  expect(first.sessions.map((session) => session.sourceId)).toEqual([SESSION_ID]);
  expect(await listSessions({ catalogDb: harness.catalogDb })).toMatchObject({
    rows: [
      {
        source_id: SESSION_ID,
        agent_name: "test-agent",
        path: SESSION_PATH,
      },
    ],
  });

  await discoverSessions({
    catalogDb: harness.catalogDb,
    adapters: [fakeAdapter([])],
  });

  expect(await listCatalogEntries(harness.catalogDb)).toEqual([]);
  expect(await listCatalogEntries(harness.catalogDb, { include_missing: true })).toHaveLength(1);
});

sessionsTest("list can refresh discovery before returning rows", async (harness) => {
  const result = await listSessions({
    catalogDb: harness.catalogDb,
    adapters: [harness.adapter],
    refresh: true,
  });

  expect(result.rows.map((row) => row.source_id)).toEqual([SESSION_ID]);
});

sessionsTest("load parses, reconciles, stores, and links generated trail", async (harness) => {
  await discoverSessions({
    catalogDb: harness.catalogDb,
    adapters: [harness.adapter],
  });

  const result = await loadSession({
    catalogDb: harness.catalogDb,
    storeRoot: harness.storeRoot,
    adapters: [harness.adapter],
    adapter: "test-agent",
    sourceId: SESSION_ID,
  });

  expect(result.status).toBe("loaded");
  if (result.status !== "loaded") return;
  expect(result.contentHash).toMatch(/^[0-9a-f]{64}$/);
  expect(result.objectPath).toBe(objectPath(harness.storeRoot, result.contentHash));
  await expect(readFile(result.objectPath, "utf8")).resolves.toContain('"content_hash"');

  const rows = await listSessions({ catalogDb: harness.catalogDb });
  expect(rows.rows[0]).toMatchObject({
    state: "source+registered",
    source_id: SESSION_ID,
    content_hash: result.contentHash,
    agent_name: "test-agent",
    name: "Test Session",
  });
});

sessionsTest("load links envelope trails to the session object", async (harness) => {
  const adapter = fakeAdapter([sourceRef()], trailFileWithEnvelope);
  await discoverSessions({
    catalogDb: harness.catalogDb,
    adapters: [adapter],
  });

  const result = await loadSession({
    catalogDb: harness.catalogDb,
    storeRoot: harness.storeRoot,
    adapters: [adapter],
    adapter: "test-agent",
    sourceId: SESSION_ID,
  });

  expect(result.status).toBe("loaded");
  if (result.status !== "loaded") return;
  expect(await readFile(result.objectPath, "utf8")).not.toContain('"type":"trail"');
  expect((await listSessions({ catalogDb: harness.catalogDb })).rows).toEqual([
    expect.objectContaining({
      state: "source+registered",
      source_id: SESSION_ID,
      content_hash: result.contentHash,
    }),
  ]);
});

sessionsTest("share redacts stored trail and records gist id", async (harness) => {
  const client = createSessionsClient({
    catalogDb: harness.catalogDb,
    storeRoot: harness.storeRoot,
    adapters: [harness.adapter],
  });
  await client.discover();
  await client.load({ adapter: "test-agent", sourceId: SESSION_ID });

  const transport: SessionsShareTransport = {
    async share(input) {
      expect(input.jsonl).not.toContain("sk-live-secret-1234567890");
      expect(input.jsonl).toContain("[OPENAI_KEY]");
      return { gistId: "gist-123", url: "https://gist.example/gist-123" };
    },
  };

  const result = await shareSession({
    catalogDb: harness.catalogDb,
    storeRoot: harness.storeRoot,
    transport,
    adapter: "test-agent",
    sourceId: SESSION_ID,
  });

  expect(result).toMatchObject({
    status: "shared",
    gistId: "gist-123",
    url: "https://gist.example/gist-123",
  });
  const [row] = (await listSessions({ catalogDb: harness.catalogDb })).rows;
  expect(row?.gist_id).toBe("gist-123");
});

sessionsTest("export returns raw finalized stored bytes", async (harness) => {
  const client = createSessionsClient({
    catalogDb: harness.catalogDb,
    storeRoot: harness.storeRoot,
    adapters: [harness.adapter],
  });
  await client.discover();
  await client.load({ adapter: "test-agent", sourceId: SESSION_ID });

  const result = await exportSession({
    catalogDb: harness.catalogDb,
    storeRoot: harness.storeRoot,
    adapter: "test-agent",
    sourceId: SESSION_ID,
  });

  expect(result.status).toBe("exported");
  if (result.status !== "exported") return;
  expect(result.jsonl).toContain("sk-live-secret-1234567890");
  expect(result.contentHash).toMatch(/^[0-9a-f]{64}$/);
});

sessionsTest("export ignores mutable catalog object paths", async (harness) => {
  const client = createSessionsClient({
    catalogDb: harness.catalogDb,
    storeRoot: harness.storeRoot,
    adapters: [harness.adapter],
  });
  await client.discover();
  const loaded = await client.load({ adapter: "test-agent", sourceId: SESSION_ID });
  if (loaded.status !== "loaded") throw new Error("load failed");
  const tamperedPath = join(harness.storeRoot, "tampered.trail.jsonl");
  await writeFile(tamperedPath, "tampered", "utf8");
  await harness.catalogDb.exec("UPDATE trail_objects SET object_path = ? WHERE content_hash = ?", [
    tamperedPath,
    loaded.contentHash,
  ]);

  const result = await exportSession({
    catalogDb: harness.catalogDb,
    storeRoot: harness.storeRoot,
    adapter: "test-agent",
    sourceId: SESSION_ID,
  });

  expect(result.status).toBe("exported");
  if (result.status !== "exported") return;
  expect(result.jsonl).not.toBe("tampered");
  expect(result.jsonl).toContain("sk-live-secret-1234567890");
});

sessionsTest("export can write raw finalized bytes to a target path", async (harness) => {
  const client = createSessionsClient({
    catalogDb: harness.catalogDb,
    storeRoot: harness.storeRoot,
    adapters: [harness.adapter],
  });
  await client.discover();
  await client.load({ adapter: "test-agent", sourceId: SESSION_ID });

  const toPath = join(harness.storeRoot, "exports", "session.trail.jsonl");
  const result = await client.export({
    adapter: "test-agent",
    sourceId: SESSION_ID,
    toPath,
  });

  expect(result).toMatchObject({ status: "exported", path: toPath });
  await expect(readFile(toPath, "utf8")).resolves.toContain("sk-live-secret-1234567890");
});

sessionsTest("share and export return typed missing-state statuses", async (harness) => {
  expect(
    await loadSession({
      catalogDb: harness.catalogDb,
      adapters: [],
      adapter: "missing-agent",
      sourceId: SESSION_ID,
    }),
  ).toMatchObject({ status: "adapter_not_found" });

  expect(
    await shareSession({
      catalogDb: harness.catalogDb,
      adapter: "test-agent",
      sourceId: SESSION_ID,
    }),
  ).toMatchObject({ status: "transport_missing" });

  await discoverSessions({
    catalogDb: harness.catalogDb,
    adapters: [harness.adapter],
  });

  expect(
    await exportSession({
      catalogDb: harness.catalogDb,
      storeRoot: harness.storeRoot,
      adapter: "test-agent",
      sourceId: SESSION_ID,
    }),
  ).toMatchObject({ status: "no_generated_trail" });

  expect(
    await exportSession({
      catalogDb: harness.catalogDb,
      storeRoot: harness.storeRoot,
      adapter: "test-agent",
      sourceId: "missing-session",
    }),
  ).toMatchObject({ status: "source_not_found" });
});

function sourceRef(): SessionRef {
  return {
    id: SESSION_ID,
    adapter: "test-agent",
    path: SESSION_PATH,
    cwd: "/workspace/project",
    modifiedAt: SESSION_TS,
  };
}

function fakeAdapter(
  sessions: SessionRef[],
  trailFactory: () => TrailFile = trailFile,
): TrailAdapter {
  return {
    name: "test-agent",
    async detectSessions() {
      return sessions;
    },
    async parseSession(ref) {
      if (ref.path === undefined) throw new Error("missing path");
      return trailFactory();
    },
    async isAvailable() {
      return true;
    },
    async sourceVersion() {
      return "1.0.0";
    },
    async sourceHealth() {
      return {
        adapter: "test-agent",
        path: "/tmp/source",
        present: true,
        readable: true,
        sessionCount: sessions.length,
        sourceVersion: "1.0.0",
        warnings: [],
      };
    },
  };
}

function trailFile(): TrailFile {
  return {
    groups: [
      {
        header: {
          type: "session",
          schema_version: "0.1.0",
          id: "22222222-2222-4222-8222-222222222222",
          session_uid: SESSION_UID,
          ts: SESSION_TS,
          agent: { name: "codex", version: "1.0.0" },
          cwd: "/workspace/project",
          name: "Test Session",
        },
        entries: [
          {
            type: "user_message",
            id: "33333333-3333-4333-8333-333333333333",
            ts: "2026-05-17T14:00:01.000Z",
            payload: { text: "token sk-live-secret-1234567890" },
          },
          {
            type: "agent_message",
            id: "44444444-4444-4444-8444-444444444444",
            ts: "2026-05-17T14:00:02.000Z",
            payload: { text: "done" },
          },
        ],
      },
    ],
  };
}

function trailFileWithEnvelope(): TrailFile {
  return {
    envelope: {
      type: "trail",
      schema_version: "0.1.0",
      id: "55555555-5555-4555-8555-555555555555",
      ts: SESSION_TS,
      producer: "agent-trail-test",
    },
    ...trailFile(),
  };
}
