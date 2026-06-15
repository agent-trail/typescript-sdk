import safeRegex from "safe-regex2";

const MAX_REGEX_SOURCE_LENGTH = 512;

export function assertSafeRegexSource(source: string, label: string): void {
  if (source.length > MAX_REGEX_SOURCE_LENGTH) {
    throw new Error(`${label} regex exceeds ${MAX_REGEX_SOURCE_LENGTH} characters`);
  }
  try {
    new RegExp(source, "g");
  } catch {
    throw new Error(`${label} regex is invalid`);
  }
  if (hasBackreference(source)) throw new Error(`${label} regex backreferences are not supported`);
  if (hasLookaround(source)) throw new Error(`${label} regex lookaround is not supported`);
  if (hasNestedUnboundedQuantifier(source)) {
    throw new Error(`${label} regex has nested unbounded quantifiers`);
  }
  if (hasQuantifiedAlternation(source)) {
    throw new Error(`${label} regex has quantified alternation`);
  }
  if (!safeRegex(source, { limit: 25 })) throw new Error(`${label} regex is unsafe`);
}

function hasBackreference(source: string): boolean {
  for (const { char, index } of regexTokens(source)) {
    if (char !== "\\") continue;
    const next = source[index + 1] ?? "";
    const afterNext = source[index + 2] ?? "";
    if (/[1-9]/.test(next) || (next === "k" && afterNext === "<")) return true;
  }
  return false;
}

function hasLookaround(source: string): boolean {
  for (const { char, index } of regexTokens(source)) {
    if (char !== "(" || source[index + 1] !== "?") continue;
    const marker = source[index + 2];
    if (marker === "=" || marker === "!") return true;
    if (marker === "<") {
      const lookbehindMarker = source[index + 3];
      if (lookbehindMarker === "=" || lookbehindMarker === "!") return true;
    }
  }
  return false;
}

function hasNestedUnboundedQuantifier(source: string): boolean {
  const stack: Array<{ start: number; hasQuantifier: boolean }> = [];
  for (const { char, index } of regexTokens(source)) {
    if (char === "(") pushNestedGroup(stack, index);
    else if (isQuantifierStart(source, index)) markNestedQuantifier(stack, index);
    else if (char === ")" && closeNestedGroup(source, stack, index)) return true;
  }
  return false;
}

function hasQuantifiedAlternation(source: string): boolean {
  const stack: Array<{ hasAlternation: boolean }> = [];
  for (const { char, index } of regexTokens(source)) {
    if (char === "(") stack.push({ hasAlternation: false });
    else if (char === ")" && closeAlternationGroup(source, stack, index)) return true;
    else if (char === "|") markAlternation(stack);
  }
  return false;
}

function* regexTokens(source: string): Generator<{ char: string; index: number }> {
  let inClass = false;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (char === undefined || isEscaped(source, i)) continue;
    if (char === "[" && !inClass) {
      inClass = true;
      continue;
    }
    if (char === "]" && inClass) {
      inClass = false;
      continue;
    }
    if (!inClass) yield { char, index: i };
  }
}

function pushNestedGroup(
  stack: Array<{ start: number; hasQuantifier: boolean }>,
  index: number,
): void {
  stack.push({ start: index, hasQuantifier: false });
}

function markNestedQuantifier(
  stack: Array<{ start: number; hasQuantifier: boolean }>,
  index: number,
): void {
  const current = stack.at(-1);
  if (current !== undefined && index > current.start + 1) current.hasQuantifier = true;
}

function closeNestedGroup(
  source: string,
  stack: Array<{ start: number; hasQuantifier: boolean }>,
  index: number,
): boolean {
  const group = stack.pop();
  if (group === undefined) return false;
  if (group.hasQuantifier && isUnboundedQuantifierAfter(source, index + 1)) return true;
  const parent = stack.at(-1);
  if (parent !== undefined && group.hasQuantifier) parent.hasQuantifier = true;
  return false;
}

function closeAlternationGroup(
  source: string,
  stack: Array<{ hasAlternation: boolean }>,
  index: number,
): boolean {
  if (stack.length === 0) return false;
  const group = stack.pop();
  if (group?.hasAlternation && isQuantifierAfter(source, index + 1)) return true;
  const parent = stack.at(-1);
  if (parent !== undefined && group?.hasAlternation) parent.hasAlternation = true;
  return false;
}

function markAlternation(stack: Array<{ hasAlternation: boolean }>): void {
  const current = stack.at(-1);
  if (current !== undefined) current.hasAlternation = true;
}

function isQuantifierStart(source: string, index: number): boolean {
  const char = source[index];
  if (char === "*" || char === "+") return true;
  if (char !== "{") return false;
  const close = source.indexOf("}", index + 1);
  if (close === -1) return false;
  return /^\{\d+(?:,\d*)?\}$/.test(source.slice(index, close + 1));
}

function isUnboundedQuantifierAfter(source: string, index: number): boolean {
  const char = source[index];
  if (char === "*" || char === "+") return true;
  if (char !== "{") return false;
  const close = source.indexOf("}", index + 1);
  if (close === -1) return false;
  return /^\{\d+,\}$/.test(source.slice(index, close + 1));
}

function isQuantifierAfter(source: string, index: number): boolean {
  const char = source[index];
  if (char === "*" || char === "+" || char === "?") return true;
  if (char !== "{") return false;
  const close = source.indexOf("}", index + 1);
  if (close === -1) return false;
  return /^\{\d+(?:,\d*)?\}$/.test(source.slice(index, close + 1));
}

function isEscaped(source: string, index: number): boolean {
  let slashCount = 0;
  for (let i = index - 1; i >= 0 && source[i] === "\\"; i -= 1) slashCount += 1;
  return slashCount % 2 === 1;
}
