import { expect, test } from "bun:test";
import { validateTrailJsonl } from "../index.ts";
import { baseEnvelope, baseHeader, event, jsonl, toolCall } from "./helpers";

async function codes(records: unknown[]) {
  const result = await validateTrailJsonl(jsonl(records), { mode: "strict" });
  return result.diagnostics.map((diagnostic) => diagnostic.code);
}

test("accepts slashed custom agent names and rejects legacy hyphenated custom names", async () => {
  const valid = await codes([{ ...baseHeader, agent: { name: "x-example/myagent" } }]);
  const invalid = await codes([{ ...baseHeader, agent: { name: "x-com-example-myagent" } }]);

  expect(valid).toEqual([]);
  expect(invalid).toContain("schema");
});

test("rejects calendar-invalid timestamps and non-canonical id casing", async () => {
  const invalidTimestamp = await codes([{ ...baseHeader, ts: "2026-02-30T00:00:00.000Z" }]);
  const invalidEnvelopeTimestamp = await codes([
    { ...baseEnvelope, ts: "2026-02-30T00:00:00.000Z" },
    baseHeader,
  ]);
  const invalidStreamTimestamp = await codes([
    {
      ...baseHeader,
      stream: { state: "open", started_at: "2026-02-30T00:00:00.000Z" },
    },
  ]);
  const lowercaseUlid = await codes([{ ...baseHeader, id: "01hsess0000000000000000001" }]);
  const uppercaseUuid = await codes([
    { ...baseHeader, id: "00000000-0000-5000-8000-ABCDEFABCDEF" },
  ]);

  expect(invalidTimestamp).toContain("invalid_timestamp");
  expect(invalidEnvelopeTimestamp).toContain("invalid_timestamp");
  expect(invalidStreamTimestamp).toContain("invalid_timestamp");
  expect(lowercaseUlid).toContain("schema");
  expect(uppercaseUuid).toContain("schema");
});

test("validates parse_fidelity and stream header shapes", async () => {
  const invalidFidelity = await codes([
    { ...baseHeader, parse_fidelity: { quarantined_count: -1 } },
  ]);
  const invalidStreamState = await codes([{ ...baseHeader, stream: { state: "half-open" } }]);
  const missingStreamState = await codes([
    { ...baseHeader, stream: { started_at: baseHeader.ts } },
  ]);

  expect(invalidFidelity).toContain("schema");
  expect(invalidStreamState).toContain("schema");
  expect(missingStreamState).toContain("schema");
});

test("validates task plan update snapshots and rejects malformed deltas", async () => {
  const valid = await codes([
    baseHeader,
    event("task_plan_update", "01HEVTA0000000000000000001", "2026-05-17T14:00:01.000Z", {
      items: [{ id: "1", content: "ship", status: "in_progress" }],
      deltas: [{ kind: "added", item_id: "1", to_content: "ship", to_status: "in_progress" }],
    }),
  ]);
  const invalid = await codes([
    baseHeader,
    event("task_plan_update", "01HEVTA0000000000000000001", "2026-05-17T14:00:01.000Z", {
      items: [{ id: "1", content: "ship", status: "unknown" }],
      deltas: [{ kind: "renamed", item_id: "1" }],
    }),
  ]);

  expect(valid).not.toContain("schema");
  expect(invalid).toContain("schema");
});

test("validates user query and response structural constraints", async () => {
  const valid = await codes([
    baseHeader,
    event("user_query", "01HEVTA0000000000000000001", "2026-05-17T14:00:01.000Z", {
      questions: [{ id: "q1", question: "Continue?" }],
    }),
    event("user_query_response", "01HEVTA0000000000000000002", "2026-05-17T14:00:02.000Z", {
      for_id: "01HEVTA0000000000000000001",
      answers: { q1: { selected: ["yes"] } },
    }),
  ]);
  const missingQuestionId = await codes([
    baseHeader,
    event("user_query", "01HEVTA0000000000000000001", "2026-05-17T14:00:01.000Z", {
      questions: [{ question: "Continue?" }],
    }),
  ]);
  const missingForId = await codes([
    baseHeader,
    event("user_query_response", "01HEVTA0000000000000000002", "2026-05-17T14:00:02.000Z", {
      answers: {},
    }),
  ]);

  expect(valid).not.toContain("schema");
  expect(missingQuestionId).toContain("schema");
  expect(missingForId).toContain("schema");
});

test("validates system event and source extension naming", async () => {
  const reserved = await codes([
    baseHeader,
    event("system_event", "01HEVTA0000000000000000001", "2026-05-17T14:00:01.000Z", {
      kind: "heartbeat",
    }),
  ]);
  const extension = await codes([
    baseHeader,
    event("system_event", "01HEVTA0000000000000000001", "2026-05-17T14:00:01.000Z", {
      kind: "x-acme/event",
    }),
  ]);
  const bareUnknown = await codes([
    baseHeader,
    event("system_event", "01HEVTA0000000000000000001", "2026-05-17T14:00:01.000Z", {
      kind: "unknown_event",
    }),
  ]);

  expect(reserved).not.toContain("schema");
  expect(extension).not.toContain("schema");
  expect(bareUnknown).toContain("schema");
});

test("validates tool truncation, overflow refs, and file edit forms", async () => {
  const truncatedWithoutSize = await codes([
    baseHeader,
    {
      ...toolCall("01HEVTA0000000000000000001"),
      payload: { tool: "file_read", args: {}, truncated: true },
    },
  ]);
  const badOverflowRef = await codes([
    baseHeader,
    event("tool_result", "01HEVTA0000000000000000001", "2026-05-17T14:00:01.000Z", {
      for_id: "01HEVTA0000000000000000002",
      output: "large",
      overflow_ref: "not-a-hash",
    }),
  ]);
  const invalidFileEdit = await codes([
    baseHeader,
    {
      ...toolCall("01HEVTA0000000000000000001", "file_edit"),
      payload: { tool: "file_edit", args: { path: "a.txt", diff: "x", old: "a", new: "b" } },
    },
  ]);

  expect(truncatedWithoutSize).toContain("schema");
  expect(badOverflowRef).toContain("schema");
  expect(invalidFileEdit).toContain("schema");
});

test("validates attachment minimum fields", async () => {
  const invalidAttachment = await codes([
    baseHeader,
    event("agent_message", "01HEVTA0000000000000000001", "2026-05-17T14:00:01.000Z", {
      text: "see attached",
      attachments: [{ mime_type: "text/plain" }],
    }),
  ]);

  expect(invalidAttachment).toContain("schema");
});

test("validates trail envelope placement and required producer", async () => {
  const missingProducer = await codes([{ ...baseEnvelope, producer: undefined }, baseHeader]);
  const lateEnvelope = await codes([baseHeader, baseEnvelope]);
  const valid = await codes([baseEnvelope, baseHeader]);

  expect(missingProducer).toContain("schema");
  expect(lateEnvelope).toContain("envelope_not_at_line_1");
  expect(valid).not.toContain("schema");
});
