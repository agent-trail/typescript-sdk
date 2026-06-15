import { applyEntropyRedaction } from "../patterns/entropy.js";
import { allowedMatches, recordAllowlistedSkips } from "../patterns/matches.js";
import { applyPii } from "../patterns/pii.js";
import type { PiiConfig, RedactionPattern, RedactionSummary } from "../public/types.js";
import { keyVisit, type Visit } from "../transform/visits.js";
import { maskSample } from "./samples.js";

const TEXT_ENCODER = new TextEncoder();

export function byteLength(s: string): number {
  return TEXT_ENCODER.encode(s).byteLength;
}

function ensureGlobal(regex: RegExp): RegExp {
  return regex.flags.includes("g") ? regex : new RegExp(regex.source, `${regex.flags}g`);
}

export function applyPattern(
  visit: Visit,
  pattern: RedactionPattern,
  summary: RedactionSummary,
  maxSamples: number,
  allowedSecrets: ReadonlySet<string> = new Set(),
): number {
  const current = visit.get();
  const regex = ensureGlobal(pattern.regex);
  const { matches, skipped } = allowedMatches(current, regex, allowedSecrets);
  if (matches.length === 0) {
    recordAllowlistedSkips(summary, skipped);
    return 0;
  }
  regex.lastIndex = 0;
  visit.set(
    current.replace(regex, (match: string, ...args: unknown[]) => {
      if (allowedSecrets.has(match)) return match;
      return expandReplacement(pattern.placeholder, match, args);
    }),
  );
  summary.counts[pattern.id] = (summary.counts[pattern.id] ?? 0) + matches.length;
  if (summary.samples.length < maxSamples) {
    const first = matches[0]?.[0] ?? "";
    summary.samples.push({
      patternId: pattern.id,
      location: visit.location,
      before: maskSample(first),
      after: pattern.placeholder,
    });
  }
  recordAllowlistedSkips(summary, skipped);
  return matches.length;
}

function expandReplacement(placeholder: string, match: string, args: unknown[]): string {
  const offsetIndex = args.findIndex((arg) => typeof arg === "number");
  const offset = offsetIndex === -1 ? 0 : (args[offsetIndex] as number);
  const input = typeof args[offsetIndex + 1] === "string" ? (args[offsetIndex + 1] as string) : "";
  const captures = offsetIndex === -1 ? [] : args.slice(0, offsetIndex);
  return placeholder.replace(/\$(\$|&|`|'|[1-9]\d?)/g, (token, name: string) => {
    if (name === "$") return "$";
    if (name === "&") return match;
    if (name === "`") return input.slice(0, offset);
    if (name === "'") return input.slice(offset + match.length);
    return expandCaptureReference(token, name, captures);
  });
}

function expandCaptureReference(token: string, digits: string, captures: unknown[]): string {
  const index = Number.parseInt(digits, 10);
  const capture = captures[index - 1];
  if (index >= 1 && index <= captures.length) return typeof capture === "string" ? capture : "";
  if (digits.length === 2) {
    const firstDigit = digits[0];
    if (firstDigit === undefined) return token;
    const firstIndex = Number.parseInt(firstDigit, 10);
    const firstCapture = captures[firstIndex - 1];
    if (firstIndex >= 1 && firstIndex <= captures.length) {
      return `${typeof firstCapture === "string" ? firstCapture : ""}${digits[1]}`;
    }
  }
  return token;
}

export function allowedSecretSet(allowedSecrets: readonly string[]): Set<string> {
  return new Set(allowedSecrets.filter((secret) => secret.length > 0));
}

function redactVisit(
  visit: Visit,
  userPatterns: RedactionPattern[],
  patterns: readonly RedactionPattern[],
  allowedSecrets: readonly string[],
  summary: RedactionSummary,
  maxSamples: number,
  enableEntropyRedaction: boolean,
  pii: PiiConfig,
): void {
  const allowed = allowedSecretSet(allowedSecrets);
  for (const pattern of userPatterns) {
    applyPattern(visit, pattern, summary, maxSamples, allowed);
  }
  for (const pattern of patterns) {
    applyPattern(visit, pattern, summary, maxSamples, allowed);
  }
  if (enableEntropyRedaction) {
    applyEntropyRedaction(visit, summary, maxSamples, allowed);
  }
  const current = visit.get();
  const piiResult = applyPii(current, visit.location, summary, maxSamples, pii, allowed);
  if (piiResult.text !== current) {
    visit.set(piiResult.text);
  }
  for (const sample of piiResult.samples) {
    if (summary.samples.length >= maxSamples) break;
    summary.samples.push(sample);
  }
}

export function redactString(
  value: string,
  location: string,
  userPatterns: RedactionPattern[],
  patterns: readonly RedactionPattern[],
  allowedSecrets: readonly string[],
  summary: RedactionSummary,
  maxSamples: number,
  enableEntropyRedaction = false,
  pii: PiiConfig = {},
): string {
  const container: Record<string, unknown> = { value };
  redactVisit(
    keyVisit(container, "value", -1, location),
    userPatterns,
    patterns,
    allowedSecrets,
    summary,
    maxSamples,
    enableEntropyRedaction,
    pii,
  );
  return container.value as string;
}

function escapeRegex(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function userSecretsPatterns(secrets: readonly string[]): RedactionPattern[] {
  // Note: if a user-supplied secret happens to equal a placeholder
  // ("[OPENAI_KEY]", "<home>", etc.) repeated redaction passes can shorten
  // already-redacted output. Callers should pass raw secrets only.
  // Sorting by length descending prevents shorter overlapping secrets from
  // consuming bytes that a longer secret would have matched in full.
  const unique = Array.from(new Set(secrets.filter((s) => s.length > 0))).sort(
    (a, b) => b.length - a.length,
  );
  return unique.map(
    (literal): RedactionPattern => ({
      id: "user_secret",
      description: "User-supplied secret literal",
      regex: new RegExp(escapeRegex(literal), "g"),
      placeholder: "[USER_SECRET]",
    }),
  );
}
