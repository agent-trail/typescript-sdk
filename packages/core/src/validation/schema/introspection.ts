import type { ErrorObject } from "ajv";
import type { TrailRecordLike } from "../../index.js";
import { readString } from "../../shared.js";
import { schemaRoot } from "./ajv.js";
import { unknownPropertyName } from "./errors.js";
import { isSchemaObject, jsonPointerSegments } from "./pointers.js";

export function isDeclaredEventProperty(record: TrailRecordLike, error: ErrorObject): boolean {
  const type = readString(record, "type");
  const propertyName = unknownPropertyName(error);
  const eventSchema =
    type !== undefined &&
    schemaRoot.$defs?.events !== undefined &&
    Object.hasOwn(schemaRoot.$defs.events, type)
      ? schemaRoot.$defs.events[type]
      : undefined;
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
