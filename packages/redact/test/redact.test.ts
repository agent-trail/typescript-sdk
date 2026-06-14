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

test("redactTrailJsonl redacts secrets and reports mutation accounting", async () => {
  const key = "sk-proj-AbCdEfGhIjKlMnOpQrStUv0123456789-_AbCdEfGhIjKlMnOpQrStUv0123456789";
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
