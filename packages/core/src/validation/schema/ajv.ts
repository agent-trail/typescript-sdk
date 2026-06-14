import schema from "@agent-trail/schema" with { type: "json" };
import type { ErrorObject, ValidateFunction } from "ajv";
import Ajv2020 from "ajv/dist/2020.js";
import type { ParsedTrailRecord, TrailRecordLike } from "../../index.js";
import { readString } from "../../shared.js";

type SchemaRoot = {
  $id: string;
  $defs?: Record<string, unknown> & { events?: Record<string, unknown> };
};

const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
  validateFormats: false,
  unevaluated: true,
});

export const schemaRoot = schema as SchemaRoot;

ajv.addSchema(schema);

const validateTrailEnvelope = compileSchemaRef(`${schemaRoot.$id}#/$defs/trailEnvelope`);
const validateHeader = compileSchemaRef(`${schemaRoot.$id}#/$defs/header`);
export const validateEntry = compileSchemaRef(`${schemaRoot.$id}#/$defs/entry`);
export const validateEntryBase = compileSchemaRef(`${schemaRoot.$id}#/$defs/entryBase`);

const eventValidators = new Map<string, ValidateFunction>();

export function eventSchemaErrors(record: TrailRecordLike): ErrorObject[] | undefined {
  const type = readString(record, "type");
  if (type === undefined) return undefined;
  const validator = eventValidator(type);
  if (validator === undefined) return undefined;
  validator(record);
  return validator.errors ?? [];
}

export function eventValidator(type: string): ValidateFunction | undefined {
  const existing = eventValidators.get(type);
  if (existing !== undefined) return existing;
  if (schemaRoot.$defs?.events === undefined || !Object.hasOwn(schemaRoot.$defs.events, type))
    return undefined;
  const validator = ajv.compile({ $ref: `${schemaRoot.$id}#/$defs/events/${type}` });
  eventValidators.set(type, validator);
  return validator;
}

export function pickRecordValidator(record: ParsedTrailRecord): ValidateFunction {
  if (record.record.type === "trail") return validateTrailEnvelope;
  if (record.record.type === "session") return validateHeader;
  if (record.line === 1) return validateHeader;
  return validateEntry;
}

function compileSchemaRef(ref: string): ValidateFunction {
  return ajv.compile({ $ref: ref });
}
