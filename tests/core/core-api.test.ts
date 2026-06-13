import { expect, test } from "bun:test";
import {
  computeContentHashes,
  parseTrailJsonl,
  reconcileSegments,
  stampContentHashes,
} from "../../packages/core/src/index.ts";

const header = {
  type: "session",
  schema_version: "0.1.0",
  id: "01HSESS0000000000000000001",
  session_uid: "01HZZZZZZZZZZZZZZZZZZZZZ01",
  ts: "2026-05-17T14:00:00.000Z",
  agent: { name: "codex-cli" },
} as const;

function jsonl(records: unknown[]): string {
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

async function* chunks(parts: (string | Uint8Array)[]): AsyncIterable<string | Uint8Array> {
  for (const part of parts) yield part;
}

test("parses async string and byte chunks across JSONL and UTF-8 boundaries", async () => {
  const encoder = new TextEncoder();
  const text = jsonl([
    header,
    {
      type: "user_message",
      id: "01HEVTA0000000000000000001",
      ts: "2026-05-17T14:00:01.000Z",
      payload: { text: "hello \u{1f680}" },
    },
  ]);
  const rocketBytes = encoder.encode("\u{1f680}");
  const splitRocket = [
    text.slice(0, text.indexOf("\u{1f680}")),
    rocketBytes.slice(0, 2),
    rocketBytes.slice(2),
    text.slice(text.indexOf("\u{1f680}") + "\u{1f680}".length),
  ];

  const trail = await parseTrailJsonl(chunks(splitRocket));

  expect(trail.groups).toHaveLength(1);
  expect(trail.groups[0]?.events[0]?.record.type).toBe("user_message");
});

test("computes and stamps content hashes without mutating parsed input", async () => {
  const trail = await parseTrailJsonl(jsonl([header]));
  const originalHeader = trail.groups[0]?.header.record;
  const hashes = computeContentHashes(trail);
  const stamped = stampContentHashes(trail);

  expect(hashes.sessionHashes[0]?.hash).toMatch(/^[a-f0-9]{64}$/);
  expect(originalHeader).not.toHaveProperty("content_hash");
  expect(stamped.trail.groups[0]?.header.record).toHaveProperty(
    "content_hash",
    hashes.sessionHashes[0]?.hash,
  );
  expect(stamped.jsonl).toContain(hashes.sessionHashes[0]?.hash ?? "");
});

test("computes two-tier envelope and session hashes", async () => {
  const trail = await parseTrailJsonl(
    jsonl([
      {
        type: "trail",
        schema_version: "0.1.0",
        id: "01HSESS0000000000000000900",
        ts: "2026-05-17T14:00:00.000Z",
        producer: "agent-trail-test",
      },
      header,
    ]),
  );

  const stamped = stampContentHashes(trail);

  expect(stamped.hashes.fileHash).toMatch(/^[a-f0-9]{64}$/);
  expect(stamped.hashes.sessionHashes[0]?.hash).toMatch(/^[a-f0-9]{64}$/);
  expect(stamped.hashes.fileHash).not.toBe(stamped.hashes.sessionHashes[0]?.hash);
});

test("reconciles ordered segments, deduplicates event ids, and reports chain gaps", async () => {
  const segmentOne = await parseTrailJsonl(
    jsonl([
      { ...header, segment: { seq: 1 } },
      {
        type: "user_message",
        id: "01HEVTA0000000000000000001",
        ts: "2026-05-17T14:00:01.000Z",
        payload: { text: "one" },
      },
    ]),
  );
  const segmentTwo = await parseTrailJsonl(
    jsonl([
      {
        ...header,
        id: "01HSESS0000000000000000002",
        segment: { seq: 2, prev_content_hash: null },
        stream: { state: "closed" },
      },
      {
        type: "user_message",
        id: "01HEVTA0000000000000000001",
        ts: "2026-05-17T14:00:01.000Z",
        payload: { text: "one duplicate" },
      },
      {
        type: "agent_message",
        id: "01HEVTA0000000000000000002",
        ts: "2026-05-17T14:00:02.000Z",
        payload: { text: "two" },
      },
    ]),
  );

  const result = reconcileSegments([segmentTwo, segmentOne]);
  const merged = result.trails[0];

  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("segment_chain_break");
  expect(merged?.groups[0]?.events.map((event) => event.record.id)).toEqual([
    "01HEVTA0000000000000000001",
    "01HEVTA0000000000000000002",
  ]);
  expect(merged?.groups[0]?.header.record).not.toHaveProperty("segment");
  expect(merged?.groups[0]?.header.record).toHaveProperty("stream", { state: "closed" });
});

test("passes through trails without session_uid during reconciliation", async () => {
  const single = await parseTrailJsonl(jsonl([{ ...header, session_uid: undefined }]));
  const result = reconcileSegments([single]);

  expect(result.trails).toEqual([single]);
  expect(result.diagnostics).toEqual([]);
});
