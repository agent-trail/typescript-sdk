export function deleteJsonPointer(value: unknown, pointer: string): void {
  const segments = jsonPointerSegments(pointer);
  const property = segments.pop();
  if (property === undefined) return;

  const target = jsonPointerTarget(value, segments);
  if (isSchemaObject(target)) {
    delete target[property];
  }
}

export function jsonPointerSegments(pointer: string): string[] {
  return pointer
    .split("/")
    .slice(1)
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
}

export function isSchemaObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
