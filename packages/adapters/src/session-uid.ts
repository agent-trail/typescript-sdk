import { createHash } from "node:crypto";

/**
 * Per-adapter namespace UUIDs for deterministic `session_uid`/entry-id
 * derivation (spec §9.5). This module owns concrete-adapter identity policy;
 * `@agent-trail/adapter-kit` no longer exposes these implementation helpers.
 *
 * Namespace UUIDs below are arbitrary, random v4 UUIDs — they only need to be
 * stable forever. Changing one is a corpus-wide migration.
 */

const UUID_HYPHENATED_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const UUID_UNHYPHENATED_PATTERN = /^[0-9a-fA-F]{32}$/;
const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/;

export function canonicalizeIdentityString(value: string): string {
  if (UUID_HYPHENATED_PATTERN.test(value) || UUID_UNHYPHENATED_PATTERN.test(value)) {
    return value.toLowerCase();
  }
  if (ULID_PATTERN.test(value)) return value.toUpperCase();
  return value;
}

export function deriveSessionUid(namespace: string, upstreamId: string): string {
  return deriveUuidV5(namespace, upstreamId);
}

export function deriveSynthesizedEntryId(namespace: string, seedParts: readonly string[]): string {
  return deriveUuidV5(namespace, seedParts.join("\x1f"));
}

function deriveUuidV5(namespace: string, name: string): string {
  const namespaceBytes = uuidBytes(namespace);
  const hash = createHash("sha1").update(namespaceBytes).update(name, "utf8").digest();
  const bytes = Uint8Array.prototype.slice.call(hash, 0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  return formatUuid(bytes);
}

function uuidBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, "");
  if (hex.length !== 32 || /[^0-9a-fA-F]/.test(hex)) {
    throw new TypeError(`Invalid namespace UUID: ${uuid}`);
  }
  const bytes = new Uint8Array(16);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function formatUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** Namespace for Claude Code adapter session_uids. Stable forever — do not change. */
export const CLAUDE_CODE_SESSION_UID_NAMESPACE = "b4a0f5e1-7c23-4d8a-9e12-3f4b5c6d7e8f";

/** Namespace for Pi adapter session_uids. Stable forever — do not change. */
export const PI_SESSION_UID_NAMESPACE = "c5b1f6e2-8d34-4e9b-af23-405c6d7e8f90";

/** Namespace for Codex CLI adapter session_uids. Stable forever — do not change. */
export const CODEX_SESSION_UID_NAMESPACE = "d7e3a8f4-9f56-4abd-c045-627e8f9a0b12";

/** Namespace for OpenCode adapter session_uids. Stable forever — do not change. */
export const OPENCODE_SESSION_UID_NAMESPACE = "1b27edc8-d29a-4ef0-9472-7a0f2d4b6c81";

/**
 * Namespace for Codex CLI entry ids. Codex rollouts give us no per-record
 * uuid, so every entry id is derived from (session_uid, record_index,
 * entry_type) to keep re-parses idempotent per spec §9.5. Stable forever — do
 * not change.
 */
export const CODEX_ENTRY_ID_NAMESPACE = "e8f4b9a5-af67-4bcd-d156-738f9a0b1c23";

/** Namespace for OpenCode adapter entry ids. Stable forever — do not change. */
export const OPENCODE_ENTRY_ID_NAMESPACE = "2c38fed9-e3ab-4f01-a583-8b1f3e5c7d92";

/**
 * Namespace for Pi adapter entry ids. Real Pi envelopes carry 8-char hex
 * source ids that do not match the v0.1 `#/$defs/id` ULID/UUID pattern, so
 * every emitted entry id is derived from (session_uid, source_id [, suffix])
 * to satisfy the schema while staying idempotent across re-parses. Stable
 * forever — do not change.
 */
export const PI_ENTRY_ID_NAMESPACE = "f9a5cab6-b078-4cde-e267-849a0b1c2d34";

/**
 * Namespace for Claude Code adapter entry ids (source-uuid-bearing
 * envelopes: user, assistant, summary). Mirrors `PI_ENTRY_ID_NAMESPACE` —
 * real cc sessions ship UUID-shaped source uuids today so the deterministic
 * derivation is invisible in practice, but the path is identical to Pi's
 * (issue #137) and the v0.1 id contract holds for any shape source uuid.
 * Source-uuid-less envelopes (queue-operation, pr-link, permission-mode)
 * keep using `CLAUDE_CODE_SYNTHESIZED_ENTRY_ID_NAMESPACE`. Stable forever —
 * do not change.
 */
export const CLAUDE_CODE_ENTRY_ID_NAMESPACE = "0a16dbc7-c189-4def-f378-95ab1c2d3e45";
