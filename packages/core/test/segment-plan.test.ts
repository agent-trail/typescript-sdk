import { expect, test } from "bun:test";
import { buildSegmentPlan } from "../src/reconciliation/segment-plan/index.ts";
import { agentMessage, baseHeader, trail, userMessage } from "./helpers";

test("segment plan separates pass-through trails and orders merge groups with diagnostics", async () => {
  const first = await trail([
    { ...baseHeader, segment: { seq: 1 } },
    userMessage("01HEVTA0000000000000000001", "one"),
  ]);
  const second = await trail([
    {
      ...baseHeader,
      id: "01HSESS0000000000000000002",
      segment: { seq: 2, prev_content_hash: "a".repeat(64) },
    },
    agentMessage("01HEVTA0000000000000000002", "two"),
  ]);
  const passThrough = await trail([
    { ...baseHeader, session_uid: undefined },
    userMessage("01HEVTA0000000000000000003", "single"),
  ]);

  const plan = buildSegmentPlan([second, passThrough, first]);

  expect(plan.passThrough).toEqual([passThrough]);
  expect(plan.mergeGroups).toHaveLength(1);
  expect(plan.mergeGroups[0]?.trails).toEqual([first, second]);
  expect(plan.mergeGroups[0]?.shouldFinalize).toBe(true);
  expect(plan.diagnostics).toContainEqual(expect.objectContaining({ code: "segment_chain_break" }));
});
