import type { RedactionSummary } from "../public/types.js";

export function recordSummaryMutation(
  summary: RedactionSummary,
  maxSamples: number,
  patternId: string,
  location: string,
  before: string,
  after: string,
): void {
  summary.counts[patternId] = (summary.counts[patternId] ?? 0) + 1;
  if (summary.samples.length >= maxSamples) return;
  summary.samples.push({ patternId, location, before, after });
}

export function isSentinelRaw(value: unknown, sentinel: string): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    Object.keys(value).length === 1 &&
    (value as Record<string, unknown>).redacted === sentinel
  );
}
