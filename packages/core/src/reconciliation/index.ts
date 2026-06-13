import { stampContentHashes } from "../hashing.js";
import type { ParsedTrail, ReconciliationResult, TrailDiagnostic } from "../index.js";
import { firstHeader, isJsonObject } from "../shared.js";
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

    const merged = mergeSegments(sorted);
    output.push(
      isOpenStream(firstHeader(merged)?.stream) ? merged : stampContentHashes(merged).trail,
    );
  }

  return { trails: output, diagnostics };
}

function isOpenStream(stream: unknown): boolean {
  return isJsonObject(stream) && stream.state === "open";
}
