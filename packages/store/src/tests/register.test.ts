import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { lstat, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import {
  type CatalogDb,
  findTrailObjectsBySessionUid,
  initializeCatalog,
  listCatalogEntries,
} from "@agent-trail/catalog";
import { parseTrailJsonl, serializeTrailJsonl, stampContentHashes } from "@agent-trail/core";
import { BunCatalogDb } from "../../../catalog/src/tests/helpers.ts";
import { indexExistingObjects, objectPath, registerTrail } from "../index.ts";

const fixtures = new URL("../../../schema/fixtures/validation/", import.meta.url);
const fixturePath = (path: string): string => fileURLToPath(new URL(path, fixtures));
const finalizedFixture = fixturePath("valid/minimal-with-content-hash.trail.jsonl");
const finalizedHash = "14cbd25ec40deb46bf77591870f33ad31ba6261bf6bfd91292cf8814ba9c789d";

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

storeTest("registerTrail caches session metadata for catalog list entries", async () => {
  const input = join(storeRoot, "metadata.trail.jsonl");
  await writeFile(
    input,
    await stampedJsonl([
      {
        type: "session",
        schema_version: "0.1.0",
        id: "00000000-0000-4000-8000-000000010001",
        session_uid: "00000000-0000-4000-8000-000000010101",
        name: "Header title",
        cwd: "/work/project",
        vcs: { type: "git", revision: "a1b2c3d4", branch: "main" },
        ts: "2026-05-17T14:00:00.000Z",
        agent: { name: "codex" },
      },
    ]),
    "utf8",
  );

  const result = await registerTrail(input, { storeRoot, catalogDb });

  expect(await listCatalogEntries(catalogDb, { states: ["registered"] })).toEqual([
    expect.objectContaining({
      state: "registered",
      content_hash: result.contentHash,
      agent_name: "codex",
      name: "Header title",
      cwd: "/work/project",
      branch: "main",
      session_date: "2026-05-17T14:00:00.000Z",
      trail_path: objectPath(storeRoot, result.contentHash as string),
    }),
  ]);
});

storeTest("registerTrail caches effective metadata updates for catalog list entries", async () => {
  const input = join(storeRoot, "metadata-updates.trail.jsonl");
  await writeFile(
    input,
    await stampedJsonl([
      {
        type: "session",
        schema_version: "0.1.0",
        id: "00000000-0000-4000-8000-000000020001",
        session_uid: "00000000-0000-4000-8000-000000020101",
        name: "Initial title",
        cwd: "/work/project",
        vcs: { type: "git", revision: "a1b2c3d4", branch: "main" },
        ts: "2026-05-17T14:00:00.000Z",
        agent: { name: "codex" },
      },
      {
        type: "session_metadata_update",
        id: "00000000-0000-4000-8000-000000020002",
        ts: "2026-05-17T14:01:00.000Z",
        payload: { field: "name", value: "Updated title", reason: "ai_generated" },
      },
      {
        type: "session_metadata_update",
        id: "00000000-0000-4000-8000-000000020003",
        ts: "2026-05-17T14:02:00.000Z",
        payload: { field: "vcs.branch", value: "feature/catalog", reason: "runtime_inferred" },
      },
    ]),
    "utf8",
  );

  await registerTrail(input, { storeRoot, catalogDb });

  expect(await listCatalogEntries(catalogDb, { states: ["registered"] })).toEqual([
    expect.objectContaining({
      name: "Updated title",
      branch: "feature/catalog",
      session_date: "2026-05-17T14:00:00.000Z",
    }),
  ]);
});

storeTest("registerTrail suppresses environment metadata when source path is null", async () => {
  const input = join(storeRoot, "metadata-private.trail.jsonl");
  await writeFile(
    input,
    await stampedJsonl([
      {
        type: "session",
        schema_version: "0.1.0",
        id: "00000000-0000-4000-8000-000000020011",
        session_uid: "00000000-0000-4000-8000-000000020111",
        name: "Private source",
        cwd: "/Users/example/private/project",
        vcs: { type: "git", revision: "a1b2c3d4", branch: "private-branch" },
        ts: "2026-05-17T14:00:00.000Z",
        agent: { name: "codex" },
      },
    ]),
    "utf8",
  );

  await registerTrail(input, { storeRoot, catalogDb, sourcePath: null });

  expect(await listCatalogEntries(catalogDb, { states: ["registered"] })).toEqual([
    expect.objectContaining({
      source_id: null,
      path: null,
      agent_name: "codex",
      name: "Private source",
      cwd: null,
      branch: null,
      session_date: "2026-05-17T14:00:00.000Z",
    }),
  ]);
});

storeTest("registerTrail caps cached metadata strings", async () => {
  const input = join(storeRoot, "metadata-oversized.trail.jsonl");
  const oversized = "x".repeat(2100);
  await writeFile(
    input,
    await stampedJsonl([
      {
        type: "session",
        schema_version: "0.1.0",
        id: "00000000-0000-4000-8000-000000020021",
        session_uid: "00000000-0000-4000-8000-000000020121",
        name: oversized,
        cwd: oversized,
        vcs: { type: "git", revision: "a1b2c3d4", branch: oversized },
        ts: "2026-05-17T14:00:00.000Z",
        agent: { name: "codex" },
      },
    ]),
    "utf8",
  );

  await registerTrail(input, { storeRoot, catalogDb });
  const [row] = await listCatalogEntries(catalogDb, { states: ["registered"] });

  expect(row?.name).toBe("x".repeat(2048));
  expect(row?.cwd).toBe("x".repeat(2048));
  expect(row?.branch).toBe("x".repeat(2048));
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
      agent: { name: "codex" },
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
        agent: { name: "codex" },
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

storeTest("registerTrail reports finalized when a non-primary object is written", async () => {
  const commonSession = {
    type: "session",
    schema_version: "0.1.0",
    id: "00000000-0000-4000-8000-000000000401",
    session_uid: "00000000-0000-4000-8000-000000000501",
    ts: "2026-05-17T14:00:00.000Z",
    agent: { name: "codex" },
  };
  const commonEvent = {
    type: "user_message",
    id: "00000000-0000-4000-8000-000000000601",
    ts: "2026-05-17T14:00:01.000Z",
    payload: { text: "same" },
  };
  const firstPath = join(storeRoot, "first-no-envelope.trail.jsonl");
  const secondPath = join(storeRoot, "second-no-envelope.trail.jsonl");
  await writeFile(firstPath, await stampedJsonl([commonSession, commonEvent]), "utf8");
  await writeFile(
    secondPath,
    await stampedJsonl([
      commonSession,
      commonEvent,
      {
        type: "session",
        schema_version: "0.1.0",
        id: "00000000-0000-4000-8000-000000000402",
        session_uid: "00000000-0000-4000-8000-000000000502",
        ts: "2026-05-17T14:02:00.000Z",
        agent: { name: "codex" },
      },
    ]),
    "utf8",
  );

  await registerTrail(firstPath, { storeRoot, catalogDb });
  const result = await registerTrail(secondPath, { storeRoot, catalogDb });

  expect(result.status).toBe("finalized");
});

storeTest("registerTrail replaces symlinked object paths with regular object files", async () => {
  const target = objectPath(storeRoot, finalizedHash);
  const outside = join(storeRoot, "outside.trail.jsonl");
  await mkdir(dirname(target), { recursive: true });
  await writeFile(outside, "outside\n", "utf8");
  await symlink(outside, target);

  const result = await registerTrail(finalizedFixture, { storeRoot, catalogDb });

  expect(result.status).toBe("finalized");
  expect((await lstat(target)).isSymbolicLink()).toBe(false);
  expect(await readFile(target, "utf8")).toBe(
    serializeTrailJsonl(await parseTrailJsonl(await readFile(finalizedFixture, "utf8"))),
  );
});

storeTest("objectPath rejects invalid content hashes", async () => {
  expect(() => objectPath(storeRoot, "../escape")).toThrow("Invalid trail object content hash");
});

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

storeTest("indexExistingObjects indexes object rows from stored objects", async () => {
  await registerTrail(finalizedFixture, { storeRoot });

  const result = await indexExistingObjects({ storeRoot, catalogDb });

  expect(result.entries).toBe(1);
  expect(
    (await findTrailObjectsBySessionUid(catalogDb, "01HZZZZZZZZZZZZZZZZZZZZZ01"))[0],
  ).toMatchObject({
    content_hash: finalizedHash,
    source_path: null,
    kind: "session",
  });
});

storeTest("indexExistingObjects rebuilds catalog list metadata from object bytes", async () => {
  const input = join(storeRoot, "rebuild-metadata.trail.jsonl");
  await writeFile(
    input,
    await stampedJsonl([
      {
        type: "session",
        schema_version: "0.1.0",
        id: "00000000-0000-4000-8000-000000030001",
        session_uid: "00000000-0000-4000-8000-000000030101",
        name: "Rebuild title",
        cwd: "/work/rebuild",
        vcs: { type: "git", revision: "a1b2c3d4", branch: "rebuild" },
        ts: "2026-05-17T14:00:00.000Z",
        agent: { name: "codex" },
      },
    ]),
    "utf8",
  );
  const registered = await registerTrail(input, { storeRoot });

  await indexExistingObjects({ storeRoot, catalogDb });

  expect(await listCatalogEntries(catalogDb, { states: ["registered"] })).toEqual([
    expect.objectContaining({
      content_hash: registered.contentHash,
      agent_name: "codex",
      name: "Rebuild title",
      cwd: null,
      branch: null,
      session_date: "2026-05-17T14:00:00.000Z",
    }),
  ]);
});

storeTest("indexExistingObjects skips corrupt objects and stray files", async () => {
  await registerTrail(finalizedFixture, { storeRoot });
  const corruptPath = objectPath(storeRoot, "c".repeat(64));
  await mkdir(dirname(corruptPath), { recursive: true });
  await writeFile(corruptPath, "{bad\n", "utf8");
  await writeFile(join(dirname(corruptPath), "not-a-hash.trail.jsonl"), "ignored\n", "utf8");
  await symlink(finalizedFixture, objectPath(storeRoot, "d".repeat(64)));

  const result = await indexExistingObjects({ storeRoot, catalogDb });

  expect(result.entries).toBe(1);
  expect(await findTrailObjectsBySessionUid(catalogDb, "01HZZZZZZZZZZZZZZZZZZZZZ01")).toHaveLength(
    1,
  );
  expect(await findTrailObjectsBySessionUid(catalogDb, "missing")).toEqual([]);
});

storeTest("indexExistingObjects preserves rows for multi-session objects", async () => {
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
      agent: { name: "codex" },
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
      agent: { name: "codex" },
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

  const result = await indexExistingObjects({ storeRoot, catalogDb });

  expect(result.entries).toBe(3);
  expect(await findTrailObjectsBySessionUid(catalogDb, firstSessionUid)).toEqual([
    expect.objectContaining({ kind: "session" }),
  ]);
  expect(await findTrailObjectsBySessionUid(catalogDb, secondSessionUid)).toEqual([
    expect.objectContaining({ kind: "session" }),
  ]);
});

storeTest(
  "registerTrail lists multi-session metadata without file-level trail duplicates",
  async () => {
    const firstSessionUid = "00000000-0000-4000-8000-000000040111";
    const secondSessionUid = "00000000-0000-4000-8000-000000040222";
    const text = await stampedJsonl([
      {
        type: "trail",
        schema_version: "0.1.0",
        id: "00000000-0000-4000-8000-000000040010",
        ts: "2026-05-17T14:00:00.000Z",
        producer: "agent-trail-test",
      },
      {
        type: "session",
        schema_version: "0.1.0",
        id: "00000000-0000-4000-8000-000000040011",
        session_uid: firstSessionUid,
        name: "First session",
        cwd: "/work/one",
        vcs: { type: "git", revision: "a1b2c3d4", branch: "one" },
        ts: "2026-05-17T14:01:00.000Z",
        agent: { name: "codex" },
      },
      {
        type: "user_message",
        id: "00000000-0000-4000-8000-000000040012",
        ts: "2026-05-17T14:01:01.000Z",
        payload: { text: "one" },
      },
      {
        type: "session",
        schema_version: "0.1.0",
        id: "00000000-0000-4000-8000-000000040013",
        session_uid: secondSessionUid,
        name: "Second session",
        cwd: "/work/two",
        vcs: { type: "git", revision: "d4c3b2a1", branch: "two" },
        ts: "2026-05-17T14:02:00.000Z",
        agent: { name: "claude-code" },
      },
      {
        type: "user_message",
        id: "00000000-0000-4000-8000-000000040014",
        ts: "2026-05-17T14:02:01.000Z",
        payload: { text: "two" },
      },
    ]);
    const input = join(storeRoot, "multi-metadata.trail.jsonl");
    await writeFile(input, text, "utf8");

    await registerTrail(input, { storeRoot, catalogDb });

    const rows = await listCatalogEntries(catalogDb, { states: ["registered"] });
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agent_name: "claude-code",
          name: "Second session",
          cwd: "/work/two",
          branch: "two",
        }),
        expect.objectContaining({
          agent_name: "codex",
          name: "First session",
          cwd: "/work/one",
          branch: "one",
        }),
      ]),
    );
  },
);
