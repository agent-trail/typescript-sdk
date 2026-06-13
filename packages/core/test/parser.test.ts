import { expect, test } from "bun:test";
import { parseTrailJsonl, validateTrailJsonl } from "../src/index.ts";
import { baseEnvelope, baseHeader, chunks, jsonl, userMessage } from "./helpers";

test("parses envelope, session group, events, and source line numbers", async () => {
  const parsed = await parseTrailJsonl(
    jsonl([baseEnvelope, baseHeader, userMessage("01HEVTA0000000000000000001")]),
  );

  expect(parsed.envelope?.line).toBe(1);
  expect(parsed.groups).toHaveLength(1);
  expect(parsed.groups[0]?.header.line).toBe(2);
  expect(parsed.groups[0]?.events.map((event) => event.line)).toEqual([3]);
  expect(parsed.records.map((record) => record.record.type)).toEqual([
    "trail",
    "session",
    "user_message",
  ]);
});

test("returns an empty trail for empty input and validation reports missing header", async () => {
  const parsed = await parseTrailJsonl("");
  const result = await validateTrailJsonl("", { mode: "strict" });

  expect(parsed).toEqual({ records: [], groups: [] });
  expect(result.ok).toBe(false);
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({ line: 1, path: "", code: "missing_header", severity: "error" }),
  );
});

test("preserves malformed JSON and non-object JSON as parser records", async () => {
  const parsed = await parseTrailJsonl('{"type":"session"}\n{"bad":\n[]\n');

  expect(parsed.records[1]).toEqual({
    line: 2,
    record: { type: "x-parse-error", raw: '{"bad":' },
  });
  expect(parsed.records[2]).toEqual({
    line: 3,
    record: { type: "x-parse-error", value: [] },
  });
});

test("propagates upstream async iterable errors unchanged", async () => {
  const upstream = new TypeError("upstream failed");

  await expect(parseTrailJsonl(throwingChunks(upstream))).rejects.toBe(upstream);
});

test("parses CRLF input and byte chunks split across line boundaries", async () => {
  const text = `${JSON.stringify(baseHeader)}\r\n${JSON.stringify(userMessage("01HEVTA0000000000000000001"))}\r\n`;
  const bytes = new TextEncoder().encode(text);
  const parsed = await parseTrailJsonl(
    chunks([bytes.slice(0, 11), bytes.slice(11, 47), bytes.slice(47)]),
  );

  expect(parsed.records).toHaveLength(2);
  expect(parsed.groups[0]?.events[0]?.record.type).toBe("user_message");
});

async function* throwingChunks(error: Error): AsyncIterable<string | Uint8Array> {
  yield JSON.stringify(baseHeader);
  throw error;
}
