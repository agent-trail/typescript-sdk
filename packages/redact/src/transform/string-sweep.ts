import { allowedSecretSet, applyPattern } from "../config/rules.js";
import { applyCredentialContext, isOpaqueTokenVisit } from "../patterns/credential-context.js";
import { applyEntropyRedaction } from "../patterns/entropy.js";
import { applyPii } from "../patterns/pii.js";
import type { PiiConfig, RedactionPattern, RedactionSummary } from "../public/types.js";
import { addMutationCount } from "./mutation-accounting.js";
import type { Visit } from "./visits.js";

export function redactVisitedStrings(
  visits: Iterable<Visit>,
  userPatterns: RedactionPattern[],
  patterns: readonly RedactionPattern[],
  allowedSecrets: readonly string[],
  summary: RedactionSummary,
  maxSamples: number,
  redactionCounts: Map<number, number>,
  enableEntropyRedaction: boolean,
  pii: PiiConfig,
): void {
  const allowed = allowedSecretSet(allowedSecrets);
  for (const visit of visits) {
    const mutationCount = redactOneVisit(
      visit,
      userPatterns,
      patterns,
      allowed,
      summary,
      maxSamples,
      enableEntropyRedaction,
      pii,
    );
    if (mutationCount > 0) addMutationCount(redactionCounts, visit.recordIndex, mutationCount);
  }
}

function redactOneVisit(
  visit: Visit,
  userPatterns: RedactionPattern[],
  patterns: readonly RedactionPattern[],
  allowed: ReadonlySet<string>,
  summary: RedactionSummary,
  maxSamples: number,
  enableEntropyRedaction: boolean,
  pii: PiiConfig,
): number {
  const before = visit.get();
  let mutationCount = applyPatterns(visit, userPatterns, patterns, allowed, summary, maxSamples);
  mutationCount += applyCredentialContextForVisit(visit, allowed, summary, maxSamples);
  mutationCount += applyOptionalPiiForVisit(
    visit,
    allowed,
    summary,
    maxSamples,
    enableEntropyRedaction,
    pii,
  );
  return visit.get() === before ? 0 : mutationCount;
}

function applyPatterns(
  visit: Visit,
  userPatterns: RedactionPattern[],
  patterns: readonly RedactionPattern[],
  allowed: ReadonlySet<string>,
  summary: RedactionSummary,
  maxSamples: number,
): number {
  let mutationCount = 0;
  for (const pattern of userPatterns) {
    mutationCount += applyPattern(visit, pattern, summary, maxSamples, allowed);
  }
  for (const pattern of patterns) {
    mutationCount += applyPattern(visit, pattern, summary, maxSamples, allowed);
  }
  return mutationCount;
}

function applyCredentialContextForVisit(
  visit: Visit,
  allowed: ReadonlySet<string>,
  summary: RedactionSummary,
  maxSamples: number,
): number {
  const skipCount = summary.counts.allowlisted_skip ?? 0;
  return applyCredentialContext(
    visit,
    summary,
    maxSamples,
    allowed,
    (summary.counts.allowlisted_skip ?? 0) === skipCount,
  );
}

function applyOptionalPiiForVisit(
  visit: Visit,
  allowed: ReadonlySet<string>,
  summary: RedactionSummary,
  maxSamples: number,
  enableEntropyRedaction: boolean,
  pii: PiiConfig,
): number {
  if (isOpaqueTokenVisit(visit)) return 0;
  let mutationCount = enableEntropyRedaction
    ? applyEntropyRedaction(visit, summary, maxSamples, allowed)
    : 0;
  const beforePii = visit.get();
  const piiResult = applyPii(beforePii, visit.location, summary, maxSamples, pii, allowed);
  if (piiResult.text !== beforePii) {
    visit.set(piiResult.text);
    mutationCount += piiResult.count;
  }
  for (const sample of piiResult.samples) {
    if (summary.samples.length >= maxSamples) break;
    summary.samples.push(sample);
  }
  return mutationCount;
}
