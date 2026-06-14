import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import {
  type CatalogDb,
  findTrailObjectsBySessionUid,
  initializeCatalog,
} from "@agent-trail/catalog";
import { parseTrailJsonl, serializeTrailJsonl, stampContentHashes } from "@agent-trail/core";
import { BunCatalogDb } from "../../catalog/test/helpers.ts";
import { objectPath, rebuildObjectCatalog, registerTrail } from "../src/index.ts";

const fixtures = new URL("../../schema/fixtures/validation/", import.meta.url);
const fixturePath = (path: string): string => fileURLToPath(new URL(path, fixtures));
const finalizedFixture = fixturePath("valid/minimal-with-content-hash.trail.jsonl");
const finalizedHash = "8dbf946e5d4ccd2a4ff2681d2c2fe2614f0769bdfeafe5e4f242db14872db5f7";

let storeRoot: string;
let rawDb: Database;
let catalogDb: CatalogDb;

function storeTest(name: string, run: () => Promise<void>): void {
  test.serial(name, async () => {
    storeRoot = mkdtempSync(join(tmpdir(), "trail-store-"));
    rawDb = new Database(":memory:");
    catalogDb = new BunCatalogDb(rawDb);
    try {
      await run();
    } finally {
      rawDb.close();
      rmSync(storeRoot, { recursive: true, force: true });
    }
  });
}

function jsonl(records: unknown[]): string {
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

async function stampedJsonl(records: unknown[]): Promise<string> {
  return stampContentHashes(await parseTrailJsonl(jsonl(records))).jsonl;
}

storeTest("registerTrail writes canonical object bytes and a catalog object row", async () => {
  const result = await registerTrail(finalizedFixture, { storeRoot, catalogDb });

  expect(result).toMatchObject({
    status: "finalized",
    contentHash: finalizedHash,
    objectPath: objectPath(storeRoot, finalizedHash),
    diagnostics: [],
  });
  const stored = await readFile(result.objectPath as string, "utf8");
  const expected = serializeTrailJsonl(
    await parseTrailJsonl(await readFile(finalizedFixture, "utf8")),
  );
  expect(stored).toBe(expected);

  const objects = await findTrailObjectsBySessionUid(catalogDb, "01HZZZZZZZZZZZZZZZZZZZZZ01");
  expect(objects[0]).toMatchObject({
    content_hash: finalizedHash,
    object_path: objectPath(storeRoot, finalizedHash),
    source_path: finalizedFixture,
    session_uid: "01HZZZZZZZZZZZZZZZZZZZZZ01",
    kind: "session",
  });
});

storeTest("registerTrail is idempotent for duplicate finalized files", async () => {
  const first = await registerTrail(finalizedFixture, { storeRoot, catalogDb });
  const second = await registerTrail(finalizedFixture, { storeRoot, catalogDb });

  expect(first.status).toBe("finalized");
  expect(second).toMatchObject({
    status: "already_present",
    contentHash: finalizedHash,
    objectPath: objectPath(storeRoot, finalizedHash),
    diagnostics: [],
  });
  expect(await readFile(objectPath(storeRoot, finalizedHash), "utf8")).toBe(
    serializeTrailJsonl(await parseTrailJsonl(await readFile(finalizedFixture, "utf8"))),
  );
});

storeTest("registerTrail records custom and null source paths in the catalog", async () => {
  await registerTrail(finalizedFixture, {
    storeRoot,
    catalogDb,
    sourcePath: "codex://session/source",
  });

  expect(
    (await findTrailObjectsBySessionUid(catalogDb, "01HZZZZZZZZZZZZZZZZZZZZZ01"))[0],
  ).toMatchObject({ source_path: "codex://session/source" });

  await registerTrail(finalizedFixture, { storeRoot, catalogDb, sourcePath: null });

  expect(
    (await findTrailObjectsBySessionUid(catalogDb, "01HZZZZZZZZZZZZZZZZZZZZZ01"))[0],
  ).toMatchObject({ source_path: null });
});

storeTest("registerTrail accepts gzipped trail files", async () => {
  const input = join(storeRoot, "input.trail.jsonl.gz");
  await writeFile(input, gzipSync(await readFile(finalizedFixture)));

  const result = await registerTrail(input, { storeRoot });

  expect(result.status).toBe("finalized");
  expect(result.contentHash).toBe(finalizedHash);
});

storeTest("registerTrail indexes gzipped trail files when a catalog is provided", async () => {
  const input = join(storeRoot, "input.trail.jsonl.gz");
  await writeFile(input, gzipSync(await readFile(finalizedFixture)));

  await registerTrail(input, { storeRoot, catalogDb });

  expect(
    (await findTrailObjectsBySessionUid(catalogDb, "01HZZZZZZZZZZZZZZZZZZZZZ01"))[0],
  ).toMatchObject({
    content_hash: finalizedHash,
    source_path: input,
  });
});

storeTest("registerTrail surfaces catalog write failures", async () => {
  const failingCatalog: CatalogDb = {
    exec(sql) {
      if (sql.includes("INSERT INTO trail_objects")) throw new Error("catalog write failed");
    },
    get<T>() {
      return { user_version: 1 } as T;
    },
    all() {
      return [];
    },
  };

  await expect(
    registerTrail(finalizedFixture, { storeRoot, catalogDb: failingCatalog }),
  ).rejects.toThrow("catalog write failed");
});

storeTest(
  "registerTrail keeps session-hash object bytes independent of sibling sessions",
  async () => {
    const commonSession = {
      type: "session",
      schema_version: "0.1.0",
      id: "00000000-0000-4000-8000-000000000001",
      session_uid: "00000000-0000-4000-8000-000000000101",
      ts: "2026-05-17T14:00:00.000Z",
      agent: { name: "codex-cli" },
    };
    const commonEvent = {
      type: "user_message",
      id: "00000000-0000-4000-8000-000000000201",
      ts: "2026-05-17T14:00:01.000Z",
      payload: { text: "same" },
    };
    const first = await stampedJsonl([
      {
        type: "trail",
        schema_version: "0.1.0",
        id: "00000000-0000-4000-8000-000000000301",
        ts: "2026-05-17T14:00:00.000Z",
        producer: "agent-trail-test",
      },
      commonSession,
      commonEvent,
      {
        type: "session",
        schema_version: "0.1.0",
        id: "00000000-0000-4000-8000-000000000002",
        session_uid: "00000000-0000-4000-8000-000000000102",
        ts: "2026-05-17T14:02:00.000Z",
        agent: { name: "codex-cli" },
      },
    ]);
    const second = await stampedJsonl([
      {
        type: "trail",
        schema_version: "0.1.0",
        id: "00000000-0000-4000-8000-000000000302",
        ts: "2026-05-17T14:00:00.000Z",
        producer: "agent-trail-test",
      },
      commonSession,
      commonEvent,
      {
        type: "session",
        schema_version: "0.1.0",
        id: "00000000-0000-4000-8000-000000000003",
        session_uid: "00000000-0000-4000-8000-000000000103",
        ts: "2026-05-17T14:03:00.000Z",
        agent: { name: "claude-code" },
      },
    ]);
    const firstPath = join(storeRoot, "first.trail.jsonl");
    const secondPath = join(storeRoot, "second.trail.jsonl");
    await writeFile(firstPath, first, "utf8");
    await writeFile(secondPath, second, "utf8");

    await registerTrail(firstPath, { storeRoot, catalogDb });
    const commonHash = (await findTrailObjectsBySessionUid(catalogDb, commonSession.session_uid))[0]
      ?.content_hash as string;
    const before = await readFile(objectPath(storeRoot, commonHash), "utf8");
    await registerTrail(secondPath, { storeRoot, catalogDb });

    expect(await readFile(objectPath(storeRoot, commonHash), "utf8")).toBe(before);
    expect(before).toContain("same");
    expect(before).not.toContain("claude-code");
  },
);

storeTest("registerTrail rejects gzipped trails over the decompressed size cap", async () => {
  const input = join(storeRoot, "oversized.trail.jsonl.gz");
  await writeFile(input, gzipSync("x".repeat(8_000_001)));

  const result = await registerTrail(input, { storeRoot });

  expect(result.status).toBe("invalid");
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({ code: "gzip_decode_failed" }),
  );
});

storeTest("registerTrail rejects pending and invalid trails without writing objects", async () => {
  const pending = await registerTrail(fixturePath("valid/streaming-open.trail.jsonl"), {
    storeRoot,
    catalogDb,
  });
  expect(pending.status).toBe("skipped_pending");

  const invalid = await registerTrail(
    fixturePath("hash-mismatch/content-hash-mismatch.trail.jsonl"),
    {
      storeRoot,
      catalogDb,
    },
  );
  expect(invalid.status).toBe("invalid");
  expect(
    invalid.diagnostics.some((diagnostic) => diagnostic.code === "content_hash_mismatch"),
  ).toBe(true);
  await initializeCatalog(catalogDb);
  expect(await findTrailObjectsBySessionUid(catalogDb, "01HZZZZZZZZZZZZZZZZZZZZZ01")).toEqual([]);
});

storeTest("rebuildObjectCatalog regenerates object rows from stored objects", async () => {
  await registerTrail(finalizedFixture, { storeRoot });

  const result = await rebuildObjectCatalog({ storeRoot, catalogDb });

  expect(result.entries).toBe(1);
  expect(
    (await findTrailObjectsBySessionUid(catalogDb, "01HZZZZZZZZZZZZZZZZZZZZZ01"))[0],
  ).toMatchObject({
    content_hash: finalizedHash,
    source_path: null,
    kind: "session",
  });
});

storeTest("rebuildObjectCatalog skips corrupt objects and stray files", async () => {
  await registerTrail(finalizedFixture, { storeRoot });
  const corruptPath = objectPath(storeRoot, "c".repeat(64));
  await mkdir(dirname(corruptPath), { recursive: true });
  await writeFile(corruptPath, "{bad\n", "utf8");
  await writeFile(join(dirname(corruptPath), "not-a-hash.trail.jsonl"), "ignored\n", "utf8");

  const result = await rebuildObjectCatalog({ storeRoot, catalogDb });

  expect(result.entries).toBe(1);
  expect(await findTrailObjectsBySessionUid(catalogDb, "01HZZZZZZZZZZZZZZZZZZZZZ01")).toHaveLength(
    1,
  );
  expect(await findTrailObjectsBySessionUid(catalogDb, "missing")).toEqual([]);
});

storeTest("rebuildObjectCatalog preserves rows for multi-session objects", async () => {
  const firstSessionUid = "00000000-0000-4000-8000-000000000111";
  const secondSessionUid = "00000000-0000-4000-8000-000000000222";
  const text = await stampedJsonl([
    {
      type: "trail",
      schema_version: "0.1.0",
      id: "00000000-0000-4000-8000-000000000010",
      ts: "2026-05-17T14:00:00.000Z",
      producer: "agent-trail-test",
    },
    {
      type: "session",
      schema_version: "0.1.0",
      id: "00000000-0000-4000-8000-000000000011",
      session_uid: firstSessionUid,
      ts: "2026-05-17T14:01:00.000Z",
      agent: { name: "codex-cli" },
    },
    {
      type: "user_message",
      id: "00000000-0000-4000-8000-000000000012",
      ts: "2026-05-17T14:01:01.000Z",
      payload: { text: "one" },
    },
    {
      type: "session",
      schema_version: "0.1.0",
      id: "00000000-0000-4000-8000-000000000013",
      session_uid: secondSessionUid,
      ts: "2026-05-17T14:02:00.000Z",
      agent: { name: "codex-cli" },
    },
    {
      type: "user_message",
      id: "00000000-0000-4000-8000-000000000014",
      ts: "2026-05-17T14:02:01.000Z",
      payload: { text: "two" },
    },
  ]);
  const input = join(storeRoot, "multi.trail.jsonl");
  await writeFile(input, text, "utf8");
  await registerTrail(input, { storeRoot });

  const result = await rebuildObjectCatalog({ storeRoot, catalogDb });

  expect(result.entries).toBe(3);
  expect(await findTrailObjectsBySessionUid(catalogDb, firstSessionUid)).toEqual([
    expect.objectContaining({ kind: "session" }),
  ]);
  expect(await findTrailObjectsBySessionUid(catalogDb, secondSessionUid)).toEqual([
    expect.objectContaining({ kind: "session" }),
  ]);
});
