import type { ErrorObject } from "ajv";
import type { TrailDiagnostic, TrailRecordLike } from "../../index.js";
import { escapeJsonPointer, readString } from "../../shared.js";

export function coalesceAjvErrors(errors: ErrorObject[]): ErrorObject[] {
  const portable = errors.filter(
    (error) => !["anyOf", "oneOf", "if", "then", "allOf"].includes(error.keyword),
  );
  const selected = portable.length > 0 ? portable : errors;
  const seen = new Set<string>();
  return selected.filter((error) => {
    const key = `${error.instancePath}:${error.keyword}:${diagnosticPropertyName(error) ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function isDowngradedByReaderTolerance(
  error: ErrorObject,
  warnings: TrailDiagnostic[],
): boolean {
  return (
    isPayloadAdditionalPropertyError(error) &&
    warnings.some((warning) => warning.path === normalizeAjvPath(error))
  );
}

export function isPayloadAdditionalPropertyError(error: ErrorObject): boolean {
  return (
    ["additionalProperties", "unevaluatedProperties"].includes(error.keyword) &&
    isPayloadPath(error.instancePath) &&
    unknownPropertyName(error) !== undefined
  );
}

export function normalizeAjvPath(error: ErrorObject): string {
  if (error.keyword === "required" && typeof error.params.missingProperty === "string") {
    return `${error.instancePath}/${escapeJsonPointer(error.params.missingProperty)}`;
  }
  const propertyName = unknownPropertyName(error);
  if (
    ["additionalProperties", "unevaluatedProperties"].includes(error.keyword) &&
    propertyName !== undefined
  ) {
    return `${error.instancePath}/${escapeJsonPointer(propertyName)}`;
  }
  return error.instancePath;
}

export function schemaDiagnosticCode(error: ErrorObject, record: TrailRecordLike): string {
  if (record.type === "x-parse-error") return readString(record, "code") ?? "schema";
  if (error.instancePath === "/content_hash" && error.keyword === "pattern")
    return "content_hash_invalid";
  if (record.type === "session" && error.instancePath === "/schema_version") return "schema";
  return "schema";
}

export function unknownPropertyName(error: ErrorObject): string | undefined {
  if (typeof error.params.additionalProperty === "string") return error.params.additionalProperty;
  if (typeof error.params.unevaluatedProperty === "string") return error.params.unevaluatedProperty;
  return undefined;
}

function diagnosticPropertyName(error: ErrorObject): string | undefined {
  if (typeof error.params.missingProperty === "string") return error.params.missingProperty;
  return unknownPropertyName(error);
}

function isPayloadPath(path: string): boolean {
  return path === "/payload" || path.startsWith("/payload/");
}
