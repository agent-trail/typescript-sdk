import { stampContentHashes } from "../hashing.js";
import type { ParsedTrail, ReconciliationResult, TrailDiagnostic } from "../index.js";
import { validateSegmentChain } from "./chain.js";
import { groupReconciliationInputs, sortSegments } from "./grouping.js";
import { mergeSegments } from "./merge.js";

export function reconcileSegments(inputs: ParsedTrail[]): ReconciliationResult {
  const diagnostics: TrailDiagnostic[] = [];
  const output: ParsedTrail[] = [];
  const grouped = groupReconciliationInputs(inputs, output);

  for (const trails of grouped.values()) {
    const sorted = sortSegments(trails);
    const chain = validateSegmentChain(sorted);
    diagnostics.push(...chain.diagnostics);

    output.push(...(chain.canMerge ? [stampContentHashes(mergeSegments(sorted)).trail] : sorted));
  }

  return { trails: output, diagnostics };
}
