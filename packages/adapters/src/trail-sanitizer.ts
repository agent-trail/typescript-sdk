const REPLACEMENT_CHARACTER = "\ufffd";

export function sanitizeJsonString(value: string): string {
  let out = "";
  let changed = false;

  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (isHighSurrogate(code)) {
      const pair = validSurrogatePair(value, i);
      if (pair !== undefined) {
        out += pair;
        i += 1;
        continue;
      }
      out += REPLACEMENT_CHARACTER;
      changed = true;
      continue;
    }
    if (isLowSurrogate(code)) {
      out += REPLACEMENT_CHARACTER;
      changed = true;
      continue;
    }
    out += value[i] ?? "";
  }

  return changed ? out : value;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

function validSurrogatePair(value: string, index: number): string | undefined {
  const next = value.charCodeAt(index + 1);
  if (!isLowSurrogate(next)) return undefined;
  return `${value[index] ?? ""}${value[index + 1] ?? ""}`;
}

export function sanitizeJsonStrings<T>(value: T): T {
  if (typeof value === "string") {
    return sanitizeJsonString(value) as T;
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (!needsJsonStringSanitization(value)) {
    return value;
  }

  return cloneSanitizedJsonStrings(value) as T;
}

function needsJsonStringSanitization(value: object): boolean {
  const seen = new WeakSet<object>();
  const stack: object[] = [value];
  seen.add(value);

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) continue;

    if (Array.isArray(current)) {
      if (arrayNeedsSanitization(current, seen, stack)) return true;
      continue;
    }

    if (objectNeedsSanitization(current as Record<string, unknown>, seen, stack)) return true;
  }

  return false;
}

function arrayNeedsSanitization(
  array: readonly unknown[],
  seen: WeakSet<object>,
  stack: object[],
): boolean {
  for (const child of array) {
    if (valueNeedsSanitization(child, seen, stack)) return true;
  }
  return false;
}

function objectNeedsSanitization(
  object: Record<string, unknown>,
  seen: WeakSet<object>,
  stack: object[],
): boolean {
  for (const key of Object.keys(object)) {
    if (sanitizeJsonString(key) !== key) return true;
    if (valueNeedsSanitization(object[key], seen, stack)) return true;
  }
  return false;
}

function valueNeedsSanitization(value: unknown, seen: WeakSet<object>, stack: object[]): boolean {
  if (typeof value === "string") return sanitizeJsonString(value) !== value;
  if (value === null || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  stack.push(value);
  return false;
}

function cloneSanitizedJsonStrings(value: object): object {
  const root = Array.isArray(value) ? new Array(value.length) : {};
  const seen = new WeakMap<object, object>([[value, root]]);
  const stack: Array<{ source: object; target: object }> = [{ source: value, target: root }];

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) continue;
    const { source, target } = current;

    if (Array.isArray(source)) {
      cloneArrayChildren(source, target as unknown[], seen, stack);
      continue;
    }

    cloneObjectChildren(
      source as Record<string, unknown>,
      target as Record<string, unknown>,
      seen,
      stack,
    );
  }

  return root;
}

function cloneArrayChildren(
  source: readonly unknown[],
  target: unknown[],
  seen: WeakMap<object, object>,
  stack: Array<{ source: object; target: object }>,
): void {
  for (let i = 0; i < source.length; i += 1) {
    target[i] = cloneSanitizedChild(source[i], seen, stack);
  }
}

function cloneObjectChildren(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  seen: WeakMap<object, object>,
  stack: Array<{ source: object; target: object }>,
): void {
  for (const key of Object.keys(source)) {
    target[sanitizeJsonString(key)] = cloneSanitizedChild(source[key], seen, stack);
  }
}

function cloneSanitizedChild(
  child: unknown,
  seen: WeakMap<object, object>,
  stack: Array<{ source: object; target: object }>,
): unknown {
  if (typeof child === "string") return sanitizeJsonString(child);
  if (child === null || typeof child !== "object") return child;

  const existing = seen.get(child);
  if (existing !== undefined) return existing;

  const cloned = Array.isArray(child) ? new Array(child.length) : {};
  seen.set(child, cloned);
  stack.push({ source: child, target: cloned });
  return cloned;
}

export function sanitizeTrailFile<T extends object>(trail: T): T {
  return sanitizeJsonStrings(trail);
}
