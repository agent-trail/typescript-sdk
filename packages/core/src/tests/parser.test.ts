import { expect, test } from "bun:test";
import { type ParsedTrail, parseTrailJsonl, validateTrailJsonl } from "../index.ts";
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
    record: { type: "x-parse-error", code: "invalid_json", raw: '{"bad":' },
  });
  expect(parsed.records[2]).toEqual({
    line: 3,
    record: { type: "x-parse-error", code: "non_object", value: [] },
  });
});

test("preserves blank JSONL lines as parse errors except the final trailing newline", async () => {
  const result = await validateTrailJsonl(`${JSON.stringify(baseHeader)}\n\n`, {
    mode: "strict",
  });

  expect(result.ok).toBe(false);
  expect(result.trail.records[1]).toEqual({
    line: 2,
    record: { type: "x-parse-error", code: "empty_line", raw: "" },
  });
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({ line: 2, code: "empty_line", severity: "error" }),
  );
});

test("preserves invalid UTF-8 byte chunks as parse errors", async () => {
  const prefix = `${JSON.stringify(baseHeader)}\n`;
  const invalidBytes = new Uint8Array([0x7b, 0x22, 0x62, 0x61, 0x64, 0xff]);
  const result = await validateTrailJsonl(chunks([prefix, invalidBytes]), { mode: "strict" });

  expect(result.ok).toBe(false);
  expect(result.trail.records[1]).toEqual({
    line: 2,
    record: { type: "x-parse-error", code: "invalid_utf8" },
  });
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({ line: 2, code: "invalid_utf8", severity: "error" }),
  );
});

test("preserves valid byte lines around an invalid UTF-8 line", async () => {
  const encoder = new TextEncoder();
  const input = new Uint8Array([
    ...encoder.encode(`${JSON.stringify(baseHeader)}\n`),
    ...new Uint8Array([0x7b, 0x22, 0x62, 0x61, 0x64, 0xff, 0x0a]),
    ...encoder.encode(`${JSON.stringify(userMessage("01HEVTA0000000000000000001"))}\n`),
  ]);
  const parsed = await parseTrailJsonl(chunks([input]));

  expect(parsed.records.map((record) => record.record.type)).toEqual([
    "session",
    "x-parse-error",
    "user_message",
  ]);
  expect(parsed.records[1]).toEqual({
    line: 2,
    record: { type: "x-parse-error", code: "invalid_utf8" },
  });
  expect(parsed.groups[0]?.events.map((event) => event.record.type)).toEqual([
    "x-parse-error",
    "user_message",
  ]);
});

test("does not duplicate parse errors when invalid bytes are followed by string newline", async () => {
  const input = chunks([
    `${JSON.stringify(baseHeader)}\n`,
    new Uint8Array([0x7b, 0x22, 0x62, 0x61, 0x64, 0xff]),
    `\n${JSON.stringify(userMessage("01HEVTA0000000000000000001"))}\n`,
  ]);
  const parsed = await parseTrailJsonl(input);

  expectInvalidUtf8ThenUserMessage(parsed);
});

test("recovers when invalid byte discard is closed by a later byte newline", async () => {
  const encoder = new TextEncoder();
  const trailing = `\n${JSON.stringify(userMessage("01HEVTA0000000000000000001"))}\n`;
  const parsed = await parseTrailJsonl(
    chunks([
      `${JSON.stringify(baseHeader)}\n`,
      new Uint8Array([0x7b, 0x22, 0x62, 0x61, 0x64, 0xff]),
      "still invalid",
      encoder.encode(trailing),
    ]),
  );

  expectInvalidUtf8ThenUserMessage(parsed);
});

test("tolerant validation keeps parser error diagnostics as errors", async () => {
  const invalidJson = await validateTrailJsonl(`${JSON.stringify(baseHeader)}\n{"bad":\n`, {
    mode: "tolerant",
  });
  const blankLine = await validateTrailJsonl(`${JSON.stringify(baseHeader)}\n\n`, {
    mode: "tolerant",
  });
  const invalidUtf8 = await validateTrailJsonl(
    chunks([
      `${JSON.stringify(baseHeader)}\n`,
      new Uint8Array([0x7b, 0x22, 0x62, 0x61, 0x64, 0xff]),
    ]),
    { mode: "tolerant" },
  );

  expect(invalidJson.diagnostics).toContainEqual(
    expect.objectContaining({ line: 2, code: "invalid_json", severity: "error" }),
  );
  expect(blankLine.diagnostics).toContainEqual(
    expect.objectContaining({ line: 2, code: "empty_line", severity: "error" }),
  );
  expect(invalidUtf8.diagnostics).toContainEqual(
    expect.objectContaining({ line: 2, code: "invalid_utf8", severity: "error" }),
  );
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

function expectInvalidUtf8ThenUserMessage(parsed: ParsedTrail): void {
  expect(parsed.records.map((record) => [record.line, record.record.type])).toEqual([
    [1, "session"],
    [2, "x-parse-error"],
    [3, "user_message"],
  ]);
  expect(parsed.records[1]?.record).toEqual({ type: "x-parse-error", code: "invalid_utf8" });
}
