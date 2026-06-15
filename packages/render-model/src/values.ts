import type { RenderMeta } from "./types.js";

export function objectValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function cappedJson(value: unknown, maxLength = 2_000): string {
  const text = JSON.stringify(value, null, 2) ?? "";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}\n... truncated`;
}

export function optionalMeta(label: string, value: string | undefined): RenderMeta[] {
  return value === undefined || value.length === 0 ? [] : [{ label, value }];
}

export function optionalToolField<K extends string>(
  key: K,
  value: string | undefined,
): Record<K, string> {
  return value === undefined || value.length === 0
    ? ({} as Record<K, string>)
    : ({ [key]: value } as Record<K, string>);
}

export function compactValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null) return "null";
  return cappedJson(value, 240);
}

export function truncatePreview(value: string): string {
  return value.length > 48 ? `${value.slice(0, 45)}...` : value;
}
