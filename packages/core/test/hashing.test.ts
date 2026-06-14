import { expect, test } from "bun:test";
import { hashRecords } from "../src/hashing.ts";
import { computeContentHashes, stampContentHashes } from "../src/index.ts";
import { baseEnvelope, baseHeader, event, trail, userMessage } from "./helpers";

test("computes stable lowercase sha-256 session hashes", async () => {
  const parsed = await trail([baseHeader, userMessage("01HEVTA0000000000000000001")]);
  const hashes = computeContentHashes(parsed);

  expect(hashes.sessionHashes).toHaveLength(1);
  expect(hashes.sessionHashes[0]?.hash).toMatch(/^[0-9a-f]{64}$/);
});

test("session hash ignores existing header content_hash values", async () => {
  const baseline = computeContentHashes(await trail([baseHeader])).sessionHashes[0]?.hash;
  const wrong = computeContentHashes(await trail([{ ...baseHeader, content_hash: "a".repeat(64) }]))
    .sessionHashes[0]?.hash;
  const pending = computeContentHashes(await trail([{ ...baseHeader, content_hash: "<pending>" }]))
    .sessionHashes[0]?.hash;

  expect(wrong).toBe(baseline);
  expect(pending).toBe(baseline);
});

test("session metadata updates affect session hashes", async () => {
  const base = computeContentHashes(await trail([baseHeader])).sessionHashes[0]?.hash;
  const named = computeContentHashes(
    await trail([
      baseHeader,
      event("session_metadata_update", "01HEVTA0000000000000000001", "2026-05-17T14:00:01.000Z", {
        field: "name",
        value: "Release notes",
        reason: "ai_generated",
      }),
    ]),
  ).sessionHashes[0]?.hash;
  const renamed = computeContentHashes(
    await trail([
      baseHeader,
      event("session_metadata_update", "01HEVTA0000000000000000001", "2026-05-17T14:00:01.000Z", {
        field: "name",
        value: "Fix parser bug",
        reason: "ai_generated",
      }),
    ]),
  ).sessionHashes[0]?.hash;

  expect(named).not.toBe(base);
  expect(renamed).not.toBe(named);
});

test("stamps every session group without mutating caller-owned parsed input", async () => {
  const parsed = await trail([
    baseHeader,
    { ...baseHeader, id: "01HSESS0000000000000000002", session_uid: "01HZZZZZZZZZZZZZZZZZZZZZ02" },
  ]);
  const originalFirstHeader = parsed.groups[0]?.header.record;
  const stamped = stampContentHashes(parsed);

  expect(stamped.hashes.sessionHashes).toHaveLength(2);
  expect(originalFirstHeader).not.toHaveProperty("content_hash");
  expect(stamped.trail.groups[0]?.header.record).toHaveProperty("content_hash");
  expect(stamped.trail.groups[1]?.header.record).toHaveProperty("content_hash");
});

test("file hash ignores existing envelope content_hash and differs from session hash", async () => {
  const baseline = computeContentHashes(await trail([baseEnvelope, baseHeader]));
  const withWrongEnvelope = computeContentHashes(
    await trail([{ ...baseEnvelope, content_hash: "b".repeat(64) }, baseHeader]),
  );

  expect(baseline.fileHash).toMatch(/^[0-9a-f]{64}$/);
  expect(withWrongEnvelope.fileHash).toBe(baseline.fileHash);
  expect(baseline.fileHash).not.toBe(baseline.sessionHashes[0]?.hash);
});

test("file hash neutralizes the located envelope record", async () => {
  const parseErrorRecord = {
    line: 1,
    record: { type: "x-parse-error", code: "empty_line", raw: "" },
  };
  const headerRecord = { line: 3, record: baseHeader };
  const records = [parseErrorRecord, { line: 2, record: baseEnvelope }, headerRecord];
  const withWrongEnvelopeHash = [
    parseErrorRecord,
    { line: 2, record: { ...baseEnvelope, content_hash: "b".repeat(64) } },
    headerRecord,
  ];

  expect(hashRecords(withWrongEnvelopeHash, "file")).toBe(hashRecords(records, "file"));
});
