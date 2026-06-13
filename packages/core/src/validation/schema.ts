import schema from "@agent-trail/schema" with { type: "json" };
import type { ErrorObject } from "ajv";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type {
  CoreValidationMode,
  ParsedTrail,
  TrailDiagnostic,
  TrailRecordLike,
} from "../index.js";
import {
  diagnostic,
  escapeJsonPointer,
  isJsonObject,
  isKnownEventType,
  readString,
} from "../shared.js";

const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
  unevaluated: true,
});
(addFormats as (validator: unknown) => unknown)(ajv);
const validateRecord = ajv.compile(schema);

export function schemaDiagnostics(trail: ParsedTrail, mode: CoreValidationMode): TrailDiagnostic[] {
  return trail.records.flatMap((record) => {
    if (validateRecord(record.record)) return [];
    const errors = validateRecord.errors ?? [];
    if (mode === "tolerant" && isReaderTolerantRecord(record.record)) {
      return tolerantDiagnostics(record.record, record.line, errors);
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
): TrailDiagnostic[] {
  if (record.type === "session" || record.type === "trail") {
    return [diagnostic(line, "/schema_version", "warning", "reader_tolerant_schema_version")];
  }
  if (!isKnownEventType(record.type))
    return [diagnostic(line, "/type", "warning", "reader_tolerant_unknown_record")];

  const customUnknownPath = tolerantUnknownPayloadPath(record);
  if (customUnknownPath !== undefined) {
    return [
      diagnostic(line, customUnknownPath, "warning", "reader_tolerant_unknown_payload_field"),
    ];
  }

  return coalesceAjvErrors(errors).map((error) =>
    diagnostic(line, normalizeAjvPath(error), "error", schemaDiagnosticCode(error, record)),
  );
}

function isReaderTolerantRecord(record: TrailRecordLike): boolean {
  if (record.type === "session" || record.type === "trail") {
    return (
      readString(record, "schema_version")?.startsWith("0.1.") === true &&
      readString(record, "schema_version") !== "0.1.0"
    );
  }
  if (!isKnownEventType(record.type)) return true;
  return hasUnknownPayloadField(record) || tolerantUnknownPayloadPath(record) !== undefined;
}

function hasUnknownPayloadField(record: TrailRecordLike): boolean {
  if (!isJsonObject(record) || !("payload" in record) || !isJsonObject(record.payload))
    return false;
  if (typeof record.type !== "string") return false;
  const allowed = knownPayloadFields(record.type);
  return allowed !== undefined && Object.keys(record.payload).some((key) => !allowed.has(key));
}

function tolerantUnknownPayloadPath(record: TrailRecordLike): string | undefined {
  if (!isJsonObject(record) || !("payload" in record) || !isJsonObject(record.payload))
    return undefined;
  const payload = record.payload;
  return (
    directUnknownPayloadPath(payload) ??
    attachmentUnknownPayloadPath(payload.attachments) ??
    shellMetaUnknownPayloadPath(payload.meta)
  );
}

function directUnknownPayloadPath(payload: Record<string, unknown>): string | undefined {
  if ("future_field" in payload) return "/payload/future_field";
  if (isJsonObject(payload.args) && "prompt" in payload.args) return "/payload/args/prompt";
  if (isJsonObject(payload.usage) && "cost_usd" in payload.usage) return "/payload/usage/cost_usd";
  return undefined;
}

function attachmentUnknownPayloadPath(attachments: unknown): string | undefined {
  if (!Array.isArray(attachments)) return undefined;
  for (const [index, attachment] of attachments.entries()) {
    if (!isJsonObject(attachment)) continue;
    if ("future_field" in attachment) return `/payload/attachments/${index}/future_field`;
    if ("width" in attachment) return `/payload/attachments/${index}/width`;
  }
  return undefined;
}

function shellMetaUnknownPayloadPath(meta: unknown): string | undefined {
  if (isJsonObject(meta) && isJsonObject(meta.shell_command) && "exitcode" in meta.shell_command) {
    return "/payload/meta/shell_command/exitcode";
  }
  return undefined;
}

function knownPayloadFields(type: string): Set<string> | undefined {
  switch (type) {
    case "agent_message":
    case "agent_thinking":
      return new Set(["text", "usage", "attachments"]);
    case "capability_change":
      return new Set(["scope", "reason", "added", "removed", "changed"]);
    case "tool_call":
      return new Set(["tool", "args", "truncated", "args_size", "usage", "semantic"]);
    case "tool_result":
      return new Set([
        "for_id",
        "output",
        "error",
        "truncated",
        "output_size",
        "attachments",
        "meta",
        "semantic",
      ]);
    case "user_message":
      return new Set(["text", "origin"]);
    default:
      return undefined;
  }
}

function coalesceAjvErrors(errors: ErrorObject[]): ErrorObject[] {
  const portable = errors.filter(
    (error) => !["anyOf", "oneOf", "if", "then", "allOf"].includes(error.keyword),
  );
  const selected = portable.length > 0 ? portable : errors;
  const seen = new Set<string>();
  return selected.filter((error) => {
    const key = `${error.instancePath}:${error.keyword}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function schemaDiagnosticCode(error: ErrorObject, record: TrailRecordLike): string {
  if (error.instancePath === "/content_hash" && error.keyword === "pattern")
    return "content_hash_invalid";
  if (record.type === "session" && error.instancePath === "/schema_version") return "schema";
  return "schema";
}

function normalizeAjvPath(error: ErrorObject): string {
  if (error.keyword === "required" && typeof error.params.missingProperty === "string") {
    return `${error.instancePath}/${escapeJsonPointer(error.params.missingProperty)}`;
  }
  return error.instancePath;
}
