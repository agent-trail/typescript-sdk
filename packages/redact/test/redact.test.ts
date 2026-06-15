import { expect, test } from "bun:test";
import { redactTrailJsonl } from "../src/index.ts";

const header = {
  type: "session",
  schema_version: "0.1.0",
  id: "01HSESS0000000000000000001",
  ts: "2026-05-17T14:00:00.000Z",
  agent: { name: "codex" },
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

test("redactTrailJsonl strips malformed unresolved user query answers", async () => {
  const result = await redactTrailJsonl(
    jsonl([
      header,
      {
        type: "user_query_response",
        id: "01HEVTA0000000000000000021",
        ts: "2026-05-17T14:00:21.000Z",
        source: { raw: "swordfish raw" },
        payload: { answers: "swordfish" },
      },
      {
        type: "user_query_response",
        id: "01HEVTA0000000000000000020",
        ts: "2026-05-17T14:00:20.000Z",
        source: { raw: "payload raw" },
        payload: "payload-secret",
      },
      {
        type: "user_query_response",
        id: "01HEVTA0000000000000000022",
        ts: "2026-05-17T14:00:22.000Z",
        payload: { for_id: "missing", answers: "swordfish" },
      },
      {
        type: "user_query_response",
        id: "01HEVTA0000000000000000023",
        ts: "2026-05-17T14:00:23.000Z",
        payload: { for_id: "missing", answers: ["hunter2"] },
      },
    ]),
  );

  expect(result.jsonl).not.toContain("swordfish");
  expect(result.jsonl).not.toContain("swordfish raw");
  expect(result.jsonl).not.toContain("payload-secret");
  expect(result.jsonl).not.toContain("payload raw");
  expect(result.jsonl).not.toContain("hunter2");
  expect(result.summary.counts.user_query_response_unresolved_answers_stripped).toBe(4);
  expect(result.summary.counts.user_query_response_unresolved_source_raw_stripped).toBe(2);
});

test("redactTrailJsonl strips malformed resolved user query answers", async () => {
  const result = await redactTrailJsonl(
    jsonl([
      header,
      {
        type: "user_query",
        id: "01HEVTA0000000000000000030",
        ts: "2026-05-17T14:00:30.000Z",
        payload: { questions: [{ id: "choice", question: "Pick?" }] },
      },
      {
        type: "user_query_response",
        id: "01HEVTA0000000000000000031",
        ts: "2026-05-17T14:00:31.000Z",
        source: { raw: "topsecret raw" },
        payload: { for_id: "01HEVTA0000000000000000030", answers: "topsecret" },
      },
      {
        type: "user_query_response",
        id: "01HEVTA0000000000000000032",
        ts: "2026-05-17T14:00:32.000Z",
        source: { raw: "array raw" },
        payload: { for_id: "01HEVTA0000000000000000030", answers: ["array-secret"] },
      },
    ]),
  );

  expect(result.jsonl).not.toContain("topsecret");
  expect(result.jsonl).not.toContain("topsecret raw");
  expect(result.jsonl).not.toContain("array-secret");
  expect(result.jsonl).not.toContain("array raw");
  expect(result.summary.counts.user_query_response_unknown_answers_stripped).toBe(2);
  expect(result.summary.counts.user_query_response_unknown_source_raw_stripped).toBe(2);
});

test("redactTrailJsonl strips malformed resolved answers for invalid secret question metadata", async () => {
  const result = await redactTrailJsonl(
    jsonl([
      header,
      {
        type: "user_query",
        id: "01HEVTA0000000000000000033",
        ts: "2026-05-17T14:00:33.000Z",
        payload: { questions: [{ question: "Token?", is_secret: true }] },
      },
      {
        type: "user_query_response",
        id: "01HEVTA0000000000000000034",
        ts: "2026-05-17T14:00:34.000Z",
        source: { raw: "raw NO_PATTERN_SECRET_XYZ" },
        payload: {
          for_id: "01HEVTA0000000000000000033",
          answers: "NO_PATTERN_SECRET_XYZ",
        },
      },
    ]),
  );

  expect(result.jsonl).not.toContain("NO_PATTERN_SECRET_XYZ");
  expect(result.jsonl).not.toContain("raw NO_PATTERN_SECRET_XYZ");
  expect(result.summary.counts.user_query_response_unknown_answers_stripped).toBe(1);
  expect(result.summary.counts.user_query_response_unknown_source_raw_stripped).toBe(1);
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
  expect(result.summary.samples.map((sample) => sample.location).join("\n")).not.toContain(key);
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

test("redactTrailJsonl ignores malformed null payloads without crashing", async () => {
  const result = await redactTrailJsonl(
    jsonl([
      header,
      {
        type: "user_message",
        id: "01HEVTA0000000000000000010",
        ts: "2026-05-17T14:00:10.000Z",
        payload: null,
      },
    ]),
  );

  expect(result.trail.records[1]?.record).toHaveProperty("payload", null);
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

test("redactTrailJsonl preserves source text that looks like an allowlisted email token", async () => {
  const tokenLikeText = "__AGENT_TRAIL_EMAIL_ALLOWLIST_0__";
  const result = await redactTrailJsonl(
    jsonl([
      header,
      {
        type: "user_message",
        id: "01HEVTA0000000000000000011",
        ts: "2026-05-17T14:00:11.000Z",
        payload: {
          text: `${tokenLikeText} actions@github.com leak@example.com`,
        },
      },
    ]),
    { pii: { email: true } },
  );

  expect(result.jsonl).toContain(tokenLikeText);
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

test("redactTrailJsonl rewrites file attachment URIs and removes unresolved file URIs", async () => {
  const safeRef = `sha256:${"a".repeat(64)}` as const;
  const result = await redactTrailJsonl(
    jsonl([
      header,
      {
        type: "user_message",
        id: "01HEVTA0000000000000000012",
        ts: "2026-05-17T14:00:12.000Z",
        payload: {
          text: "see files",
          attachments: [
            { uri: "file:///tmp/keep.txt", name: "keep.txt" },
            { uri: "file:///tmp/drop.txt", name: "drop.txt" },
            { uri: { raw: "file:///Users/alice/secrets/prod.env" }, name: "bad.txt" },
            { uri: "https://example.com/remote.txt", name: "remote.txt" },
          ],
        },
      },
    ]),
    { attachmentUriRewrites: { "file:///tmp/keep.txt": safeRef } },
  );

  expect(result.jsonl).toContain(safeRef);
  expect(result.jsonl).not.toContain("file:///tmp/keep.txt");
  expect(result.jsonl).not.toContain("file:///tmp/drop.txt");
  expect(result.jsonl).not.toContain("/Users/alice/secrets/prod.env");
  expect(result.jsonl).toContain("https://example.com/remote.txt");
  expect(result.summary.counts.attachment_file_uri_rewritten).toBe(1);
  expect(result.summary.counts.attachment_file_uri_removed).toBe(2);
});

test("redactTrailJsonl strips unsafe overflow refs and preserves sha256 refs", async () => {
  const safeRef = `sha256:${"b".repeat(64)}`;
  const result = await redactTrailJsonl(
    jsonl([
      header,
      {
        type: "tool_result",
        id: "01HEVTA0000000000000000013",
        ts: "2026-05-17T14:00:13.000Z",
        payload: {
          call_id: "call-1",
          output: "first",
          overflow_ref: "/tmp/raw-output.txt",
        },
      },
      {
        type: "tool_result",
        id: "01HEVTA0000000000000000014",
        ts: "2026-05-17T14:00:14.000Z",
        payload: {
          call_id: "call-2",
          output: "second",
          overflow_ref: safeRef,
        },
      },
      {
        type: "tool_result",
        id: "01HEVTA0000000000000000019",
        ts: "2026-05-17T14:00:19.000Z",
        payload: {
          call_id: "call-3",
          output: "third",
          overflow_ref: { raw: "file:///Users/alice/secrets/prod.env" },
        },
      },
    ]),
  );

  expect(result.jsonl).not.toContain("/tmp/raw-output.txt");
  expect(result.jsonl).not.toContain("/Users/alice/secrets/prod.env");
  expect(result.jsonl).toContain(safeRef);
  expect(result.summary.counts.overflow_ref_stripped).toBe(2);
});

test("redactTrailJsonl strips VCS repository identity by default", async () => {
  const result = await redactTrailJsonl(
    jsonl([
      {
        ...header,
        vcs: { remote_url: "https://github.com/private/repo.git", branch: "main" },
      },
      {
        type: "system_event",
        id: "01HEVTA0000000000000000015",
        ts: "2026-05-17T14:00:15.000Z",
        payload: { kind: "vcs_commit", data: { repo: "/private/repo", sha: "abc123" } },
      },
    ]),
  );

  expect(result.jsonl).not.toContain("https://github.com/private/repo.git");
  expect(result.jsonl).not.toContain("/private/repo");
  expect(result.jsonl).toContain('"branch":"main"');
  expect(result.summary.counts.vcs_remote_url).toBe(2);
  expect(result.trail.groups[0]?.events[0]?.record).toHaveProperty("meta", {
    redaction_count: 1,
  });
});

test("redactTrailJsonl can preserve VCS remote_url when explicitly requested", async () => {
  const result = await redactTrailJsonl(
    jsonl([
      {
        ...header,
        vcs: { remote_url: "https://github.com/public/repo.git", branch: "main" },
      },
    ]),
    { keepRemoteUrl: true },
  );

  expect(result.jsonl).toContain("https://github.com/public/repo.git");
  expect(result.summary.counts.vcs_remote_url).toBeUndefined();
});

test("redactTrailJsonl truncates tool output and user query answers", async () => {
  const result = await redactTrailJsonl(
    jsonl([
      header,
      {
        type: "tool_result",
        id: "01HEVTA0000000000000000016",
        ts: "2026-05-17T14:00:16.000Z",
        payload: { call_id: "call-1", output: "abcdefghijklmnopqrstuvwxyz" },
      },
      {
        type: "user_query",
        id: "01HEVTA0000000000000000017",
        ts: "2026-05-17T14:00:17.000Z",
        payload: { questions: [{ id: "choice", question: "Pick?" }] },
      },
      {
        type: "user_query_response",
        id: "01HEVTA0000000000000000018",
        ts: "2026-05-17T14:00:18.000Z",
        payload: {
          for_id: "01HEVTA0000000000000000017",
          answers: {
            choice: {
              selected: ["abcdefghijklmnopqrstuvwxyz"],
              other: "zyxwvutsrqponmlkjihgfedcba",
            },
          },
        },
      },
    ]),
    { outputMaxBytes: 18 },
  );

  expect(result.jsonl).toContain("[truncated]");
  expect(result.jsonl).not.toContain("abcdefghijklmnopqrstuvwxyz");
  expect(result.summary.counts.output_truncated).toBe(1);
  expect(result.summary.counts.user_query_answer_truncated).toBe(2);
});

test("redactTrailJsonl resets content hashes and rewrites segment lineage after changes", async () => {
  const stalePrevHash = "a".repeat(64);
  const key = openAiApiKeyFixture();
  const result = await redactTrailJsonl(
    jsonl([
      {
        ...header,
        id: "01HSESS0000000000000000100",
        session_uid: "session-uid",
        content_hash: stalePrevHash,
        segment: { seq: 1 },
      },
      {
        type: "user_message",
        id: "01HEVTA0000000000000000101",
        ts: "2026-05-17T14:00:01.000Z",
        payload: { text: key },
      },
      {
        ...header,
        id: "01HSESS0000000000000000102",
        session_uid: "session-uid",
        content_hash: "b".repeat(64),
        segment: { seq: 2, prev_content_hash: stalePrevHash },
      },
      {
        type: "agent_message",
        id: "01HEVTA0000000000000000103",
        ts: "2026-05-17T14:01:01.000Z",
        payload: { text: "done" },
      },
    ]),
  );

  const firstHeader = result.trail.groups[0]?.header.record as Record<string, unknown>;
  const secondHeader = result.trail.groups[1]?.header.record as Record<string, unknown>;
  const segment = secondHeader.segment as Record<string, unknown>;

  expect(firstHeader.content_hash).toBe("<pending>");
  expect(secondHeader.content_hash).toBe("<pending>");
  expect(segment.prev_content_hash).not.toBe(stalePrevHash);
  expect(segment.prev_content_hash).toMatch(/^[0-9a-f]{64}$/);
});

test("redactTrailJsonl counts dependency PII tokens and resets stale hashes", async () => {
  const result = await redactTrailJsonl(
    jsonl([
      {
        ...header,
        content_hash: "a".repeat(64),
      },
      {
        type: "user_message",
        id: "01HEVTA0000000000000000110",
        ts: "2026-05-17T14:00:01.000Z",
        payload: { text: "SSN 123-45-6789 and email john.smith@example.com." },
      },
    ]),
    { pii: { ssn: true, email: true } },
  );

  const outputHeader = result.trail.groups[0]?.header.record as Record<string, unknown>;

  expect(result.jsonl).toContain("[SSN]");
  expect(result.jsonl).toContain("[EMAIL]");
  expect(result.jsonl).not.toContain("123-45-6789");
  expect(result.jsonl).not.toContain("john.smith@example.com");
  expect(result.summary.counts.ssn_pii).toBeGreaterThan(0);
  expect(result.summary.counts.email_pii).toBeGreaterThan(0);
  expect(outputHeader.content_hash).toBe("<pending>");
  expect(result.trail.groups[0]?.events[0]?.record).toHaveProperty("meta", {
    redaction_count: expect.any(Number),
  });
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
