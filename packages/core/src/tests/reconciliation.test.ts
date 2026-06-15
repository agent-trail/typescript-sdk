import { expect, test } from "bun:test";
import type { ParsedTrail } from "../index.ts";
import { computeContentHashes, reconcileSegments } from "../index.ts";
import {
  agentMessage,
  baseEnvelope,
  baseHeader,
  brokenSegmentTrails,
  segmentChainBreakWarning,
  sessionMetadataUpdate,
  sessionTerminated,
  trail,
  userMessage,
} from "./helpers";

test("merged segment header keeps first identity fields and late-binds latest metadata", async () => {
  const first = await trail([
    {
      ...baseHeader,
      id: "01HSESS0000000000000000001",
      name: "Initial name",
      description: "Initial description",
      tags: ["initial"],
      cwd: "/first",
      segment: { seq: 1 },
    },
    userMessage("01HEVTA0000000000000000001", "one"),
  ]);
  const second = await trail([
    {
      ...baseHeader,
      id: "01HSESS0000000000000000002",
      name: "Updated name",
      description: "Updated description",
      tags: ["updated"],
      cwd: "/second",
      segment: {
        seq: 2,
        prev_content_hash: computeContentHashes(first).sessionHashes[0]?.hash,
      },
      stream: { state: "closed" },
      parse_fidelity: { truncated: true },
    },
    agentMessage("01HEVTA0000000000000000002", "two"),
  ]);

  const result = reconcileSegments([second, first]);
  const header = result.trails[0]?.groups[0]?.header.record;

  expect(result.diagnostics).toEqual([]);
  expect(header).toMatchObject({
    id: "01HSESS0000000000000000001",
    name: "Updated name",
    description: "Updated description",
    tags: ["updated"],
    cwd: "/second",
    stream: { state: "closed" },
    parse_fidelity: { quarantined_count: 0 },
  });
  expect(header).not.toHaveProperty("segment");
  expect(header).toHaveProperty("content_hash");
});

test("deduplicates repeated event ids by keeping the earliest segment event", async () => {
  const first = await trail([
    { ...baseHeader, segment: { seq: 1 } },
    userMessage("01HEVTA0000000000000000001", "first copy"),
  ]);
  const second = await trail([
    {
      ...baseHeader,
      id: "01HSESS0000000000000000002",
      segment: {
        seq: 2,
        prev_content_hash: computeContentHashes(first).sessionHashes[0]?.hash,
      },
    },
    userMessage("01HEVTA0000000000000000001", "second copy"),
    agentMessage("01HEVTA0000000000000000002", "new"),
  ]);

  const result = reconcileSegments([second, first]);
  const events = result.trails[0]?.groups[0]?.events ?? [];

  expect(events.map((event) => event.record.id)).toEqual([
    "01HEVTA0000000000000000001",
    "01HEVTA0000000000000000002",
  ]);
  expect(events[0]?.record.payload).toEqual({ text: "first copy" });
});

test("reports duplicate sequence numbers and still emits a merged trail", async () => {
  const first = await trail([{ ...baseHeader, segment: { seq: 1 } }]);
  const duplicate = await trail([
    {
      ...baseHeader,
      id: "01HSESS0000000000000000002",
      segment: { seq: 1 },
    },
  ]);

  const result = reconcileSegments([duplicate, first]);

  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({
      code: "duplicate_segment_seq",
      path: "/segment/seq",
      severity: "warning",
    }),
  );
  expect(result.trails).toHaveLength(1);
  expect(result.trails[0]?.groups[0]?.header.record).not.toHaveProperty("segment");
});

test("passes through single trails when session_uid is unique", async () => {
  const inputs = [
    await trail([baseHeader, userMessage("01HEVTA0000000000000000001")]),
    await trail([
      { ...baseHeader, segment: { seq: 1 } },
      userMessage("01HEVTA0000000000000000002"),
    ]),
  ];

  for (const parsed of inputs) {
    const result = reconcileSegments([parsed]);
    expect(result.diagnostics).toEqual([]);
    expect(result.trails).toEqual([parsed]);
  }
});

test("does not mutate caller-owned segment trails during merge", async () => {
  const { first, second } = await validSegmentPair();
  const firstBefore = JSON.stringify(first);
  const secondBefore = JSON.stringify(second);

  reconcileSegments([second, first]);

  expect(JSON.stringify(first)).toBe(firstBefore);
  expect(JSON.stringify(second)).toBe(secondBefore);
});

test("reconciles multiple session_uids independently", async () => {
  const firstA = await trail([
    { ...baseHeader, segment: { seq: 1 } },
    userMessage("01HEVTA0000000000000000001", "a1"),
  ]);
  const secondA = await trail([
    {
      ...baseHeader,
      id: "01HSESS0000000000000000002",
      segment: {
        seq: 2,
        prev_content_hash: computeContentHashes(firstA).sessionHashes[0]?.hash,
      },
    },
    agentMessage("01HEVTA0000000000000000002", "a2"),
  ]);
  const firstB = await trail([
    {
      ...baseHeader,
      id: "01HSESS0000000000000000003",
      session_uid: "01HZZZZZZZZZZZZZZZZZZZZZ02",
      segment: { seq: 1 },
    },
    userMessage("01HEVTA0000000000000000003", "b1"),
  ]);
  const secondB = await trail([
    {
      ...baseHeader,
      id: "01HSESS0000000000000000004",
      session_uid: "01HZZZZZZZZZZZZZZZZZZZZZ02",
      segment: {
        seq: 2,
        prev_content_hash: computeContentHashes(firstB).sessionHashes[0]?.hash,
      },
    },
    agentMessage("01HEVTA0000000000000000004", "b2"),
  ]);

  const result = reconcileSegments([secondB, secondA, firstB, firstA]);

  expect(result.diagnostics).toEqual([]);
  expect(result.trails).toHaveLength(2);
  expect(
    result.trails.map((item) => item.groups[0]?.events).map((events) => events?.length),
  ).toEqual([2, 2]);
});

test("reports broken segment chains and still emits a merged trail", async () => {
  const [first, second] = await brokenSegmentTrails();

  const result = reconcileSegments([second, first]);

  expect(result.diagnostics).toContainEqual(expect.objectContaining(segmentChainBreakWarning));
  expect(result.trails).toHaveLength(1);
  expect(result.trails[0]?.groups[0]?.events.map((event) => event.record.id)).toEqual([
    "01HEVTA0000000000000000001",
    "01HEVTA0000000000000000002",
  ]);
});

test("merged open final segment omits finalized content_hash", async () => {
  const { first, second } = await validSegmentPair({ stream: { state: "open" } });

  const result = reconcileSegments([first, second]);
  const header = result.trails[0]?.groups[0]?.header.record;

  expect(header).toHaveProperty("stream", { state: "open" });
  expect(header).not.toHaveProperty("content_hash");
});

test("drops intermediate process termination markers and keeps terminal marker", async () => {
  const first = await trail([
    { ...baseHeader, segment: { seq: 1 } },
    userMessage("01HEVTA0000000000000000001", "one"),
    sessionTerminated("01HEVTA0000000000000000099", "process_terminated"),
    agentMessage("01HEVTA0000000000000000097", "must not survive"),
  ]);
  const second = await trail([
    {
      ...baseHeader,
      id: "01HSESS0000000000000000002",
      segment: {
        seq: 2,
        prev_content_hash: computeContentHashes(first).sessionHashes[0]?.hash,
      },
    },
    agentMessage("01HEVTA0000000000000000002", "two"),
    sessionTerminated("01HEVTA0000000000000000098", "complete"),
  ]);

  const result = reconcileSegments([first, second]);
  const events = result.trails[0]?.groups[0]?.events ?? [];

  expect(events.map((event) => event.record.type)).toEqual([
    "user_message",
    "agent_message",
    "session_terminated",
  ]);
  expect(events.map((event) => event.record.id)).not.toContain("01HEVTA0000000000000000097");
  expect(events.at(-1)?.record.payload).toEqual({ reason: "complete" });
});

test("adds metadata replay corrections before latest segment events", async () => {
  const first = await trail([
    {
      ...baseHeader,
      segment: { seq: 1 },
      name: "Initial name",
      description: "Initial description",
      tags: ["initial"],
    },
    sessionMetadataUpdate("01HEVTA0000000000000000101", "name", "Old name"),
    sessionMetadataUpdate("01HEVTA0000000000000000102", "description", "Old description"),
    sessionMetadataUpdate("01HEVTA0000000000000000103", "tags", ["old"]),
  ]);
  const second = await trail([
    {
      ...baseHeader,
      id: "01HSESS0000000000000000002",
      segment: {
        seq: 2,
        prev_content_hash: computeContentHashes(first).sessionHashes[0]?.hash,
      },
      name: "Updated name",
      description: "Updated description",
      tags: ["updated"],
    },
    agentMessage("01HEVTA0000000000000000104", "two"),
  ]);

  const result = reconcileSegments([first, second]);
  const events = result.trails[0]?.groups[0]?.events ?? [];
  const metadataUpdates = events.filter((event) => event.record.type === "session_metadata_update");

  expect(metadataUpdates).toHaveLength(6);
  expect(
    metadataUpdates.slice(3).map((event) => ({
      payload: event.record.payload,
      source: event.record.source,
    })),
  ).toEqual([
    {
      payload: {
        field: "name",
        value: "Updated name",
        reason: "runtime_inferred",
        previous_value: "Old name",
      },
      source: {
        agent: "x-agent-trail/reconciler",
        original_type: "reconcile.header_metadata_late_bind",
        synthesized: true,
      },
    },
    {
      payload: {
        field: "description",
        value: "Updated description",
        reason: "runtime_inferred",
        previous_value: "Old description",
      },
      source: {
        agent: "x-agent-trail/reconciler",
        original_type: "reconcile.header_metadata_late_bind",
        synthesized: true,
      },
    },
    {
      payload: {
        field: "tags",
        value: ["updated"],
        reason: "runtime_inferred",
        previous_value: ["old"],
      },
      source: {
        agent: "x-agent-trail/reconciler",
        original_type: "reconcile.header_metadata_late_bind",
        synthesized: true,
      },
    },
  ]);
  expect(events.at(-1)?.record.type).toBe("agent_message");
});

test("latest segment metadata updates remain final after replay corrections", async () => {
  const first = await trail([
    {
      ...baseHeader,
      segment: { seq: 1 },
      name: "Initial name",
      description: "Initial description",
    },
    sessionMetadataUpdate("01HEVTA0000000000000000201", "description", "Old description"),
  ]);
  const second = await trail([
    {
      ...baseHeader,
      id: "01HSESS0000000000000000002",
      segment: {
        seq: 2,
        prev_content_hash: computeContentHashes(first).sessionHashes[0]?.hash,
      },
      name: "Latest name",
      description: "Latest header description",
    },
    sessionMetadataUpdate("01HEVTA0000000000000000202", "description", "Latest event description"),
  ]);

  const result = reconcileSegments([first, second]);
  const descriptionUpdates =
    result.trails[0]?.groups[0]?.events.filter(
      (event) =>
        event.record.type === "session_metadata_update" && payloadField(event) === "description",
    ) ?? [];

  expect(descriptionUpdates.map((event) => payloadValue(event))).toEqual([
    "Old description",
    "Latest header description",
    "Latest event description",
  ]);
});

test("recomputes parse fidelity from merged events", async () => {
  const first = await trail([
    {
      ...baseHeader,
      segment: { seq: 1 },
      parse_fidelity: { quarantined_count: 0, termination_reason: "process_terminated" },
    },
    {
      type: "system_event",
      id: "01HEVTA0000000000000000301",
      ts: "2026-05-17T14:00:05.000Z",
      payload: { kind: "x-codex/unknown_record", data: { raw: "{}" } },
    },
    sessionTerminated("01HEVTA0000000000000000302", "process_terminated"),
  ]);
  const second = await trail([
    {
      ...baseHeader,
      id: "01HSESS0000000000000000002",
      segment: {
        seq: 2,
        prev_content_hash: computeContentHashes(first).sessionHashes[0]?.hash,
      },
      parse_fidelity: { quarantined_count: 0 },
    },
    agentMessage("01HEVTA0000000000000000303", "two"),
    sessionTerminated("01HEVTA0000000000000000304", "user_abort"),
  ]);

  const result = reconcileSegments([first, second]);
  const header = result.trails[0]?.groups[0]?.header.record;

  expect(header?.parse_fidelity).toEqual({
    quarantined_count: 1,
    termination_reason: "user_abort",
  });
});

test("splits multi-session inputs and reconciles each session independently", async () => {
  const firstA = await trail([
    baseEnvelope,
    { ...baseHeader, segment: { seq: 1 } },
    userMessage("01HEVTA0000000000000000001", "a1"),
    {
      ...baseHeader,
      id: "01HSESS0000000000000000003",
      session_uid: "01HZZZZZZZZZZZZZZZZZZZZZ02",
    },
    userMessage("01HEVTA0000000000000000003", "b1"),
  ]);
  const secondA = await trail([
    {
      ...baseHeader,
      id: "01HSESS0000000000000000002",
      segment: {
        seq: 2,
        prev_content_hash: computeContentHashes(firstA).sessionHashes[0]?.hash,
      },
    },
    agentMessage("01HEVTA0000000000000000002", "a2"),
  ]);

  const result = reconcileSegments([firstA, secondA]);

  expect(result.trails).toHaveLength(2);
  expect(result.trails.map((item) => item.groups[0]?.header.record.session_uid).sort()).toEqual([
    "01HZZZZZZZZZZZZZZZZZZZZZ01",
    "01HZZZZZZZZZZZZZZZZZZZZZ02",
  ]);
  expect(
    result.trails
      .find((item) => item.groups[0]?.header.record.session_uid === baseHeader.session_uid)
      ?.groups[0]?.events.map((event) => event.record.payload),
  ).toEqual([{ text: "a1" }, { text: "a2" }]);
});

async function validSegmentPair(
  secondHeaderExtras: Record<string, unknown> = {},
): Promise<{ first: ParsedTrail; second: ParsedTrail }> {
  const first = await trail([
    { ...baseHeader, segment: { seq: 1 } },
    userMessage("01HEVTA0000000000000000001", "one"),
  ]);
  const second = await trail([
    {
      ...baseHeader,
      id: "01HSESS0000000000000000002",
      segment: {
        seq: 2,
        prev_content_hash: computeContentHashes(first).sessionHashes[0]?.hash,
      },
      ...secondHeaderExtras,
    },
    agentMessage("01HEVTA0000000000000000002", "two"),
  ]);
  return { first, second };
}

function payloadField(event: ParsedTrail["records"][number]): unknown {
  const payload = recordPayload(event.record);
  return typeof payload === "object" && payload !== null && !Array.isArray(payload)
    ? (payload as { field?: unknown }).field
    : undefined;
}

function payloadValue(event: ParsedTrail["records"][number]): unknown {
  const payload = recordPayload(event.record);
  return typeof payload === "object" && payload !== null && !Array.isArray(payload)
    ? (payload as { value?: unknown }).value
    : undefined;
}

function recordPayload(record: unknown): unknown {
  return typeof record === "object" && record !== null && "payload" in record
    ? record.payload
    : undefined;
}
