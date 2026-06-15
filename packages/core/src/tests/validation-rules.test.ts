import { expect, test } from "bun:test";
import { validateTrailJsonl } from "../index.ts";
import {
  agentMessage,
  baseEnvelope,
  baseHeader,
  event,
  jsonl,
  toolCall,
  toolResult,
  userMessage,
} from "./helpers";

test("strict accepts minimal writer-strict session header", async () => {
  const result = await validateTrailJsonl(jsonl([baseHeader]), { mode: "strict" });

  expect(result.ok).toBe(true);
  expect(result.diagnostics).toEqual([]);
});

test("tolerant preserves compatible future schema versions with warning-only diagnostics", async () => {
  const text = jsonl([{ ...baseHeader, schema_version: "0.1.1" }]);
  const strict = await validateTrailJsonl(text, { mode: "strict" });
  const tolerant = await validateTrailJsonl(text, { mode: "tolerant" });

  expect(strict.ok).toBe(false);
  expect(tolerant.ok).toBe(false);
  expect(tolerant.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(false);
  expect(tolerant.diagnostics).toContainEqual(
    expect.objectContaining({
      code: "reader_tolerant_schema_version",
      path: "/schema_version",
      severity: "warning",
    }),
  );
});

test("reports duplicate ids, unknown parents, and parent cycles", async () => {
  const first = userMessage("01HEVTA0000000000000000001", "first");
  const duplicate = agentMessage("01HEVTA0000000000000000001", "duplicate");
  const unknownParent = agentMessage(
    "01HEVTA0000000000000000002",
    "unknown",
    "01HEVTA0000000000000000999",
  );
  const cycleA = userMessage("01HEVTA0000000000000000005", "cycle-a", "01HEVTA0000000000000000006");
  const cycleB = userMessage("01HEVTA0000000000000000006", "cycle-b", "01HEVTA0000000000000000005");

  const result = await validateTrailJsonl(
    jsonl([baseHeader, first, duplicate, unknownParent, cycleA, cycleB]),
    { mode: "strict" },
  );
  const codes = result.diagnostics.map((diagnostic) => diagnostic.code);

  expect(result.ok).toBe(false);
  expect(codes).toContain("duplicate_id");
  expect(codes).toContain("unknown_parent_id");
  expect(codes).toContain("parent_cycle");
});

test("reports non-monotonic child timestamps when parent graph is acyclic", async () => {
  const parent = event("user_message", "01HEVTA0000000000000000001", "2026-05-17T14:00:02.000Z", {
    text: "parent",
  });
  const childBeforeParent = event(
    "agent_message",
    "01HEVTA0000000000000000002",
    "2026-05-17T14:00:01.000Z",
    { text: "early" },
    "01HEVTA0000000000000000001",
  );

  const result = await validateTrailJsonl(jsonl([baseHeader, parent, childBeforeParent]), {
    mode: "strict",
  });
  const codes = result.diagnostics.map((diagnostic) => diagnostic.code);

  expect(codes).toContain("non_monotonic_event_ts");
});

test("reports envelope parent, multiple envelope, and header parent violations", async () => {
  const result = await validateTrailJsonl(
    jsonl([
      { ...baseEnvelope, parent_id: "01HSESS0000000000000000001" },
      baseHeader,
      { ...baseEnvelope, id: "01HSESS0000000000000000901" },
      { ...baseHeader, parent_id: "01HEVTA0000000000000000001" },
    ]),
    { mode: "strict" },
  );
  const codes = new Set(result.diagnostics.map((diagnostic) => diagnostic.code));

  expect(codes.has("envelope_has_parent_id")).toBe(true);
  expect(codes.has("multiple_envelopes")).toBe(true);
  expect(codes.has("header_has_parent_id")).toBe(true);
});

test("reports missing header after an envelope without a second envelope", async () => {
  const result = await validateTrailJsonl(
    jsonl([baseEnvelope, userMessage("01HEVTA0000000000000000001")]),
    { mode: "strict" },
  );

  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    "missing_header_after_envelope",
  );
});

test("reports tool pairing warnings and suppresses terminated open calls", async () => {
  const result = await validateTrailJsonl(
    jsonl([
      baseHeader,
      toolCall("01HEVTA0000000000000000001", "file_read"),
      toolResult("01HEVTA0000000000000000002", "01HEVTA0000000000000000001"),
      toolCall("01HEVTA0000000000000000003", "shell"),
      toolCall("01HEVTA0000000000000000004", "shell"),
      toolResult("01HEVTA0000000000000000005", undefined),
      toolCall("01HEVTA0000000000000000006", "shell"),
      event("session_terminated", "01HEVTA0000000000000000007", "2026-05-17T14:00:05.000Z", {
        reason: "interrupted",
        open_call_ids: ["01HEVTA0000000000000000006"],
      }),
    ]),
    { mode: "strict" },
  );
  const codes = result.diagnostics.map((diagnostic) => diagnostic.code);

  expect(codes).toContain("ambiguous_sequential_pairing");
  expect(codes).toContain("unmatched_tool_call_at_eof");
  expect(
    result.diagnostics.some(
      (diagnostic) => diagnostic.line === 7 && diagnostic.code === "unmatched_tool_call_at_eof",
    ),
  ).toBe(false);
});

test("pairs implicit tool results by top-level semantic call id before sequential fallback", async () => {
  const result = await validateTrailJsonl(
    jsonl([
      baseHeader,
      { ...toolCall("01HEVTA0000000000000000001", "file_read"), semantic: { call_id: "call_a" } },
      toolCall("01HEVTA0000000000000000002", "shell"),
      { ...toolResult("01HEVTA0000000000000000003", undefined), semantic: { call_id: "call_a" } },
    ]),
    { mode: "strict" },
  );

  expect(result.diagnostics).not.toContainEqual(
    expect.objectContaining({ code: "ambiguous_sequential_pairing" }),
  );
  expect(result.diagnostics).not.toContainEqual(
    expect.objectContaining({ line: 2, code: "unmatched_tool_call_at_eof" }),
  );
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({ line: 3, code: "unmatched_tool_call_at_eof" }),
  );
});

test("reports user query response and source raw diagnostics", async () => {
  const result = await validateTrailJsonl(
    jsonl([
      baseHeader,
      event("user_query", "01HEVTA0000000000000000001", "2026-05-17T14:00:01.000Z", {
        questions: [{ id: "q1", kind: "text", prompt: "Continue?" }],
      }),
      event("user_query_response", "01HEVTA0000000000000000002", "2026-05-17T14:00:02.000Z", {
        for_id: "01HEVTA0000000000000000001",
        answers: { q2: "yes" },
      }),
      {
        ...toolCall("01HEVTA0000000000000000003", "file_read"),
        source: { raw: { envelope_ref: "missing", authorization: "Bearer secret-token" } },
      },
    ]),
    { mode: "strict" },
  );
  const codes = result.diagnostics.map((diagnostic) => diagnostic.code);

  expect(codes).toContain("unknown_user_query_answer_key");
  expect(codes).toContain("source_raw_envelope_ref_unresolved");
  expect(codes).toContain("source_raw_unredacted_secret");
});
