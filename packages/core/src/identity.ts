import { createHash } from "node:crypto";

const UUID_HYPHENATED_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const UUID_UNHYPHENATED_PATTERN = /^[0-9a-fA-F]{32}$/;
const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/;

/**
 * Normalize source identity strings before deterministic id derivation.
 *
 * @public
 */
export function canonicalizeIdentityString(value: string): string {
  if (UUID_HYPHENATED_PATTERN.test(value) || UUID_UNHYPHENATED_PATTERN.test(value)) {
    return value.toLowerCase();
  }
  if (ULID_PATTERN.test(value)) return value.toUpperCase();
  return value;
}

/**
 * Derive a deterministic RFC 4122 v5 UUID from a namespace UUID and source id.
 *
 * @public
 */
export function deriveUuidV5(namespace: string, name: string): string {
  const namespaceBytes = uuidBytes(namespace);
  const hash = createHash("sha1").update(namespaceBytes).update(name, "utf8").digest();
  const bytes = Uint8Array.prototype.slice.call(hash, 0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  return formatUuid(bytes);
}

/**
 * Derive a deterministic v5 UUID from ordered seed parts.
 *
 * @public
 */
export function deriveSeededUuidV5(namespace: string, seedParts: readonly string[]): string {
  return deriveUuidV5(namespace, seedParts.join("\x1f"));
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
