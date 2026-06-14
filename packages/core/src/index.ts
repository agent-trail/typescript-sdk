/**
 * Core Agent Trail parsing, validation, hashing, and reconciliation APIs.
 *
 * @packageDocumentation
 */
import type { AgentTrailV010, Entry, Header, TrailEnvelope } from "@agent-trail/types";
import {
  computeContentHashes as computeContentHashesImpl,
  serializeTrailJsonl as serializeTrailJsonlImpl,
  stampContentHashes as stampContentHashesImpl,
} from "./hashing.js";
import { parseTrailJsonl as parseTrailJsonlImpl } from "./parse.js";
import { reconcileSegments as reconcileSegmentsImpl } from "./reconciliation/index.js";
import { validateTrailJsonl as validateTrailJsonlImpl } from "./validation/index.js";

/**
 * Validation strictness for core trail validation.
 *
 * @public
 */
export type CoreValidationMode = "strict" | "tolerant";

/**
 * JSONL input accepted by core parser and validator APIs.
 *
 * @public
 */
export type TrailJsonlInput = string | AsyncIterable<string | Uint8Array>;

/**
 * Future trail record preserved by tolerant parsing.
 *
 * @public
 */
export type UnknownTrailRecord = {
  type: string;
  [key: string]: unknown;
};

/**
 * Known Agent Trail record or reader-tolerated future record.
 *
 * @public
 */
export type TrailRecordLike = AgentTrailV010 | UnknownTrailRecord;

/**
 * Parsed trail record with original JSONL line number.
 *
 * @public
 */
export type ParsedTrailRecord<TRecord extends TrailRecordLike = TrailRecordLike> = {
  line: number;
  record: TRecord;
};

/**
 * Session header and events parsed from a trail.
 *
 * @public
 */
export type SessionGroup = {
  header: ParsedTrailRecord<Header | UnknownTrailRecord>;
  events: ParsedTrailRecord<Entry | UnknownTrailRecord>[];
};

/**
 * Parsed trail records, optional file envelope, and session groups.
 *
 * @public
 */
export type ParsedTrail = {
  records: ParsedTrailRecord[];
  envelope?: ParsedTrailRecord<TrailEnvelope>;
  groups: SessionGroup[];
};

/**
 * Portable diagnostic emitted by core validation and reconciliation.
 *
 * @public
 */
export type TrailDiagnostic = {
  line: number;
  path: string;
  severity: "error" | "warning";
  code: string;
  message: string;
};

/**
 * Options for core trail validation.
 *
 * @public
 */
export type ValidateTrailOptions = {
  mode?: CoreValidationMode;
};

/**
 * Unified core validation result.
 *
 * @public
 */
export type ValidationResult = {
  ok: boolean;
  trail: ParsedTrail;
  diagnostics: TrailDiagnostic[];
};

/**
 * Content hash for one session header.
 *
 * @public
 */
export type ContentHashEntry = {
  line: number;
  header: Header;
  hash: string;
};

/**
 * Session and optional file-level content hashes.
 *
 * @public
 */
export type ContentHashes = {
  sessionHashes: ContentHashEntry[];
  fileHash?: string;
};

/**
 * Immutable hash-stamped trail result.
 *
 * @public
 */
export type StampedTrail = {
  trail: ParsedTrail;
  hashes: ContentHashes;
  jsonl: string;
};

/**
 * Result from reconciling segmented trails.
 *
 * @public
 */
export type ReconciliationResult = {
  trails: ParsedTrail[];
  diagnostics: TrailDiagnostic[];
};

/**
 * Parse Agent Trail JSONL into records and session groups.
 *
 * @public
 */
export function parseTrailJsonl(input: TrailJsonlInput): Promise<ParsedTrail> {
  return parseTrailJsonlImpl(input);
}

/**
 * Validate Agent Trail JSONL in strict or tolerant mode.
 *
 * @public
 */
export function validateTrailJsonl(
  input: TrailJsonlInput,
  options: ValidateTrailOptions = {},
): Promise<ValidationResult> {
  return validateTrailJsonlImpl(input, options);
}

/**
 * Compute session and optional file content hashes.
 *
 * @public
 */
export function computeContentHashes(trail: ParsedTrail): ContentHashes {
  return computeContentHashesImpl(trail);
}

/**
 * Return an immutable copy of a parsed trail with content hashes stamped.
 *
 * @public
 */
export function stampContentHashes(trail: ParsedTrail): StampedTrail {
  return stampContentHashesImpl(trail);
}

/**
 * Serialize parsed Agent Trail records as canonical JSONL.
 *
 * @public
 */
export function serializeTrailJsonl(trail: ParsedTrail): string {
  return serializeTrailJsonlImpl(trail);
}

/**
 * Reconcile segmented trails into merged parsed trails.
 *
 * @public
 */
export function reconcileSegments(inputs: ParsedTrail[]): ReconciliationResult {
  return reconcileSegmentsImpl(inputs);
}
