import { Redactor } from "@redactpii/node";
import { allowedMatches, recordAllowlistedSkips } from "./matches.js";
import { assertSafeRegexSource } from "./regex-safety.js";
import type { PiiConfig, RedactionSample, RedactionSummary } from "./types.js";

const TOKEN_PATTERN = /\b(EMAIL|PHONE|SSN|CREDIT_CARD|NAME|PERSON)(?:_\d+)+\b/g;
const PHONE_PATTERN =
  /(?<!\w)(?:\+1[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}|(?:1[-\s])?\(\d{3}\)\s?\d{3}[-.\s]?\d{4}|(?:1[-\s])?\d{3}[-\s]\d{3}[-\s]\d{4})\b/g;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const DEFAULT_EMAIL_ALLOWLIST = [
  "actions@github.com",
  "*@users.noreply.github.com",
  "*@noreply.github.com",
];

const TOKEN_TO_PATTERN_ID: Record<string, string> = {
  EMAIL: "email_pii",
  PHONE: "phone_pii",
  SSN: "ssn_pii",
  CREDIT_CARD: "credit_card_pii",
  NAME: "name_pii",
  PERSON: "name_pii",
};

const TOKEN_TO_PLACEHOLDER: Record<string, string> = {
  EMAIL: "[EMAIL]",
  PHONE: "[PHONE]",
  SSN: "[SSN]",
  CREDIT_CARD: "[CREDIT_CARD]",
  NAME: "[NAME]",
  PERSON: "[NAME]",
};

export type PiiResult = { text: string; samples: RedactionSample[]; count: number };

export function applyPii(
  text: string,
  location: string,
  summary: RedactionSummary,
  maxSamples: number,
  config: PiiConfig = {},
  allowedSecrets: ReadonlySet<string> = new Set(),
): PiiResult {
  if (!text) return { text, samples: [], count: 0 };
  const localSamples: RedactionSample[] = [];
  const protectedEmails = protectEmailsForConfig(text, config, allowedSecrets);
  recordAllowlistedSkips(summary, protectedEmails.count);
  let current = protectedEmails.text;

  const custom = applyCustomLabels(
    current,
    location,
    summary,
    maxSamples,
    config.customLabels ?? {},
    allowedSecrets,
  );
  current = custom.text;
  localSamples.push(...custom.samples);
  let count = custom.count;

  const phone = applyPhoneForConfig(current, location, summary, maxSamples, config, allowedSecrets);
  current = phone.text;
  count += phone.count;
  localSamples.push(...phone.samples);

  const redactor = configuredPiiRedactor(config);
  const protectedAllowed = protectAllowedPiiLiterals(current, redactor, allowedSecrets);
  recordAllowlistedSkips(summary, protectedAllowed.count);
  const anonymized = redactor.redact(protectedAllowed.text);
  if (anonymized === protectedAllowed.text)
    return restoredPiiResult(protectedEmails, protectedAllowed, anonymized, localSamples, count);

  count += summarizePiiTokens(anonymized, location, summary, localSamples, maxSamples);
  const normalized = anonymized.replace(TOKEN_PATTERN, (_full, kind: string) => {
    return TOKEN_TO_PLACEHOLDER[kind] ?? "[PII]";
  });

  return {
    text: protectedEmails.restore(protectedAllowed.restore(normalized)),
    samples: localSamples,
    count,
  };
}

type ProtectedText = { text: string; restore: (value: string) => string; count: number };

function protectEmailsForConfig(
  text: string,
  config: PiiConfig,
  allowedSecrets: ReadonlySet<string>,
): ProtectedText {
  if (config.email === false) return { text, restore: (value: string) => value, count: 0 };
  return protectAllowlistedEmails(text, config.emailAllowlist ?? [], allowedSecrets);
}

function applyPhoneForConfig(
  text: string,
  location: string,
  summary: RedactionSummary,
  maxSamples: number,
  config: PiiConfig,
  allowedSecrets: ReadonlySet<string>,
): PiiResult {
  if (!(config.phone ?? true)) return { text, samples: [], count: 0 };
  return applyPhone(text, location, summary, maxSamples, allowedSecrets);
}

function configuredPiiRedactor(config: PiiConfig): Redactor {
  return new Redactor({
    anonymize: true,
    rules: {
      EMAIL: config.email ?? true,
      PHONE: false,
      SSN: config.ssn ?? true,
      CREDIT_CARD: config.creditCard ?? true,
      NAME: config.name ?? true,
    },
  });
}

function restoredPiiResult(
  protectedEmails: ProtectedText,
  protectedAllowed: ProtectedText,
  anonymized: string,
  samples: RedactionSample[],
  count: number,
): PiiResult {
  return {
    text: protectedEmails.restore(protectedAllowed.restore(anonymized)),
    samples,
    count,
  };
}

function summarizePiiTokens(
  anonymized: string,
  location: string,
  summary: RedactionSummary,
  localSamples: RedactionSample[],
  maxSamples: number,
): number {
  let count = 0;
  const seenPatternIds = new Set<string>();
  for (const match of anonymized.matchAll(TOKEN_PATTERN)) {
    const kind = match[1] ?? "";
    const patternId = TOKEN_TO_PATTERN_ID[kind];
    if (!patternId) continue;
    count += 1;
    summary.counts[patternId] = (summary.counts[patternId] ?? 0) + 1;
    if (
      seenPatternIds.has(patternId) ||
      summary.samples.length + localSamples.length >= maxSamples
    ) {
      continue;
    }
    seenPatternIds.add(patternId);
    localSamples.push({
      patternId,
      location,
      before: `[${kind}]`,
      after: TOKEN_TO_PLACEHOLDER[kind] ?? "[PII]",
    });
  }
  return count;
}

function protectAllowedPiiLiterals(
  text: string,
  redactor: Redactor,
  allowedSecrets: ReadonlySet<string>,
): ProtectedText {
  const protectedValues: string[] = [];
  const tokens: string[] = [];
  let current = text;
  let count = 0;
  const literals = [...allowedSecrets]
    .filter((secret) => secret.length > 0 && redactor.redact(secret) !== secret)
    .sort((a, b) => b.length - a.length);
  for (const secret of literals) {
    const token = allowedPiiToken(protectedValues.length, current, protectedValues);
    const parts = current.split(secret);
    const matches = parts.length - 1;
    if (matches === 0) continue;
    current = parts.join(token);
    protectedValues.push(secret);
    tokens.push(token);
    count += matches;
  }
  return {
    text: current,
    count,
    restore: (value: string) =>
      protectedValues.reduce((next, secret, index) => {
        const token = tokens[index];
        return token === undefined ? next : next.replaceAll(token, secret);
      }, value),
  };
}

function allowedPiiToken(index: number, text: string, protectedValues: readonly string[]): string {
  let candidate = index;
  let token = allowedPiiTokenAt(candidate);
  while (text.includes(token) || protectedValues.includes(token)) {
    candidate += 1;
    token = allowedPiiTokenAt(candidate);
  }
  return token;
}

function allowedPiiTokenAt(index: number): string {
  return `\u0000AGENT_TRAIL_ALLOWED_PII_${index}\u0000`;
}

function applyCustomLabels(
  text: string,
  location: string,
  summary: RedactionSummary,
  maxSamples: number,
  customLabels: Record<string, string>,
  allowedSecrets: ReadonlySet<string>,
): PiiResult {
  let current = text;
  const samples: RedactionSample[] = [];
  let count = 0;
  for (const [label, source] of Object.entries(customLabels)) {
    assertSafeRegexSource(source, `custom label ${label}`);
    const id = `${label}_pii`;
    const placeholder = `[REDACTED_${label.toUpperCase().replace(/[^A-Z0-9_]/g, "_")}]`;
    const regex = new RegExp(source, "g");
    const { matches, skipped } = allowedMatches(current, regex, allowedSecrets);
    recordAllowlistedSkips(summary, skipped);
    if (matches.length === 0) continue;
    regex.lastIndex = 0;
    current = current.replace(regex, (match: string) =>
      allowedSecrets.has(match) ? match : placeholder,
    );
    count += matches.length;
    summary.counts[id] = (summary.counts[id] ?? 0) + matches.length;
    if (summary.samples.length + samples.length < maxSamples) {
      samples.push({
        patternId: id,
        location,
        before: `[${label.toUpperCase()}]`,
        after: placeholder,
      });
    }
  }
  return { text: current, samples, count };
}

function protectAllowlistedEmails(
  text: string,
  configuredAllowlist: string[],
  allowedSecrets: ReadonlySet<string>,
): { text: string; restore: (value: string) => string; count: number } {
  const allowlist = [...DEFAULT_EMAIL_ALLOWLIST, ...configuredAllowlist];
  const protectedValues: string[] = [];
  const tokens: string[] = [];
  const tokenAllocator = allowlistedEmailTokenAllocator(text, tokens);
  EMAIL_PATTERN.lastIndex = 0;
  const protectedText = text.replace(EMAIL_PATTERN, (email) => {
    if (!allowedSecrets.has(email) && !isEmailAllowlisted(email, allowlist)) return email;
    const token = tokenAllocator();
    protectedValues.push(email);
    tokens.push(token);
    return token;
  });
  return {
    text: protectedText,
    count: protectedValues.length,
    restore: (value: string) =>
      protectedValues.reduce((current, email, index) => {
        const token = tokens[index];
        return token === undefined ? current : current.replaceAll(token, email);
      }, value),
  };
}

function allowlistedEmailTokenAllocator(text: string, tokens: readonly string[]): () => string {
  let next = 0;
  return () => {
    let token = allowlistedEmailTokenAt(next);
    while (text.includes(token) || tokens.includes(token)) {
      next += 1;
      token = allowlistedEmailTokenAt(next);
    }
    next += 1;
    return token;
  };
}

function allowlistedEmailTokenAt(index: number): string {
  return `\u0000AGENT_TRAIL_ALLOWED_EMAIL_${index}\u0000`;
}

function isEmailAllowlisted(email: string, allowlist: string[]): boolean {
  const lower = email.toLowerCase();
  for (const rawPattern of allowlist) {
    const pattern = rawPattern.toLowerCase();
    if (pattern.endsWith("@*") && lower.startsWith(pattern.slice(0, -1))) return true;
    if (pattern.startsWith("*@") && lower.endsWith(pattern.slice(1))) return true;
    if (lower === pattern) return true;
  }
  return false;
}

function applyPhone(
  text: string,
  location: string,
  summary: RedactionSummary,
  maxSamples: number,
  allowedSecrets: ReadonlySet<string>,
): PiiResult {
  const { matches, skipped } = allowedMatches(text, PHONE_PATTERN, allowedSecrets);
  recordAllowlistedSkips(summary, skipped);
  if (matches.length === 0) return { text, samples: [], count: 0 };
  PHONE_PATTERN.lastIndex = 0;
  summary.counts.phone_pii = (summary.counts.phone_pii ?? 0) + matches.length;
  const samples: RedactionSample[] = [];
  if (summary.samples.length < maxSamples) {
    samples.push({
      patternId: "phone_pii",
      location,
      before: "[PHONE]",
      after: "[PHONE]",
    });
  }
  return {
    text: text.replace(PHONE_PATTERN, (match: string) =>
      allowedSecrets.has(match) ? match : "[PHONE]",
    ),
    samples,
    count: matches.length,
  };
}
