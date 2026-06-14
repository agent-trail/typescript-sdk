import { expect, test } from "bun:test";
import { deriveParseFidelity } from "../src/parse-fidelity/index.ts";
import { event, sessionTerminated, trail } from "./helpers";

test("derives parse fidelity from quarantined records and final termination", async () => {
  const parsed = await trail([
    {
      type: "session",
      schema_version: "0.1.0",
      id: "01HSESS0000000000000000001",
      ts: "2026-05-17T14:00:00.000Z",
      agent: { name: "codex-cli" },
    },
    event("system_event", "01HEVTA0000000000000000001", "2026-05-17T14:00:01.000Z", {
      kind: "x-codex/unknown_record",
      data: { raw: "{}" },
    }),
    sessionTerminated("01HEVTA0000000000000000002", "process_terminated"),
    sessionTerminated("01HEVTA0000000000000000003", "user_abort"),
  ]);

  expect(deriveParseFidelity(parsed.groups[0]?.events ?? [])).toEqual({
    quarantined_count: 1,
    termination_reason: "user_abort",
  });
});
