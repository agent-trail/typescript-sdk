import type { TrailDiagnostic } from "../../index.js";
import { diagnostic } from "../../shared.js";
import type { ValidationContext } from "../context.js";
import { pickRecordValidator } from "./ajv.js";
import { coalesceAjvErrors, normalizeAjvPath, schemaDiagnosticCode } from "./errors.js";
import { tolerantDiagnostics } from "./tolerant.js";

export function schemaDiagnostics(context: ValidationContext): TrailDiagnostic[] {
  return context.trail.records.flatMap((record) => {
    const validateRecord = pickRecordValidator(record);
    if (validateRecord(record.record)) return [];
    const errors = validateRecord.errors ?? [];
    const tolerant =
      context.mode === "tolerant"
        ? tolerantDiagnostics(record.record, record.line, errors)
        : undefined;
    if (tolerant !== undefined) {
      return tolerant;
    }
    return coalesceAjvErrors(errors).map((error) =>
      diagnostic(
        record.line,
        normalizeAjvPath(error),
        "error",
        schemaDiagnosticCode(error, record.record),
      ),
    );
  });
}
