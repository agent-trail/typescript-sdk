import { expect, test } from "bun:test";
import { redactTrailJsonl } from "../src/index.ts";

const header = {
  type: "session",
  schema_version: "0.1.0",
  id: "01HSESS0000000000000000001",
  ts: "2026-05-17T14:00:00.000Z",
  agent: { name: "codex-cli" },
};

function jsonl(records: unknown[]): string {
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

function openAiApiKeyFixture(): string {
  return [
    "sk",
    "proj",
    "AbCdEfGhIjKlMnOpQrStUv0123456789",
    "_AbCdEfGhIjKlMnOpQrStUv0123456789",
  ].join("-");
}

test("redactTrailJsonl redacts secrets and reports mutation accounting", async () => {
  const key = openAiApiKeyFixture();
  const result = await redactTrailJsonl(
    jsonl([
      header,
      {
        type: "agent_message",
        id: "01HEVTA0000000000000000001",
        ts: "2026-05-17T14:00:01.000Z",
        payload: { text: `key ${key}` },
      },
    ]),
  );

  expect(result.jsonl).toContain("[OPENAI_KEY]");
  expect(result.jsonl).not.toContain(key);
  expect(result.summary.counts).toEqual({ openai_api_key: 1 });
  expect(result.trail.groups[0]?.events[0]?.record).toHaveProperty("meta", {
    redaction_count: 1,
  });
});

test("redactTrailJsonl strips unresolved secret user query answers", async () => {
  const result = await redactTrailJsonl(
    jsonl([
      header,
      {
        type: "user_query_response",
        id: "01HEVTA0000000000000000002",
        ts: "2026-05-17T14:00:02.000Z",
        payload: { for_id: "missing", answers: { token: "hunter2" } },
      },
    ]),
  );

  expect(result.jsonl).not.toContain("hunter2");
  expect(result.summary.counts.user_query_response_unresolved_answers_stripped).toBe(1);
});

test("redactTrailJsonl counts user query id and answer key mutations", async () => {
  const key = openAiApiKeyFixture();
  const result = await redactTrailJsonl(
    jsonl([
      header,
      {
        type: "user_query",
        id: "01HEVTA0000000000000000001",
        ts: "2026-05-17T14:00:01.000Z",
        payload: {
          questions: [{ id: key, question: "Continue?" }],
        },
      },
      {
        type: "user_query_response",
        id: "01HEVTA0000000000000000002",
        ts: "2026-05-17T14:00:02.000Z",
        payload: {
          for_id: "01HEVTA0000000000000000001",
          answers: { [key]: { selected: ["yes"] } },
        },
      },
    ]),
  );

  expect(result.summary.counts.openai_api_key).toBe(2);
  expect(result.trail.groups[0]?.events[0]?.record).toHaveProperty("meta", {
    redaction_count: 1,
  });
  expect(result.trail.groups[0]?.events[1]?.record).toHaveProperty("meta", {
    redaction_count: 1,
  });
});

test("redactTrailJsonl redacts extra payload fields on known event types", async () => {
  const key = openAiApiKeyFixture();
  const result = await redactTrailJsonl(
    jsonl([
      header,
      {
        type: "user_message",
        id: "01HEVTA0000000000000000003",
        ts: "2026-05-17T14:00:03.000Z",
        payload: { text: "hello", secret: key },
      },
    ]),
  );

  expect(result.jsonl).not.toContain(key);
  expect(result.summary.counts.openai_api_key).toBe(1);
});

test("redactTrailJsonl visits known payload fields once when allowlisted", async () => {
  const key = openAiApiKeyFixture();
  const result = await redactTrailJsonl(
    jsonl([
      header,
      {
        type: "user_message",
        id: "01HEVTA0000000000000000004",
        ts: "2026-05-17T14:00:04.000Z",
        payload: { text: key },
      },
    ]),
    { allowedSecrets: [key] },
  );

  expect(result.summary.counts.allowlisted_skip).toBe(1);
});

test("redactTrailJsonl keeps literal allowlisted email tokens intact", async () => {
  const result = await redactTrailJsonl(
    jsonl([
      header,
      {
        type: "user_message",
        id: "01HEVTA0000000000000000005",
        ts: "2026-05-17T14:00:05.000Z",
        payload: {
          text: "__AGENT_TRAIL_EMAIL_ALLOWLIST_0__ actions@github.com leak@example.com",
        },
      },
    ]),
    { pii: { email: true } },
  );

  expect(result.jsonl).toContain("__AGENT_TRAIL_EMAIL_ALLOWLIST_0__");
  expect(result.jsonl).toContain("actions@github.com");
  expect(result.jsonl).not.toContain("leak@example.com");
});

test("redactTrailJsonl does not skip colliding payload paths", async () => {
  const key = openAiApiKeyFixture();
  const result = await redactTrailJsonl(
    jsonl([
      header,
      {
        type: "user_message",
        id: "01HEVTA0000000000000000005",
        ts: "2026-05-17T14:00:05.000Z",
        payload: { "a.b": "clean", a: { b: key } },
      },
    ]),
  );

  expect(result.jsonl).not.toContain(key);
  expect(result.summary.counts.openai_api_key).toBe(1);
});

test("redactTrailJsonl strips malformed secret user query answers", async () => {
  const result = await redactTrailJsonl(
    jsonl([
      header,
      {
        type: "user_query",
        id: "01HEVTA0000000000000000004",
        ts: "2026-05-17T14:00:04.000Z",
        payload: {
          questions: [{ id: "secret_q", question: "Token?", is_secret: true }],
        },
      },
      {
        type: "user_query_response",
        id: "01HEVTA0000000000000000005",
        ts: "2026-05-17T14:00:05.000Z",
        payload: {
          for_id: "01HEVTA0000000000000000004",
          answers: { secret_q: "TOPSECRET" },
        },
      },
    ]),
  );

  expect(result.jsonl).not.toContain("TOPSECRET");
  expect(result.summary.counts.user_query_secret_answer).toBe(1);
});

test("redactTrailJsonl strips scalar secret user query answers and source raw", async () => {
  const result = await redactTrailJsonl(
    jsonl([
      header,
      {
        type: "user_query",
        id: "01HEVTA0000000000000000006",
        ts: "2026-05-17T14:00:06.000Z",
        payload: {
          questions: [{ id: "secret_q", question: "Token?", is_secret: true }],
        },
      },
      {
        type: "user_query_response",
        id: "01HEVTA0000000000000000007",
        ts: "2026-05-17T14:00:07.000Z",
        source: { raw: "swordfish raw" },
        payload: {
          for_id: "01HEVTA0000000000000000006",
          answers: "swordfish",
        },
      },
    ]),
  );

  expect(result.jsonl).not.toContain("swordfish");
  expect(result.summary.counts.user_query_secret_answer).toBe(1);
  expect(result.summary.counts.user_query_secret_source_raw).toBe(1);
});

test("redactTrailJsonl strips secret user query answer objects with extra fields", async () => {
  const result = await redactTrailJsonl(
    jsonl([
      header,
      {
        type: "user_query",
        id: "01HEVTA0000000000000000008",
        ts: "2026-05-17T14:00:08.000Z",
        payload: {
          questions: [{ id: "secret_q", question: "Token?", is_secret: true }],
        },
      },
      {
        type: "user_query_response",
        id: "01HEVTA0000000000000000009",
        ts: "2026-05-17T14:00:09.000Z",
        payload: {
          for_id: "01HEVTA0000000000000000008",
          answers: { secret_q: { selected: [], value: "swordfish" } },
        },
      },
    ]),
  );

  expect(result.jsonl).not.toContain("swordfish");
  expect(result.summary.counts.user_query_secret_answer).toBe(1);
});

test("redactTrailJsonl redacts parse error source text", async () => {
  const key = openAiApiKeyFixture();
  const result = await redactTrailJsonl(`{bad ${key}\n`);

  expect(result.jsonl).not.toContain(key);
  expect(result.summary.counts.openai_api_key).toBe(1);
});

test("redactTrailJsonl redacts non-object parse error values", async () => {
  const key = openAiApiKeyFixture();
  const result = await redactTrailJsonl(`${JSON.stringify([key])}\n`);

  expect(result.jsonl).not.toContain(key);
  expect(result.summary.counts.openai_api_key).toBe(1);
});
