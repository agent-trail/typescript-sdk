import { expect, test } from "bun:test";
import {
  computeContentHashes,
  parseTrailJsonl,
  reconcileSegments,
  stampContentHashes,
  validateTrailJsonl,
} from "../index.ts";
import { segmentChainBreakWarning } from "./helpers";

const header = {
  type: "session",
  schema_version: "0.1.0",
  id: "01HSESS0000000000000000001",
  session_uid: "01HZZZZZZZZZZZZZZZZZZZZZ01",
  ts: "2026-05-17T14:00:00.000Z",
  agent: { name: "codex" },
} as const;

function jsonl(records: unknown[]): string {
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

async function* chunks(parts: (string | Uint8Array)[]): AsyncIterable<string | Uint8Array> {
  for (const part of parts) yield part;
}

async function* deferredChunks(parts: Uint8Array[]): AsyncIterable<Uint8Array> {
  for (const part of parts) {
    await Promise.resolve();
    yield part;
  }
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

test("isolates UTF-8 decoder state across concurrent async parses", async () => {
  const encoder = new TextEncoder();
  const first = jsonl([{ ...header, name: "é" }]);
  const second = jsonl([{ ...header, id: "01HSESS0000000000000000002", name: "🚀" }]);
  const firstBytes = encoder.encode(first);
  const secondBytes = encoder.encode(second);

  const [firstTrail, secondTrail] = await Promise.all([
    parseTrailJsonl(deferredChunks([firstBytes.slice(0, 46), firstBytes.slice(46)])),
    parseTrailJsonl(deferredChunks([secondBytes.slice(0, 47), secondBytes.slice(47)])),
  ]);

  expect(firstTrail.records[0]?.record).toHaveProperty("name", "é");
  expect(secondTrail.records[0]?.record).toHaveProperty("name", "🚀");
  expect(firstTrail.records[0]?.record.type).toBe("session");
  expect(secondTrail.records[0]?.record.type).toBe("session");
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

test("reconciles ordered segments, deduplicates event ids, and restamps", async () => {
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
        segment: {
          seq: 2,
          prev_content_hash: computeContentHashes(segmentOne).sessionHashes[0]?.hash,
        },
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

  expect(result.diagnostics).toEqual([]);
  expect(merged?.groups[0]?.events.map((event) => event.record.id)).toEqual([
    "01HEVTA0000000000000000001",
    "01HEVTA0000000000000000002",
  ]);
  expect(merged?.groups[0]?.header.record).not.toHaveProperty("segment");
  expect(merged?.groups[0]?.header.record).toHaveProperty("stream", { state: "closed" });
});

test("reports unproven segment chains and still emits merged output", async () => {
  const segmentOne = await parseTrailJsonl(jsonl([{ ...header, segment: { seq: 1 } }]));
  const segmentTwo = await parseTrailJsonl(
    jsonl([
      {
        ...header,
        id: "01HSESS0000000000000000002",
        segment: { seq: 2, prev_content_hash: null },
      },
    ]),
  );

  const result = reconcileSegments([segmentTwo, segmentOne]);
  const chainDiagnostic = result.diagnostics.find(
    (diagnostic) => diagnostic.code === segmentChainBreakWarning.code,
  );

  expect(chainDiagnostic).toEqual(expect.objectContaining(segmentChainBreakWarning));
  expect(result.trails).toHaveLength(1);
  expect(result.trails[0]?.groups[0]?.header.record).toHaveProperty("content_hash");
});

test("passes through trails without session_uid during reconciliation", async () => {
  const single = await parseTrailJsonl(jsonl([{ ...header, session_uid: undefined }]));
  const result = reconcileSegments([single]);

  expect(result.trails).toEqual([single]);
  expect(result.diagnostics).toEqual([]);
});

test("passes through single non-segmented trails with envelopes during reconciliation", async () => {
  const single = await parseTrailJsonl(
    jsonl([
      {
        type: "trail",
        schema_version: "0.1.0",
        id: "01HSESS0000000000000000900",
        ts: "2026-05-17T14:00:00.000Z",
        producer: "agent-trail-test",
      },
      header,
      {
        type: "user_message",
        id: "01HEVTA0000000000000000001",
        ts: "2026-05-17T14:00:01.000Z",
        payload: { text: "hello" },
      },
    ]),
  );

  const result = reconcileSegments([single]);

  expect(result.trails).toEqual([single]);
  expect(result.trails[0]?.envelope?.record.type).toBe("trail");
  expect(result.trails[0]?.records.map((record) => record.record.type)).toEqual([
    "trail",
    "session",
    "user_message",
  ]);
});

test("treats schema-unknown event records as future records in tolerant mode", async () => {
  const result = await validateTrailJsonl(
    jsonl([
      header,
      {
        type: "subagent_invoke",
        id: "01HEVTA0000000000000000001",
        ts: "2026-05-17T14:00:01.000Z",
        payload: {},
      },
    ]),
    { mode: "tolerant" },
  );

  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({
      code: "reader_tolerant_unknown_record",
      path: "/type",
      severity: "warning",
    }),
  );
});

test("reports core-owned diagnostics not covered by fixture manifest", async () => {
  const parentHash = "a".repeat(64);
  const childHash = "b".repeat(64);
  const text = jsonl([
    {
      type: "trail",
      schema_version: "0.1.0",
      id: "01HSESS0000000000000000900",
      ts: "2026-05-17T14:00:00.000Z",
      producer: "agent-trail-test",
      parent_id: "01HSESS0000000000000000001",
    },
    { ...header, content_hash: parentHash, stream: { state: "open" } },
    {
      type: "tool_call",
      id: "01HEVTA0000000000000000001",
      ts: "2026-05-17T14:00:01.000Z",
      payload: { tool: "file_read", args: { path: "/tmp/a", token: "api_key=secret" } },
      source: { raw: { envelope_ref: "missing", authorization: "Bearer secret" } },
    },
    {
      type: "tool_result",
      id: "01HEVTA0000000000000000002",
      ts: "2026-05-17T14:00:02.000Z",
      payload: {
        for_id: "01HEVTA0000000000000000001",
        output: "ok",
        semantic: { tool: "file_write" },
      },
    },
    {
      type: "user_query",
      id: "01HEVTA0000000000000000003",
      ts: "2026-05-17T14:00:03.000Z",
      payload: {
        questions: [{ id: "q1", kind: "text", prompt: "continue?" }],
      },
    },
    {
      type: "user_query_response",
      id: "01HEVTA0000000000000000004",
      ts: "2026-05-17T14:00:04.000Z",
      payload: {
        for_id: "01HEVTA0000000000000000003",
        answers: { q2: "yes" },
      },
    },
    {
      type: "session_end",
      id: "01HEVTA0000000000000000005",
      ts: "2026-05-17T14:00:05.000Z",
      payload: {},
    },
    {
      ...header,
      id: "01HSESS0000000000000000002",
      session_uid: "01HZZZZZZZZZZZZZZZZZZZZZ02",
      fork_from: {
        session_id: "01HSESS0000000000000000001",
        content_hash: childHash,
      },
    },
  ]);

  const result = await validateTrailJsonl(text, { mode: "strict" });
  const codes = result.diagnostics.map((diagnostic) => diagnostic.code);

  expect(codes).toContain("envelope_has_parent_id");
  expect(codes).toContain("source_raw_envelope_ref_unresolved");
  expect(codes).toContain("source_raw_unredacted_secret");
  expect(codes).toContain("cross_group_fork_from_hash_mismatch");
  expect(codes).toContain("tool_result_semantic_conflict");
  expect(codes).toContain("unknown_user_query_answer_key");
  expect(codes).toContain("stream_open_with_terminal_event");
});
