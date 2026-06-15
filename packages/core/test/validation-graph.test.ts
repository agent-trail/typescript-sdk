import { expect, test } from "bun:test";
import { computeContentHashes, stampContentHashes, validateTrailJsonl } from "../src/index.ts";
import {
  agentMessage,
  baseEnvelope,
  baseHeader,
  event,
  jsonl,
  toolCall,
  toolResult,
  trail,
  userMessage,
} from "./helpers";

async function diagnosticCodes(records: unknown[], mode: "strict" | "tolerant" = "strict") {
  const result = await validateTrailJsonl(jsonl(records), { mode });
  return result.diagnostics.map((diagnostic) => diagnostic.code);
}

test("accepts multi-session trails with independent parent scopes", async () => {
  const result = await validateTrailJsonl(
    jsonl([
      baseHeader,
      userMessage("01HEVTA0000000000000000001"),
      {
        ...baseHeader,
        id: "01HSESS0000000000000000002",
        session_uid: "01HZZZZZZZZZZZZZZZZZZZZZ02",
      },
      agentMessage("01HEVTA0000000000000000002"),
    ]),
    { mode: "strict" },
  );

  expect(result.ok).toBe(true);
  expect(result.diagnostics).toEqual([]);
});

test("keeps parent ids scoped to their session group", async () => {
  const codes = await diagnosticCodes([
    baseHeader,
    userMessage("01HEVTA0000000000000000001"),
    {
      ...baseHeader,
      id: "01HSESS0000000000000000002",
      session_uid: "01HZZZZZZZZZZZZZZZZZZZZZ02",
    },
    agentMessage("01HEVTA0000000000000000002", "child", "01HEVTA0000000000000000001"),
  ]);

  expect(codes).toContain("unknown_parent_id");
});

test("reports segment sequence drift within a session uid", async () => {
  const codes = await diagnosticCodes([
    { ...baseHeader, segment: { seq: 2 } },
    {
      ...baseHeader,
      id: "01HSESS0000000000000000002",
      segment: { seq: 1 },
    },
    {
      ...baseHeader,
      id: "01HSESS0000000000000000003",
      segment: { seq: 1 },
    },
  ]);

  expect(codes).toContain("out_of_order_segment_seq");
  expect(codes).toContain("duplicate_segment_seq");
});

test("does not warn for child timestamps equal to or later than parent timestamps", async () => {
  const result = await validateTrailJsonl(
    jsonl([
      baseHeader,
      event("user_message", "01HEVTA0000000000000000001", "2026-05-17T14:00:01.000Z", {
        text: "parent",
      }),
      event(
        "agent_message",
        "01HEVTA0000000000000000002",
        "2026-05-17T14:00:01.000Z",
        { text: "same time" },
        "01HEVTA0000000000000000001",
      ),
      event(
        "agent_message",
        "01HEVTA0000000000000000003",
        "2026-05-17T14:00:02.000Z",
        { text: "later" },
        "01HEVTA0000000000000000001",
      ),
    ]),
    { mode: "strict" },
  );

  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
    "non_monotonic_event_ts",
  );
});

test("does not compare parent ordering when timestamps are invalid", async () => {
  const result = await validateTrailJsonl(
    jsonl([
      baseHeader,
      event("user_message", "01HEVTA0000000000000000001", "not-a-time", { text: "parent" }),
      event(
        "agent_message",
        "01HEVTA0000000000000000002",
        "2026-05-17T14:00:00.000Z",
        { text: "child" },
        "01HEVTA0000000000000000001",
      ),
    ]),
    { mode: "strict" },
  );

  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({ code: "schema", path: "/ts" }),
  );
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
    "non_monotonic_event_ts",
  );
});

test("reports all members of self and multi-node parent cycles", async () => {
  const self = await diagnosticCodes([
    baseHeader,
    userMessage("01HEVTA0000000000000000001", "self", "01HEVTA0000000000000000001"),
  ]);
  const multi = await validateTrailJsonl(
    jsonl([
      baseHeader,
      userMessage("01HEVTA0000000000000000001", "a", "01HEVTA0000000000000000003"),
      userMessage("01HEVTA0000000000000000002", "b", "01HEVTA0000000000000000001"),
      userMessage("01HEVTA0000000000000000003", "c", "01HEVTA0000000000000000002"),
    ]),
    { mode: "strict" },
  );

  expect(self).toContain("parent_cycle");
  expect(multi.diagnostics.filter((diagnostic) => diagnostic.code === "parent_cycle")).toHaveLength(
    3,
  );
});

test("reports disjoint parent cycles in the same group", async () => {
  const result = await validateTrailJsonl(
    jsonl([
      baseHeader,
      userMessage("01HEVTA0000000000000000001", "a", "01HEVTA0000000000000000002"),
      userMessage("01HEVTA0000000000000000002", "b", "01HEVTA0000000000000000001"),
      userMessage("01HEVTA0000000000000000003", "c", "01HEVTA0000000000000000004"),
      userMessage("01HEVTA0000000000000000004", "d", "01HEVTA0000000000000000003"),
    ]),
    { mode: "strict" },
  );

  expect(
    result.diagnostics.filter((diagnostic) => diagnostic.code === "parent_cycle"),
  ).toHaveLength(4);
});

test("reports content hash mismatch by mode and invalid syntax as error", async () => {
  const parsed = await trail([baseHeader, userMessage("01HEVTA0000000000000000001")]);
  const validHash = computeContentHashes(parsed).sessionHashes[0]?.hash;
  const strictMismatch = await validateTrailJsonl(
    jsonl([
      { ...baseHeader, content_hash: "a".repeat(64) },
      userMessage("01HEVTA0000000000000000001"),
    ]),
    { mode: "strict" },
  );
  const tolerantMismatch = await validateTrailJsonl(
    jsonl([
      { ...baseHeader, content_hash: "a".repeat(64) },
      userMessage("01HEVTA0000000000000000001"),
    ]),
    { mode: "tolerant" },
  );
  const invalid = await validateTrailJsonl(jsonl([{ ...baseHeader, content_hash: "deadbeef" }]), {
    mode: "tolerant",
  });
  const match = await validateTrailJsonl(
    jsonl([{ ...baseHeader, content_hash: validHash }, userMessage("01HEVTA0000000000000000001")]),
    { mode: "strict" },
  );

  expect(strictMismatch.diagnostics).toContainEqual(
    expect.objectContaining({ code: "content_hash_mismatch", severity: "error" }),
  );
  expect(tolerantMismatch.diagnostics).toContainEqual(
    expect.objectContaining({ code: "content_hash_mismatch", severity: "warning" }),
  );
  expect(invalid.diagnostics).toContainEqual(
    expect.objectContaining({ code: "content_hash_invalid", severity: "error" }),
  );
  expect(match.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
    "content_hash_mismatch",
  );
});

test("reports envelope content hash mismatch and accepts stamped file hashes", async () => {
  const parsed = await trail([baseEnvelope, baseHeader]);
  const stamped = stampContentHashes(parsed);
  const mismatch = await validateTrailJsonl(
    jsonl([{ ...baseEnvelope, content_hash: "a".repeat(64) }, baseHeader]),
    { mode: "strict" },
  );
  const valid = await validateTrailJsonl(stamped.jsonl, { mode: "strict" });

  expect(mismatch.diagnostics).toContainEqual(
    expect.objectContaining({ code: "content_hash_mismatch", path: "/content_hash" }),
  );
  expect(valid.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
    "content_hash_mismatch",
  );
});

test("preserves streaming warnings and hash mismatch severity in tolerant mode", async () => {
  const result = await validateTrailJsonl(
    jsonl([
      { ...baseHeader, stream: { state: "open" }, content_hash: "a".repeat(64) },
      event("session_end", "01HEVTA0000000000000000001", "2026-05-17T14:00:01.000Z", {
        reason: "complete",
      }),
    ]),
    { mode: "tolerant" },
  );
  const codes = result.diagnostics.map((diagnostic) => diagnostic.code);

  expect(codes).toContain("stream_open_with_content_hash");
  expect(codes).toContain("stream_open_with_terminal_event");
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({ code: "content_hash_mismatch", severity: "warning" }),
  );
});

test("does not warn for open stream with pending hash and no terminal event", async () => {
  const result = await validateTrailJsonl(
    jsonl([{ ...baseHeader, stream: { state: "open" }, content_hash: "<pending>" }]),
    { mode: "strict" },
  );

  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
    "stream_open_with_content_hash",
  );
});

test("validates parse_fidelity against quarantined records and terminal reason", async () => {
  const valid = await validateTrailJsonl(
    jsonl([
      {
        ...baseHeader,
        parse_fidelity: { quarantined_count: 1, termination_reason: "process_terminated" },
      },
      event("system_event", "01HEVTA0000000000000000001", "2026-05-17T14:00:01.000Z", {
        kind: "x-codex/unknown_record",
        data: { raw: "{}" },
      }),
      event("session_terminated", "01HEVTA0000000000000000002", "2026-05-17T14:00:02.000Z", {
        reason: "process_terminated",
      }),
    ]),
    { mode: "strict" },
  );
  const drift = await diagnosticCodes([
    { ...baseHeader, parse_fidelity: { quarantined_count: 0 } },
    event("system_event", "01HEVTA0000000000000000001", "2026-05-17T14:00:01.000Z", {
      kind: "x-codex/unknown_record",
      data: { raw: "{}" },
    }),
  ]);
  const reasonDrift = await validateTrailJsonl(
    jsonl([
      {
        ...baseHeader,
        parse_fidelity: { quarantined_count: 0, termination_reason: "process_terminated" },
      },
    ]),
    { mode: "strict" },
  );

  expect(valid.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
    "parse_fidelity_drift",
  );
  expect(drift).toContain("parse_fidelity_drift");
  expect(reasonDrift.diagnostics).toContainEqual(
    expect.objectContaining({
      code: "parse_fidelity_drift",
      path: "/parse_fidelity/termination_reason",
    }),
  );
});

test("reports branch references that do not point to prior events", async () => {
  const codes = await diagnosticCodes([
    baseHeader,
    event("branch_point", "01HEVTA0000000000000000001", "2026-05-17T14:00:01.000Z", {
      from_id: "01HEVTA0000000000000000999",
    }),
    event("branch_summary", "01HEVTA0000000000000000002", "2026-05-17T14:00:02.000Z", {
      abandoned_branch_id: "01HEVTA0000000000000000998",
      summary: "done",
    }),
  ]);

  expect(codes).toContain("unknown_branch_point_from_id");
  expect(codes).toContain("unknown_abandoned_branch_id");
});

test("keeps tool result pairing scoped per session group", async () => {
  const codes = await diagnosticCodes([
    baseHeader,
    toolCall("01HEVTA0000000000000000001"),
    {
      ...baseHeader,
      id: "01HSESS0000000000000000002",
      session_uid: "01HZZZZZZZZZZZZZZZZZZZZZ02",
    },
    toolResult("01HEVTA0000000000000000002", "01HEVTA0000000000000000001"),
  ]);

  expect(codes).toContain("unmatched_tool_call_at_eof");
});

test("resolves source.raw envelope_ref only against prior ids", async () => {
  const valid = await diagnosticCodes([
    baseHeader,
    userMessage("01HEVTA0000000000000000001"),
    {
      ...toolCall("01HEVTA0000000000000000002"),
      source: { raw: { envelope_ref: "01HEVTA0000000000000000001" } },
    },
  ]);
  const forward = await diagnosticCodes([
    baseHeader,
    {
      ...toolCall("01HEVTA0000000000000000001"),
      source: { raw: { envelope_ref: "01HEVTA0000000000000000002" } },
    },
    userMessage("01HEVTA0000000000000000002"),
  ]);

  expect(valid).not.toContain("source_raw_envelope_ref_unresolved");
  expect(forward).toContain("source_raw_envelope_ref_unresolved");
});

test("reports secret-looking tool args and source raw values", async () => {
  const codes = await diagnosticCodes([
    baseHeader,
    {
      ...toolCall("01HEVTA0000000000000000001"),
      payload: { tool: "web_fetch", args: { headers: { authorization: "Bearer secret-token" } } },
      source: { raw: { command: "curl -H 'api_key=secret-token'" } },
    },
  ]);

  expect(codes).toContain("tool_args_unredacted_secret");
  expect(codes).toContain("source_raw_unredacted_secret");
});

test("reports fine-grained GitHub personal access tokens as unredacted secrets", async () => {
  const token = ["github", "pat", "A".repeat(24)].join("_");
  const result = await validateTrailJsonl(
    jsonl([
      baseHeader,
      {
        type: "tool_call",
        id: "01HEVTA0000000000000000099",
        ts: "2026-05-17T14:00:01.000Z",
        payload: { tool: "web_fetch", args: { headers: { authorization: token } } },
        source: { raw: { output: token } },
      },
    ]),
  );
  const codes = result.diagnostics.map((d) => d.code);
  expect(codes).toContain("tool_args_unredacted_secret");
  expect(codes).toContain("source_raw_unredacted_secret");
});

test("reports envelope session manifest drift and accepts matching manifests", async () => {
  const matching = await diagnosticCodes([
    { ...baseEnvelope, sessions: [{ id: baseHeader.id, agent: baseHeader.agent.name }] },
    baseHeader,
  ]);
  const mismatched = await diagnosticCodes([
    { ...baseEnvelope, sessions: [{ id: "01HSESS0000000000000000999", agent: "other" }] },
    baseHeader,
  ]);

  expect(matching).not.toContain("envelope_sessions_manifest_drift");
  expect(mismatched).toContain("envelope_sessions_manifest_drift");
});

test("reports final_message_id that is missing or points forward", async () => {
  const missing = await diagnosticCodes([
    baseHeader,
    event("session_end", "01HEVTA0000000000000000001", "2026-05-17T14:00:01.000Z", {
      reason: "complete",
      final_message_id: "01HEVTA0000000000000000999",
    }),
  ]);
  const forward = await diagnosticCodes([
    baseHeader,
    event("session_end", "01HEVTA0000000000000000001", "2026-05-17T14:00:01.000Z", {
      reason: "complete",
      final_message_id: "01HEVTA0000000000000000002",
    }),
    agentMessage("01HEVTA0000000000000000002"),
  ]);

  expect(missing).toContain("unknown_final_message_id");
  expect(forward).toContain("unknown_final_message_id");
});
