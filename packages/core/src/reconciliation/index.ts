import { stampContentHashes } from "../hashing.js";
import type { ParsedTrail, ReconciliationResult } from "../index.js";
import { mergeSegments } from "./merge.js";
import { buildSegmentPlan } from "./segment-plan/index.js";

export function reconcileSegments(inputs: ParsedTrail[]): ReconciliationResult {
  const plan = buildSegmentPlan(inputs);
  const output = [...plan.passThrough];

  for (const group of plan.mergeGroups) {
    const merged = mergeSegments(group.trails);
    output.push(group.shouldFinalize ? stampContentHashes(merged).trail : merged);
  }

  return { trails: output, diagnostics: plan.diagnostics };
}
