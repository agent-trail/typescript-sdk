import type { AgentTrailV010, Entry, Header, TrailEnvelope } from "@agent-trail/types";
import {
  computeContentHashes as computeContentHashesImpl,
  stampContentHashes as stampContentHashesImpl,
} from "./hashing.js";
import { parseTrailJsonl as parseTrailJsonlImpl } from "./parse.js";
import { reconcileSegments as reconcileSegmentsImpl } from "./reconciliation/index.js";
import { validateTrailJsonl as validateTrailJsonlImpl } from "./validation/index.js";

export type CoreValidationMode = "strict" | "tolerant";
export type TrailJsonlInput = string | AsyncIterable<string | Uint8Array>;

export type UnknownTrailRecord = {
  type: string;
  [key: string]: unknown;
};

export type TrailRecordLike = AgentTrailV010 | UnknownTrailRecord;

export type ParsedTrailRecord<TRecord extends TrailRecordLike = TrailRecordLike> = {
  line: number;
  record: TRecord;
};

export type SessionGroup = {
  header: ParsedTrailRecord<Header | UnknownTrailRecord>;
  events: ParsedTrailRecord<Entry | UnknownTrailRecord>[];
};

export type ParsedTrail = {
  records: ParsedTrailRecord[];
  envelope?: ParsedTrailRecord<TrailEnvelope>;
  groups: SessionGroup[];
};

export type TrailDiagnostic = {
  line: number;
  path: string;
  severity: "error" | "warning";
  code: string;
  message: string;
};

export type ValidateTrailOptions = {
  mode?: CoreValidationMode;
};

export type ValidationResult = {
  ok: boolean;
  trail: ParsedTrail;
  diagnostics: TrailDiagnostic[];
};

export type ContentHashEntry = {
  line: number;
  header: Header;
  hash: string;
};

export type ContentHashes = {
  sessionHashes: ContentHashEntry[];
  fileHash?: string;
};

export type StampedTrail = {
  trail: ParsedTrail;
  hashes: ContentHashes;
  jsonl: string;
};

export type ReconciliationResult = {
  trails: ParsedTrail[];
  diagnostics: TrailDiagnostic[];
};

export function parseTrailJsonl(input: TrailJsonlInput): Promise<ParsedTrail> {
  return parseTrailJsonlImpl(input);
}

export function validateTrailJsonl(
  input: TrailJsonlInput,
  options: ValidateTrailOptions = {},
): Promise<ValidationResult> {
  return validateTrailJsonlImpl(input, options);
}

export function computeContentHashes(trail: ParsedTrail): ContentHashes {
  return computeContentHashesImpl(trail);
}

export function stampContentHashes(trail: ParsedTrail): StampedTrail {
  return stampContentHashesImpl(trail);
}

export function reconcileSegments(inputs: ParsedTrail[]): ReconciliationResult {
  return reconcileSegmentsImpl(inputs);
}
