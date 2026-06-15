import { readFile } from "node:fs/promises";
import type { Entry } from "@agent-trail/types";
import { canonicalizeIdentityString } from "../session-uid.js";
import { enforceSourceRawSize, redactValue } from "../source-raw.js";

export const SOURCE_SCHEMA_VERSION = "v1";

export type Raw = Record<string, unknown>;

export type OpenCodeSessionSummary = {
  id: string;
  cwd: string;
  modifiedAt: string;
  path: string;
  version?: string | undefined;
};

export type OpenCodeMessage = Raw & {
  id: string;
  role?: string | undefined;
  time?: Raw | undefined;
};

export type OpenCodePart = Raw & {
  id: string;
  type?: string | undefined;
  messageID?: string | undefined;
  message_id?: string | undefined;
  time?: Raw | undefined;
};

export type OpenCodeTodo = Raw & {
  content?: string | undefined;
  status?: string | undefined;
  position?: number | undefined;
  time?: Raw | undefined;
};

export type LoadedSession = {
  session: Raw;
  project?: Raw | undefined;
  messages: OpenCodeMessage[];
  partsByMessage: Map<string, OpenCodePart[]>;
  todos: OpenCodeTodo[];
  sessionMessages: Raw[];
  permissions: Raw[];
};

export function isObject(value: unknown): value is Raw {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function objectValue(value: unknown): Raw | undefined {
  return isObject(value) ? value : undefined;
}

export function arrayValue(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

export function timestampToIso(value: unknown): string | undefined {
  try {
    const n = numberValue(value);
    if (n !== undefined) return dateToIso(n);
    const s = stringValue(value);
    return s === undefined ? undefined : stringTimestampToIso(s);
  } catch {
    return undefined;
  }
}

function stringTimestampToIso(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  const ms = Number(trimmed);
  return Number.isFinite(ms) ? dateToIso(ms) : dateToIso(Date.parse(trimmed));
}

function dateToIso(value: number): string | undefined {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export async function readJsonFile(path: string): Promise<Raw | undefined> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    return isObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function parsedJsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function parsedJsonObject(text: unknown): Raw {
  if (isObject(text)) return text;
  if (typeof text !== "string") return {};
  try {
    const parsed = JSON.parse(text);
    return isObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizedSourceRaw(raw: Raw, rawType: string): Raw {
  const redacted = redactValue(raw) as Raw;
  const sourceType = normalizedSourceType(rawType);
  if (sourceType === "part") {
    return { type: sourceType, part_type: stringValue(raw.type) ?? "tool", data: redacted };
  }
  if (sourceType === "session_message") {
    return { type: sourceType, event_type: stringValue(raw.type), data: redacted };
  }
  return { type: sourceType, data: redacted };
}

function normalizedSourceType(rawType: string): string {
  if (rawType.startsWith("part.") || rawType.startsWith("tool.")) return "part";
  if (rawType.startsWith("session_message.")) return "session_message";
  if (rawType.startsWith("session.")) return "session";
  if (rawType.startsWith("project.")) return "project";
  return rawType;
}

export function sourceFor(
  raw: Raw,
  rawType: string,
  schemaVersion: string | undefined,
): Entry["source"] {
  const normalized = normalizedSourceRaw(raw, rawType);
  return {
    agent: "opencode",
    original_type: rawType,
    ...(schemaVersion !== undefined ? { schema_version: schemaVersion } : {}),
    raw: enforceSourceRawSize(normalized).value as Raw,
  };
}

export function metaFor(rawType: string): Entry["meta"] {
  return { "dev.opencode.raw_type": rawType };
}

export function sourceId(raw: Raw, fallback: string): string {
  return canonicalizeIdentityString(stringValue(raw.id) ?? fallback);
}

export function partTimestamp(part: Raw, message?: Raw): string {
  const time = objectValue(part.time);
  const messageTime = objectValue(message?.time);
  return (
    timestampToIso(time?.created) ??
    timestampToIso(time?.updated) ??
    timestampToIso(part.time_created) ??
    timestampToIso(part.time_updated) ??
    timestampToIso(messageTime?.created) ??
    timestampToIso(messageTime?.updated) ??
    timestampToIso(message?.time_created) ??
    timestampToIso(message?.time_updated) ??
    new Date(0).toISOString()
  );
}

export function modelName(value: unknown): string | undefined {
  const obj = objectValue(value);
  if (obj !== undefined) {
    const id = stringValue(obj.id) ?? stringValue(obj.modelID);
    const provider = stringValue(obj.providerID) ?? stringValue(obj.provider);
    if (id !== undefined && provider !== undefined) return `${provider}/${id}`;
    return id;
  }
  return stringValue(value);
}
