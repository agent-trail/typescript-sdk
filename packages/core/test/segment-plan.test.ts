import { expect, test } from "bun:test";
import { buildSegmentPlan } from "../src/reconciliation/segment-plan/index.ts";
import { baseHeader, brokenSegmentTrails, trail, userMessage } from "./helpers";

test("segment plan separates pass-through trails and orders merge groups with diagnostics", async () => {
  const [first, second] = await brokenSegmentTrails();
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
