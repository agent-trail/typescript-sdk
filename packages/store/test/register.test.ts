import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { parseTrailJsonl, serializeTrailJsonl } from "@agent-trail/core";
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
