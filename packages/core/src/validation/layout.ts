import type {
  CoreValidationMode,
  ParsedTrail,
  ParsedTrailRecord,
  TrailDiagnostic,
} from "../index.js";
import { diagnostic, readString } from "../shared.js";
import type { ValidationContext } from "./context.js";

const readerCompatiblePatchVersionPattern = /^0\.1\.\d+$/;

export function layoutDiagnostics(context: ValidationContext): TrailDiagnostic[] {
  const { trail, mode } = context;
  const first = trail.records[0];
  if (first === undefined) {
    return [diagnostic(1, "", "error", "missing_header")];
  }

  const envelopeState = envelopeStateFor(trail);
  return [
    ...firstRecordDiagnostics(first, mode),
    ...recordPlacementDiagnostics(trail.records, first),
    ...envelopeDiagnostics(trail, first, envelopeState.extraEnvelope),
    ...preHeaderDiagnostics(trail, envelopeState.hasMissingHeaderAfterEnvelope),
  ];
}

function firstRecordDiagnostics(
  first: ParsedTrailRecord,
  mode: CoreValidationMode,
): TrailDiagnostic[] {
  const diagnostics: TrailDiagnostic[] = [];
  if (first.record.type !== "trail" && first.record.type !== "session") {
    diagnostics.push(
      diagnostic(first.line, "/type", "error", "events_before_first_session_header"),
    );
  }

  if (
    first.record.type === "session" &&
    readString(first.record, "schema_version") !== undefined &&
    readString(first.record, "schema_version") !== "0.1.0" &&
    (mode === "strict" ||
      !readerCompatiblePatchVersionPattern.test(readString(first.record, "schema_version") ?? ""))
  ) {
    diagnostics.push(diagnostic(first.line, "", "error", "missing_header"));
  }
  return diagnostics;
}

function recordPlacementDiagnostics(
  records: ParsedTrailRecord[],
  first: ParsedTrailRecord,
): TrailDiagnostic[] {
  const diagnostics: TrailDiagnostic[] = [];
  for (const record of records) {
    if (record.record.type === "trail" && record.line !== 1 && first.record.type !== "trail") {
      diagnostics.push(diagnostic(record.line, "/type", "error", "envelope_not_at_line_1"));
    }
    if (record.record.type === "trail" && "parent_id" in record.record) {
      diagnostics.push(diagnostic(record.line, "/parent_id", "error", "envelope_has_parent_id"));
    }
    if (record.record.type === "session" && "parent_id" in record.record) {
      diagnostics.push(diagnostic(record.line, "/parent_id", "error", "header_has_parent_id"));
    }
  }
  return diagnostics;
}

function envelopeStateFor(trail: ParsedTrail): {
  extraEnvelope: ParsedTrailRecord | undefined;
  hasMissingHeaderAfterEnvelope: boolean;
} {
  const first = trail.records[0];
  const envelopes = trail.records.filter((record) => record.record.type === "trail");
  const extraEnvelope = envelopes.find((record) => record.line !== 1);
  const hasMissingHeaderAfterEnvelope =
    first?.record.type === "trail" &&
    trail.records[1]?.record.type !== "session" &&
    extraEnvelope === undefined;
  return { extraEnvelope, hasMissingHeaderAfterEnvelope };
}

function envelopeDiagnostics(
  trail: ParsedTrail,
  first: ParsedTrailRecord,
  extraEnvelope: ParsedTrailRecord | undefined,
): TrailDiagnostic[] {
  const diagnostics: TrailDiagnostic[] = [];
  const envelopes = trail.records.filter((record) => record.record.type === "trail");
  if (extraEnvelope !== undefined && envelopes.length > 1) {
    diagnostics.push(diagnostic(extraEnvelope.line, "/type", "error", "multiple_envelopes"));
  }

  if (
    first.record.type === "trail" &&
    trail.records[1]?.record.type !== "session" &&
    extraEnvelope === undefined
  ) {
    diagnostics.push(diagnostic(2, "", "error", "missing_header_after_envelope"));
  }
  return diagnostics;
}

function preHeaderDiagnostics(
  trail: ParsedTrail,
  hasMissingHeaderAfterEnvelope: boolean,
): TrailDiagnostic[] {
  const firstSessionLine = findFirstSessionLine(trail.records);
  return trail.records
    .filter((record) => isPreHeaderEvent(record, firstSessionLine, hasMissingHeaderAfterEnvelope))
    .map((record) =>
      diagnostic(record.line, "/type", "error", "events_before_first_session_header"),
    );
}

function findFirstSessionLine(records: ParsedTrailRecord[]): number | undefined {
  return records.find((record) => record.record.type === "session")?.line;
}

function isPreHeaderEvent(
  record: ParsedTrailRecord,
  firstSessionLine: number | undefined,
  hasMissingHeaderAfterEnvelope: boolean,
): boolean {
  return (
    record.record.type !== "session" &&
    isBeforeFirstSession(record, firstSessionLine) &&
    !isAllowedPreHeaderRecord(record, hasMissingHeaderAfterEnvelope)
  );
}

function isBeforeFirstSession(
  record: ParsedTrailRecord,
  firstSessionLine: number | undefined,
): boolean {
  return firstSessionLine === undefined || record.line < firstSessionLine;
}

function isAllowedPreHeaderRecord(
  record: ParsedTrailRecord,
  hasMissingHeaderAfterEnvelope: boolean,
): boolean {
  return (
    isLineOneEnvelope(record) || isSyntheticMissingHeaderLine(record, hasMissingHeaderAfterEnvelope)
  );
}

function isLineOneEnvelope(record: ParsedTrailRecord): boolean {
  return record.line === 1 && record.record.type === "trail";
}

function isSyntheticMissingHeaderLine(
  record: ParsedTrailRecord,
  hasMissingHeaderAfterEnvelope: boolean,
): boolean {
  return hasMissingHeaderAfterEnvelope && record.line === 2;
}
