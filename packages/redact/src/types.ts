import type { TrailJsonlInput } from "@agent-trail/core";
import type { RedactionPattern } from "./secret-patterns.js";

export type { RedactionPattern };

/**
 * One sample mutation captured during redaction.
 *
 * @public
 */
export type RedactionSample = {
  patternId: string;
  location: string;
  before: string;
  after: string;
};

/**
 * Aggregate mutation counts, samples, pack metadata, and warnings.
 *
 * @public
 */
export type RedactionSummary = {
  counts: Record<string, number>;
  samples: RedactionSample[];
  packs?: RedactionPackSummary[];
  warnings?: string[];
};

/**
 * Origin of a loaded redaction pack.
 *
 * @public
 */
export type RedactionPackSource = "project" | "user_global";

/**
 * Public metadata for a loaded redaction pack.
 *
 * @public
 */
export type RedactionPackSummary = {
  name: string;
  version: number;
  contentHash: string;
  source: RedactionPackSource;
};

/**
 * Loaded redaction pack with compiled patterns and allowlisted literals.
 *
 * @public
 */
export type LoadedRedactionPack = RedactionPackSummary & {
  path: string;
  patterns: RedactionPattern[];
  allowlist: string[];
};

/**
 * PII detector configuration for built-in and custom PII labels.
 *
 * @public
 */
export type PiiConfig = {
  email?: boolean;
  phone?: boolean;
  ssn?: boolean;
  creditCard?: boolean;
  name?: boolean;
  emailAllowlist?: string[];
  customLabels?: Record<string, string>;
};

/**
 * Redacted trail record with original JSONL line number.
 *
 * @public
 */
export type RedactedTrailRecord = {
  line: number;
  record: unknown;
};

/**
 * Redacted session group containing a session header and events.
 *
 * @public
 */
export type RedactedSessionGroup = {
  header: RedactedTrailRecord;
  events: RedactedTrailRecord[];
};

/**
 * Parsed redacted trail returned by `redactTrailJsonl`.
 *
 * @public
 */
export type RedactedTrail = {
  records: RedactedTrailRecord[];
  envelope?: RedactedTrailRecord;
  groups: RedactedSessionGroup[];
};

/**
 * Options controlling built-in patterns, packs, PII, sharing rules, and limits.
 *
 * @public
 */
export type RedactTrailOptions = {
  patterns?: RedactionPattern[];
  extendPatterns?: RedactionPattern[];
  redactionPacks?: LoadedRedactionPack[];
  userSecrets?: string[];
  allowedSecrets?: string[];
  pii?: PiiConfig;
  includeSourceRaw?: boolean;
  outputMaxBytes?: number;
  maxSamples?: number;
  attachmentUriRewrites?: Record<string, `sha256:${string}`>;
  enableEntropyRedaction?: boolean;
  // When true, preserve vcs.remote_url verbatim in the redacted header.
  // Default false strips the field because it identifies the repository
  // (and may identify a private repo). Spec §15 / PRD §8.6 step 7.
  keepRemoteUrl?: boolean;
};

/**
 * Result of redacting Agent Trail JSONL.
 *
 * @public
 */
export type RedactTrailResult = {
  jsonl: string;
  trail: RedactedTrail;
  summary: RedactionSummary;
};

/**
 * Input accepted by `redactTrailJsonl`.
 *
 * @public
 */
export type RedactTrailJsonlInput = TrailJsonlInput;
