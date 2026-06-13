import { expect, test } from "bun:test";
import { validateTrailJsonl } from "../src/index.ts";
import { baseHeader, event, jsonl, toolCall } from "./helpers";

async function diagnostics(records: unknown[], mode: "strict" | "tolerant" = "strict") {
  return (await validateTrailJsonl(jsonl(records), { mode })).diagnostics;
}

test("reader tolerant mode warns for unknown payload fields but keeps strict payload errors", async () => {
  const futureField = await diagnostics(
    [
      baseHeader,
      event("user_message", "01HEVTA0000000000000000001", "2026-05-17T14:00:01.000Z", {
        text: "hello",
        future_field: true,
      }),
    ],
    "tolerant",
  );
  const missingRequired = await diagnostics(
    [
      baseHeader,
      event("user_message", "01HEVTA0000000000000000001", "2026-05-17T14:00:01.000Z", {}),
    ],
    "tolerant",
  );

  expect(futureField).toContainEqual(
    expect.objectContaining({
      code: "reader_tolerant_unknown_payload_field",
      path: "/payload/future_field",
      severity: "warning",
    }),
  );
  expect(missingRequired).toContainEqual(
    expect.objectContaining({ code: "schema", severity: "error" }),
  );
});

test("reader tolerant mode preserves unknown future records", async () => {
  const result = await validateTrailJsonl(
    jsonl([
      baseHeader,
      {
        type: "x-vendor/future_event",
        id: "01HEVTA0000000000000000001",
        ts: "2026-05-17T14:00:01.000Z",
        payload: { any: "thing" },
      },
    ]),
    { mode: "tolerant" },
  );

  expect(result.trail.groups[0]?.events[0]?.record.type).toBe("x-vendor/future_event");
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({ code: "reader_tolerant_unknown_record", severity: "warning" }),
  );
});

test("strict errors and tolerant warns for ill formed strings", async () => {
  const records = [
    baseHeader,
    event("user_message", "01HEVTA0000000000000000001", "2026-05-17T14:00:01.000Z", {
      text: "\ud800",
    }),
  ];
  const strict = await diagnostics(records, "strict");
  const tolerant = await diagnostics(records, "tolerant");

  expect(strict).toContainEqual(
    expect.objectContaining({ code: "ill_formed_string", severity: "error" }),
  );
  expect(tolerant).toContainEqual(
    expect.objectContaining({ code: "ill_formed_string", severity: "warning" }),
  );
});

test("warns for unsafe interoperable numbers", async () => {
  const result = await diagnostics([
    baseHeader,
    {
      ...toolCall("01HEVTA0000000000000000001"),
      source: { raw: { count: Number.MAX_SAFE_INTEGER + 2 } },
    },
  ]);

  expect(result).toContainEqual(
    expect.objectContaining({ code: "non_interoperable_number", severity: "warning" }),
  );
});

test("reports source.raw soft and hard size caps", async () => {
  const soft = await diagnostics([
    baseHeader,
    {
      ...toolCall("01HEVTA0000000000000000001"),
      source: { raw: { body: "x".repeat(9 * 1024) } },
    },
  ]);
  const hard = await diagnostics([
    baseHeader,
    {
      ...toolCall("01HEVTA0000000000000000001"),
      source: { raw: { body: "x".repeat(33 * 1024) } },
    },
  ]);

  expect(soft).toContainEqual(
    expect.objectContaining({ code: "source_raw_oversized", severity: "warning" }),
  );
  expect(hard).toContainEqual(
    expect.objectContaining({ code: "source_raw_oversized_hard", severity: "error" }),
  );
});

test("reports credential-keyed source.raw and tool arg values", async () => {
  const result = await diagnostics([
    baseHeader,
    {
      ...toolCall("01HEVTA0000000000000000001"),
      payload: { tool: "mcp_call", args: { headers: { api_key: "secret-token" } } },
      source: { raw: { password: "secret-token" } },
    },
  ]);

  expect(result).toContainEqual(
    expect.objectContaining({ code: "source_raw_unredacted_secret", path: "/source/raw/password" }),
  );
  expect(result).toContainEqual(
    expect.objectContaining({
      code: "tool_args_unredacted_secret",
      path: "/payload/args/headers/api_key",
    }),
  );
});

test("does not report already redacted credential placeholders", async () => {
  const result = await diagnostics([
    baseHeader,
    {
      ...toolCall("01HEVTA0000000000000000001"),
      payload: { tool: "mcp_call", args: { headers: { api_key: "<redacted>" } } },
      source: { raw: { password: "<redacted>" } },
    },
  ]);
  const codes = result.map((diagnostic) => diagnostic.code);

  expect(codes).not.toContain("source_raw_unredacted_secret");
  expect(codes).not.toContain("tool_args_unredacted_secret");
});

test("reports vcs remote URLs with credentials", async () => {
  const result = await diagnostics([
    {
      ...baseHeader,
      vcs: {
        type: "git",
        revision: "abc123",
        remote_url: "https://user:pass@example.com/repo.git",
      },
    },
  ]);

  expect(result).toContainEqual(
    expect.objectContaining({ code: "vcs_remote_url_with_credentials", severity: "warning" }),
  );
});

test("validates task plan and user query structural cases through schema and graph rules", async () => {
  const result = await diagnostics([
    baseHeader,
    event("task_plan_update", "01HEVTA0000000000000000001", "2026-05-17T14:00:01.000Z", {
      items: [{ id: "1", text: "ship", status: "bogus" }],
    }),
    event("user_query", "01HEVTA0000000000000000002", "2026-05-17T14:00:02.000Z", {
      questions: [
        { id: "q1", kind: "text", prompt: "Continue?" },
        { id: "q1", kind: "text", prompt: "Again?" },
      ],
    }),
    event("user_query_response", "01HEVTA0000000000000000003", "2026-05-17T14:00:03.000Z", {
      for_id: "01HEVTA0000000000000000999",
      answers: {},
    }),
  ]);
  const codes = result.map((diagnostic) => diagnostic.code);

  expect(codes).toContain("schema");
  expect(codes).toContain("duplicate_user_query_question_id");
  expect(codes).toContain("unknown_user_query_for_id");
});
