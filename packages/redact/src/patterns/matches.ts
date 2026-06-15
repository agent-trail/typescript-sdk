import type { RedactionSummary } from "../public/types.js";

export type AllowedMatchSet = {
  matches: RegExpMatchArray[];
  skipped: number;
};

export function allowedMatches(
  text: string,
  regex: RegExp,
  allowedSecrets: ReadonlySet<string>,
): AllowedMatchSet {
  regex.lastIndex = 0;
  const allMatches = Array.from(text.matchAll(regex));
  const matches = allMatches.filter((match) => !allowedSecrets.has(match[0] ?? ""));
  return { matches, skipped: allMatches.length - matches.length };
}

export function recordAllowlistedSkips(summary: RedactionSummary, skipped: number): void {
  if (skipped <= 0) return;
  summary.counts.allowlisted_skip = (summary.counts.allowlisted_skip ?? 0) + skipped;
}
