import { expect, test } from "bun:test";
import { parseTrailJsonl, serializeTrailJsonl } from "../index.ts";
import { baseHeader, jsonl, userMessage } from "./helpers.ts";

test("serializes parsed trails as canonical JSONL", async () => {
  const trail = await parseTrailJsonl(
    jsonl([
      { ...baseHeader, meta: { z: 1, a: 2 } },
      userMessage("01HEVTA0000000000000000001", "hello"),
    ]),
  );

  expect(serializeTrailJsonl(trail)).toBe(
    '{"agent":{"name":"codex"},"id":"01HSESS0000000000000000001","meta":{"a":2,"z":1},"schema_version":"0.1.0","session_uid":"01HZZZZZZZZZZZZZZZZZZZZZ01","ts":"2026-05-17T14:00:00.000Z","type":"session"}\n{"id":"01HEVTA0000000000000000001","payload":{"text":"hello"},"ts":"2026-05-17T14:00:01.000Z","type":"user_message"}\n',
  );
});
