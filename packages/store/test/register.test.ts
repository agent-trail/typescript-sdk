import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { parseTrailJsonl, serializeTrailJsonl, stampContentHashes } from "@agent-trail/core";
import { objectPath, readIndex, rebuildIndex, registerTrail } from "../src/index.ts";

const fixtures = new URL("../../schema/fixtures/validation/", import.meta.url);
const fixturePath = (path: string): string => fileURLToPath(new URL(path, fixtures));
const finalizedFixture = fixturePath("valid/minimal-with-content-hash.trail.jsonl");
const finalizedHash = "8dbf946e5d4ccd2a4ff2681d2c2fe2614f0769bdfeafe5e4f242db14872db5f7";

let storeRoot: string;

beforeEach(() => {
  storeRoot = mkdtempSync(join(tmpdir(), "trail-store-"));
});

afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
});

function jsonl(records: unknown[]): string {
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

async function stampedJsonl(records: unknown[]): Promise<string> {
  return stampContentHashes(await parseTrailJsonl(jsonl(records))).jsonl;
}

test("registerTrail writes canonical object bytes and an index row", async () => {
  const result = await registerTrail(finalizedFixture, { storeRoot });

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

  const index = await readIndex(storeRoot);
  expect(index.entries[finalizedHash]).toMatchObject({
    source_path: finalizedFixture,
    session_uid: "01HZZZZZZZZZZZZZZZZZZZZZ01",
    kind: "session",
  });
});

test("registerTrail accepts gzipped trail files", async () => {
  const input = join(storeRoot, "input.trail.jsonl.gz");
  await writeFile(input, gzipSync(await readFile(finalizedFixture)));

  const result = await registerTrail(input, { storeRoot });

  expect(result.status).toBe("finalized");
  expect(result.contentHash).toBe(finalizedHash);
});

test("registerTrail keeps session-hash object bytes independent of sibling sessions", async () => {
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

  await registerTrail(firstPath, { storeRoot });
  const commonHash = Object.entries((await readIndex(storeRoot)).entries).find(
    ([, entry]) => entry.session_uid === commonSession.session_uid,
  )?.[0] as string;
  const before = await readFile(objectPath(storeRoot, commonHash), "utf8");
  await registerTrail(secondPath, { storeRoot });

  expect(await readFile(objectPath(storeRoot, commonHash), "utf8")).toBe(before);
  expect(before).toContain("same");
  expect(before).not.toContain("claude-code");
});

test("registerTrail rejects gzipped trails over the decompressed size cap", async () => {
  const input = join(storeRoot, "oversized.trail.jsonl.gz");
  await writeFile(input, gzipSync("x".repeat(8_000_001)));

  const result = await registerTrail(input, { storeRoot });

  expect(result.status).toBe("invalid");
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({ code: "gzip_decode_failed" }),
  );
});

test("registerTrail rejects pending and invalid trails without writing objects", async () => {
  const pending = await registerTrail(fixturePath("valid/streaming-open.trail.jsonl"), {
    storeRoot,
  });
  expect(pending.status).toBe("skipped_pending");

  const invalid = await registerTrail(
    fixturePath("hash-mismatch/content-hash-mismatch.trail.jsonl"),
    {
      storeRoot,
    },
  );
  expect(invalid.status).toBe("invalid");
  expect(
    invalid.diagnostics.some((diagnostic) => diagnostic.code === "content_hash_mismatch"),
  ).toBe(true);
});

test("readIndex rejects invalid content hash keys", async () => {
  await mkdir(join(storeRoot, "index"), { recursive: true });
  await writeFile(
    join(storeRoot, "index", "objects.json"),
    '{"version":1,"entries":{"../../../tmp/escape":{"registered_at":"2026-05-17T14:00:00.000Z","source_path":null}}}\n',
  );

  await expect(readIndex(storeRoot)).rejects.toThrow("invalid content_hash index key");
});

test("readIndex rejects null index files as corrupt", async () => {
  await mkdir(join(storeRoot, "index"), { recursive: true });
  await writeFile(join(storeRoot, "index", "objects.json"), "null\n");

  await expect(readIndex(storeRoot)).rejects.toThrow("index must be a plain object");
});

test("rebuildIndex regenerates index rows from stored objects", async () => {
  await registerTrail(finalizedFixture, { storeRoot });
  await writeFile(join(storeRoot, "index", "objects.json"), '{"version":1,"entries":{}}\n');

  const result = await rebuildIndex({ storeRoot });

  expect(result.entries).toBe(1);
  expect((await readIndex(storeRoot)).entries[finalizedHash]).toMatchObject({
    source_path: null,
    kind: "session",
  });
});
