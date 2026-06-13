import { expect, test } from "bun:test";
import { computeContentHashes, reconcileSegments } from "../src/index.ts";
import { agentMessage, baseHeader, trail, userMessage } from "./helpers";

test("merged segment header keeps first identity fields and only last stream/parse_fidelity", async () => {
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
    name: "Initial name",
    description: "Initial description",
    tags: ["initial"],
    cwd: "/first",
    stream: { state: "closed" },
    parse_fidelity: { truncated: true },
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

test("reports duplicate sequence numbers and leaves inputs unmerged", async () => {
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
    expect.objectContaining({ code: "duplicate_segment_seq", path: "/segment/seq" }),
  );
  expect(result.trails).toEqual([duplicate, first]);
});

test("passes through single non-segmented trails when session_uid is unique", async () => {
  const parsed = await trail([baseHeader, userMessage("01HEVTA0000000000000000001")]);
  const result = reconcileSegments([parsed]);

  expect(result.diagnostics).toEqual([]);
  expect(result.trails).toEqual([parsed]);
});

test("does not mutate caller-owned segment trails during merge", async () => {
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
    },
    agentMessage("01HEVTA0000000000000000002", "two"),
  ]);
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
