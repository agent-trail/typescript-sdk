/**
 * Core Agent Trail parsing, validation, hashing, and reconciliation APIs.
 *
 * @packageDocumentation
 */
import type { AgentTrailV010, Entry, Header, TrailEnvelope } from "@agent-trail/types";
import type { ErrorObject } from "ajv";
import {
  computeContentHashes as computeContentHashesImpl,
  serializeTrailJsonl as serializeTrailJsonlImpl,
  stampContentHashes as stampContentHashesImpl,
} from "./hashing.js";
import { parseTrailJsonl as parseTrailJsonlImpl } from "./parse.js";
import { reconcileSegments as reconcileSegmentsImpl } from "./reconciliation/index.js";
import { validateTrailJsonl as validateTrailJsonlImpl } from "./validation/index.js";
import { pickRecordValidator } from "./validation/schema/ajv.js";
import {
  coalesceAjvErrors,
  normalizeAjvPath,
  schemaDiagnosticCode,
} from "./validation/schema/errors.js";

/**
 * Validation strictness for core trail validation.
 *
 * @public
 */
export type CoreValidationMode = "strict" | "tolerant";

/**
 * Adapter-kit validation profile labels.
 *
 * @public
 */
export type ValidationProfile = "writer-strict" | "reader-tolerant";

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
 * Compatibility alias for diagnostics consumed by adapter packages.
 *
 * @public
 */
export type Diagnostic = TrailDiagnostic;

/**
 * Input for validating one already-parsed writer-strict record.
 *
 * @public
 */
export type WriterStrictRecordInput =
  | ParsedTrailRecord
  | {
      line: number;
      value: unknown;
      raw?: string;
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
 * Copy a diagnostic value.
 *
 * @public
 */
export function createDiagnostic(diagnostic: Diagnostic): Diagnostic {
  return { ...diagnostic };
}

/**
 * Format one diagnostic as a compact stable line.
 *
 * @public
 */
export function formatDiagnosticText(diagnostic: Diagnostic): string {
  const severity = escapeDiagnosticTextSegment(diagnostic.severity);
  const code = escapeDiagnosticTextSegment(diagnostic.code);
  const path = diagnostic.path === "" ? "<root>" : escapeDiagnosticTextSegment(diagnostic.path);
  const message = escapeDiagnosticTextSegment(diagnostic.message);
  return `${severity} ${code} line ${diagnostic.line} ${path}: ${message}`;
}

/**
 * Format diagnostics as newline-delimited stable text.
 *
 * @public
 */
export function formatDiagnosticsText(diagnostics: Iterable<Diagnostic>): string {
  return Array.from(diagnostics, formatDiagnosticText).join("\n");
}

/**
 * Validate one record against the writer-strict record schema.
 *
 * @public
 */
export function validateWriterStrictRecord(input: WriterStrictRecordInput): Diagnostic[] {
  const record = normalizeWriterStrictRecordInput(input);
  const validate = pickRecordValidator(record);
  if (validate(record.record)) return [];
  return coalesceAjvErrors((validate.errors ?? []) as ErrorObject[]).map((error) =>
    createDiagnostic({
      line: record.line,
      path: normalizeAjvPath(error),
      severity: "error",
      code: schemaDiagnosticCode(error, record.record),
      message: error.message ?? "Schema validation failed",
    }),
  );
}

function normalizeWriterStrictRecordInput(input: WriterStrictRecordInput): ParsedTrailRecord {
  if ("record" in input) return input;
  return {
    line: input.line,
    record: isTrailRecordLike(input.value)
      ? input.value
      : { type: "x-invalid", value: input.value },
  };
}

function isTrailRecordLike(value: unknown): value is TrailRecordLike {
  return (
    value !== null &&
    typeof value === "object" &&
    "type" in value &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

function escapeDiagnosticTextSegment(value: string): string {
  let escaped = "";
  for (const character of value) {
    const charCode = character.charCodeAt(0);
    if (charCode < 0x20 || charCode === 0x7f) {
      switch (character) {
        case "\n":
          escaped += "\\n";
          break;
        case "\r":
          escaped += "\\r";
          break;
        case "\t":
          escaped += "\\t";
          break;
        default:
          escaped += `\\u${charCode.toString(16).padStart(4, "0")}`;
      }
    } else {
      escaped += character;
    }
  }
  return escaped;
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
