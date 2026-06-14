import type { ErrorObject } from "ajv";
import type { TrailDiagnostic, TrailRecordLike } from "../../index.js";
import { cloneRecord, diagnostic, isKnownEventType, readString } from "../../shared.js";
import { eventSchemaErrors, eventValidator, validateEntry, validateEntryBase } from "./ajv.js";
import {
  coalesceAjvErrors,
  isDowngradedByReaderTolerance,
  isPayloadAdditionalPropertyError,
  normalizeAjvPath,
  schemaDiagnosticCode,
} from "./errors.js";
import { isDeclaredEventProperty } from "./introspection.js";
import { deleteJsonPointer } from "./pointers.js";

export function tolerantDiagnostics(
  record: TrailRecordLike,
  line: number,
  errors: ErrorObject[],
): TrailDiagnostic[] | undefined {
  if (record.type === "x-parse-error") return undefined;
  if (record.type === "session" || record.type === "trail") {
    if (!isReaderCompatiblePatchRecord(record)) return undefined;
    const remaining = coalesceAjvErrors(errors).filter(
      (error) => normalizeAjvPath(error) !== "/schema_version",
    );
    return remaining
      .map((error) =>
        diagnostic(line, normalizeAjvPath(error), "error", schemaDiagnosticCode(error, record)),
      )
      .concat(diagnostic(line, "/schema_version", "warning", "reader_tolerant_schema_version"));
  }
  if (!isKnownEventType(record.type) && validateEntryBase(record))
    return [diagnostic(line, "/type", "warning", "reader_tolerant_unknown_record")];

  const unknownPayloadWarnings = readerTolerantUnknownPayloadWarnings(record, line);
  if (unknownPayloadWarnings.length > 0) {
    if (hasOnlyReaderTolerantPayloadFieldAdditions(record, unknownPayloadWarnings)) {
      return unknownPayloadWarnings;
    }
    return coalesceAjvErrors(errors)
      .filter((error) => !isDowngradedByReaderTolerance(error, unknownPayloadWarnings))
      .map((error) =>
        diagnostic(line, normalizeAjvPath(error), "error", schemaDiagnosticCode(error, record)),
      )
      .concat(unknownPayloadWarnings);
  }

  return undefined;
}

function isReaderCompatiblePatchRecord(record: TrailRecordLike): boolean {
  const schemaVersion = readString(record, "schema_version");
  return schemaVersion !== "0.1.0" && /^0\.1\.\d+$/.test(schemaVersion ?? "");
}

function readerTolerantUnknownPayloadWarnings(
  record: TrailRecordLike,
  line: number,
): TrailDiagnostic[] {
  return uniqueWarningPaths(
    coalesceAjvErrors(eventSchemaErrors(record) ?? [])
      .filter(isPayloadAdditionalPropertyError)
      .filter((error) => !isDeclaredEventProperty(record, error))
      .map((error) =>
        diagnostic(
          line,
          normalizeAjvPath(error),
          "warning",
          "reader_tolerant_unknown_payload_field",
        ),
      ),
  );
}

function uniqueWarningPaths(diagnostics: TrailDiagnostic[]): TrailDiagnostic[] {
  const seen = new Set<string>();
  return diagnostics.filter((item) => {
    const key = `${item.line}:${item.path}:${item.code}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function hasOnlyReaderTolerantPayloadFieldAdditions(
  record: TrailRecordLike,
  warnings: TrailDiagnostic[],
): boolean {
  const type = readString(record, "type");
  if (type === undefined || warnings.length === 0) return false;
  if (eventValidator(type) === undefined) return false;

  const stripped = cloneRecord(record);
  for (const warning of warnings) {
    deleteJsonPointer(stripped, warning.path);
  }
  return validateEntry(stripped);
}
