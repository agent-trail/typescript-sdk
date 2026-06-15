import { deriveSeededUuidV5 } from "@agent-trail/core/identity";

/**
 * Deterministic id derivation shared by all adapters (spec §9.5).
 *
 * Adapters must mint stable ids: the same upstream session re-parsed twice has
 * to produce the same `session_uid` and entry ids, or the reconciler cannot
 * group/dedup. RFC 4122 UUIDv5 derives a stable UUID from
 * `(namespace_uuid, name_string)` via SHA-1; per-adapter namespaces keep
 * cross-agent collisions impossible while making re-parses idempotent.
 *
 * Namespace UUIDs live with each adapter (or `defineAdapter` config) — these
 * helpers are namespace-agnostic and carry no adapter knowledge.
 */

/**
 * Derive a deterministic v5 UUID from `(namespace, upstreamId)` per RFC 4122
 * §4.3. Output is the hyphenated 36-char form accepted by the `session_uid`
 * schema (ULID/UUID union).
 */
/**
 * Derive a deterministic v5 UUID for an entry id synthesized by an adapter or
 * the mapping engine. Seed parts are joined with the ASCII unit separator
 * (\x1f) so that distinct part sequences cannot alias each other.
 */
export function deriveSynthesizedEntryId(namespace: string, seedParts: readonly string[]): string {
  return deriveSeededUuidV5(namespace, seedParts);
}
