import schema from "@agent-trail/schema" with { type: "json" };
import type { ErrorObject, ValidateFunction } from "ajv";
import Ajv2020 from "ajv/dist/2020.js";
import type {
  CoreValidationMode,
  ParsedTrail,
  ParsedTrailRecord,
  TrailDiagnostic,
  TrailRecordLike,
} from "../index.js";
import {
  cloneRecord,
  diagnostic,
  escapeJsonPointer,
  isKnownEventType,
  readString,
} from "../shared.js";

const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
  validateFormats: false,
  unevaluated: true,
});
const schemaRoot = schema as {
  $id: string;
  $defs?: Record<string, unknown> & { events?: Record<string, unknown> };
};
ajv.addSchema(schema);
const validateTrailEnvelope = compileSchemaRef(`${schemaRoot.$id}#/$defs/trailEnvelope`);
const validateHeader = compileSchemaRef(`${schemaRoot.$id}#/$defs/header`);
const validateEntry = compileSchemaRef(`${schemaRoot.$id}#/$defs/entry`);
const validateEntryBase = compileSchemaRef(`${schemaRoot.$id}#/$defs/entryBase`);
const eventValidators = new Map<string, ValidateFunction>();

export function schemaDiagnostics(trail: ParsedTrail, mode: CoreValidationMode): TrailDiagnostic[] {
  return trail.records.flatMap((record) => {
    const validateRecord = pickRecordValidator(record);
    if (validateRecord(record.record)) return [];
    const errors = validateRecord.errors ?? [];
    const tolerant =
      mode === "tolerant" ? tolerantDiagnostics(record.record, record.line, errors) : undefined;
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

function tolerantDiagnostics(
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

function deleteJsonPointer(value: unknown, pointer: string): void {
  const segments = jsonPointerSegments(pointer);
  const property = segments.pop();
  if (property === undefined) return;

  const target = jsonPointerTarget(value, segments);
  if (isSchemaObject(target)) {
    delete target[property];
  }
}

function jsonPointerTarget(value: unknown, segments: string[]): unknown {
  let target: unknown = value;
  for (const segment of segments) {
    target = jsonPointerChild(target, segment);
    if (target === undefined) return undefined;
  }
  return target;
}

function jsonPointerChild(value: unknown, segment: string): unknown {
  if (Array.isArray(value)) {
    const index = Number(segment);
    return Number.isInteger(index) ? value[index] : undefined;
  }
  return isSchemaObject(value) ? value[segment] : undefined;
}

function isPayloadAdditionalPropertyError(error: ErrorObject): boolean {
  return (
    ["additionalProperties", "unevaluatedProperties"].includes(error.keyword) &&
    isPayloadPath(error.instancePath) &&
    unknownPropertyName(error) !== undefined
  );
}

function isPayloadPath(path: string): boolean {
  return path === "/payload" || path.startsWith("/payload/");
}

function isDeclaredEventProperty(record: TrailRecordLike, error: ErrorObject): boolean {
  const type = readString(record, "type");
  const propertyName = unknownPropertyName(error);
  const eventSchema = type === undefined ? undefined : schemaRoot.$defs?.events?.[type];
  if (eventSchema === undefined || propertyName === undefined) return false;
  return schemaDeclaresProperty(eventSchema, error.instancePath, propertyName);
}

function schemaDeclaresProperty(schemaNode: unknown, path: string, propertyName: string): boolean {
  return schemaNodeDeclaresProperty(schemaNode, jsonPointerSegments(path), propertyName, new Set());
}

function schemaNodeDeclaresProperty(
  schemaNode: unknown,
  pathSegments: string[],
  propertyName: string,
  seenRefs: Set<string>,
): boolean {
  const node = resolveSchemaRef(schemaNode, seenRefs);
  if (!isSchemaObject(node)) return false;

  if (pathSegments.length === 0) {
    return schemaNodeDeclaresCurrentProperty(node, propertyName, seenRefs);
  }

  if (schemaCompositionDeclaresProperty(node, pathSegments, propertyName, seenRefs)) return true;
  const [head, ...tail] = pathSegments;
  if (head === undefined || !isSchemaObject(node.properties)) return false;
  return schemaNodeDeclaresProperty(node.properties[head], tail, propertyName, seenRefs);
}

function schemaNodeDeclaresCurrentProperty(
  node: Record<string, unknown>,
  propertyName: string,
  seenRefs: Set<string>,
): boolean {
  return (
    (isSchemaObject(node.properties) && propertyName in node.properties) ||
    schemaCompositionDeclaresProperty(node, [], propertyName, seenRefs)
  );
}

function schemaCompositionDeclaresProperty(
  node: Record<string, unknown>,
  pathSegments: string[],
  propertyName: string,
  seenRefs: Set<string>,
): boolean {
  return (
    ["allOf", "anyOf", "oneOf"].some((key) =>
      schemaCollectionDeclaresProperty(node[key], pathSegments, propertyName, seenRefs),
    ) ||
    ["if", "then", "else"].some((key) =>
      schemaNodeDeclaresProperty(node[key], pathSegments, propertyName, seenRefs),
    )
  );
}

function schemaCollectionDeclaresProperty(
  schemaNode: unknown,
  pathSegments: string[],
  propertyName: string,
  seenRefs: Set<string>,
): boolean {
  return (
    Array.isArray(schemaNode) &&
    schemaNode.some((item) =>
      schemaNodeDeclaresProperty(item, pathSegments, propertyName, new Set(seenRefs)),
    )
  );
}

function resolveSchemaRef(schemaNode: unknown, seenRefs: Set<string>): unknown {
  if (!isSchemaObject(schemaNode) || typeof schemaNode.$ref !== "string") return schemaNode;
  if (seenRefs.has(schemaNode.$ref)) return schemaNode;
  seenRefs.add(schemaNode.$ref);
  const resolved = resolveLocalSchemaRef(schemaNode.$ref);
  return resolved === undefined ? schemaNode : resolveSchemaRef(resolved, seenRefs);
}

function resolveLocalSchemaRef(ref: string): unknown {
  if (!ref.startsWith("#/")) return undefined;
  return jsonPointerSegments(ref.slice(1)).reduce<unknown>(
    (current, segment) => (isSchemaObject(current) ? current[segment] : undefined),
    schemaRoot,
  );
}

function jsonPointerSegments(pointer: string): string[] {
  return pointer
    .split("/")
    .slice(1)
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
}

function isSchemaObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unknownPropertyName(error: ErrorObject): string | undefined {
  if (typeof error.params.additionalProperty === "string") return error.params.additionalProperty;
  if (typeof error.params.unevaluatedProperty === "string") return error.params.unevaluatedProperty;
  return undefined;
}

function eventSchemaErrors(record: TrailRecordLike): ErrorObject[] | undefined {
  const type = readString(record, "type");
  if (type === undefined) return undefined;
  const validator = eventValidator(type);
  if (validator === undefined) return undefined;
  validator(record);
  return validator.errors ?? [];
}

function eventValidator(type: string): ValidateFunction | undefined {
  const existing = eventValidators.get(type);
  if (existing !== undefined) return existing;
  if (schemaRoot.$defs?.events?.[type] === undefined) return undefined;
  const validator = ajv.compile({ $ref: `${schemaRoot.$id}#/$defs/events/${type}` });
  eventValidators.set(type, validator);
  return validator;
}

function pickRecordValidator(record: ParsedTrailRecord): ValidateFunction {
  if (record.record.type === "trail") return validateTrailEnvelope;
  if (record.record.type === "session") return validateHeader;
  if (record.line === 1) return validateHeader;
  return validateEntry;
}

function compileSchemaRef(ref: string): ValidateFunction {
  return ajv.compile({ $ref: ref });
}

function coalesceAjvErrors(errors: ErrorObject[]): ErrorObject[] {
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

function diagnosticPropertyName(error: ErrorObject): string | undefined {
  if (typeof error.params.missingProperty === "string") return error.params.missingProperty;
  return unknownPropertyName(error);
}

function isDowngradedByReaderTolerance(error: ErrorObject, warnings: TrailDiagnostic[]): boolean {
  return (
    isPayloadAdditionalPropertyError(error) &&
    warnings.some((warning) => warning.path === normalizeAjvPath(error))
  );
}

function schemaDiagnosticCode(error: ErrorObject, record: TrailRecordLike): string {
  if (record.type === "x-parse-error") return readString(record, "code") ?? "schema";
  if (error.instancePath === "/content_hash" && error.keyword === "pattern")
    return "content_hash_invalid";
  if (record.type === "session" && error.instancePath === "/schema_version") return "schema";
  return "schema";
}

function normalizeAjvPath(error: ErrorObject): string {
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
