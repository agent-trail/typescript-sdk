import type { RenderMeta } from "./types.js";

/** @internal */
export function objectValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** @internal */
export function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** @internal */
export function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** @internal */
export function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

/** @internal */
export function cappedJson(value: unknown, maxLength = 2_000): string {
  const formatter = new BoundedJsonFormatter(maxLength);
  return formatter.format(value);
}

/** @internal */
export function optionalMeta(label: string, value: string | undefined): RenderMeta[] {
  return value === undefined || value.length === 0 ? [] : [{ label, value }];
}

/** @internal */
export function optionalToolField<K extends string>(
  key: K,
  value: string | undefined,
): Record<K, string> {
  return value === undefined || value.length === 0
    ? ({} as Record<K, string>)
    : ({ [key]: value } as Record<K, string>);
}

/** @internal */
export function compactValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null) return "null";
  return cappedJson(value, 240);
}

/** @internal */
export function truncatePreview(value: string): string {
  return value.length > 48 ? `${value.slice(0, 45)}...` : value;
}

class BoundedJsonFormatter {
  private readonly parts: string[] = [];
  private readonly seen = new Set<object>();
  private remaining: number;
  private truncated = false;

  constructor(maxLength: number) {
    this.remaining = Math.max(0, maxLength);
  }

  format(value: unknown): string {
    this.writeValue(value, 0);
    const text = this.parts.join("");
    return this.truncated ? `${text}\n... truncated` : text;
  }

  private writeValue(value: unknown, depth: number): void {
    if (this.truncated) return;
    if (value === null) {
      this.append("null");
      return;
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      this.append(JSON.stringify(value));
      return;
    }
    if (Array.isArray(value)) {
      this.writeArray(value, depth);
      return;
    }
    if (typeof value === "object") {
      this.writeObject(value as Record<string, unknown>, depth);
      return;
    }
    this.append(JSON.stringify(String(value)));
  }

  private writeArray(value: readonly unknown[], depth: number): void {
    if (this.enterContainer(value, depth, "[")) return;
    for (let index = 0; index < value.length && !this.truncated; index += 1) {
      this.append(`${index === 0 ? "" : ","}\n${this.indent(depth + 1)}`);
      this.writeValue(value[index], depth + 1);
    }
    this.leaveContainer(value, depth, value.length > 0, "]");
  }

  private writeObject(value: Record<string, unknown>, depth: number): void {
    if (this.enterContainer(value, depth, "{")) return;
    let wroteEntry = false;
    for (const key in value) {
      if (!Object.hasOwn(value, key) || this.truncated) continue;
      this.append(`${wroteEntry ? "," : ""}\n${this.indent(depth + 1)}${JSON.stringify(key)}: `);
      this.writeValue(value[key], depth + 1);
      wroteEntry = true;
    }
    this.leaveContainer(value, depth, wroteEntry, "}");
  }

  private enterContainer(value: object, depth: number, opener: string): boolean {
    if (depth >= 12) {
      this.append(JSON.stringify("[MaxDepth]"));
      return true;
    }
    if (this.seen.has(value)) {
      this.append(JSON.stringify("[Circular]"));
      return true;
    }
    this.seen.add(value);
    this.append(opener);
    return false;
  }

  private leaveContainer(value: object, depth: number, wroteEntry: boolean, closer: string): void {
    this.seen.delete(value);
    if (this.truncated) return;
    this.append(`${wroteEntry ? `\n${this.indent(depth)}` : ""}${closer}`);
  }

  private append(text: string): void {
    if (this.truncated) return;
    if (text.length <= this.remaining) {
      this.parts.push(text);
      this.remaining -= text.length;
      return;
    }
    this.parts.push(text.slice(0, this.remaining));
    this.remaining = 0;
    this.truncated = true;
  }

  private indent(depth: number): string {
    return "  ".repeat(depth);
  }
}
