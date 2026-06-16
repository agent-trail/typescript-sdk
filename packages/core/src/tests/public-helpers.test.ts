import { expect, test } from "bun:test";
import {
  canonicalizeIdentityString,
  deriveSeededUuidV5,
  deriveUuidV5,
  isCredentialKey,
  isOpaqueTokenValue,
  isSafeCredentialContextValue,
} from "../index.ts";

const namespace = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test("identity helpers canonicalize common source ids", () => {
  expect(canonicalizeIdentityString("A987FBC9-4BED-4078-8F07-9141BA07C9F3")).toBe(
    "a987fbc9-4bed-4078-8f07-9141ba07c9f3",
  );
  expect(canonicalizeIdentityString("A987FBC94BED40788F079141BA07C9F3")).toBe(
    "a987fbc94bed40788f079141ba07c9f3",
  );
  expect(canonicalizeIdentityString("01hzzzzzzzzzzzzzzzzzzzzz01")).toBe(
    "01HZZZZZZZZZZZZZZZZZZZZZ01",
  );
  expect(canonicalizeIdentityString("session-local-id")).toBe("session-local-id");
});

test("identity helpers derive stable RFC 4122 v5 UUIDs", () => {
  const first = deriveUuidV5(namespace, "agent-trail/session-a");
  const second = deriveUuidV5(namespace, "agent-trail/session-a");

  expect(first).toBe(second);
  expect(first).toMatch(uuidPattern);
  expect(deriveUuidV5(namespace, "agent-trail/session-b")).not.toBe(first);
  expect(() => deriveUuidV5("not-a-uuid", "agent-trail/session-a")).toThrow(
    "Invalid namespace UUID",
  );
});

test("seeded UUID helper preserves ordered seed-part boundaries", () => {
  const seeded = deriveSeededUuidV5(namespace, ["agent", "session", "a"]);

  expect(seeded).toBe(deriveSeededUuidV5(namespace, ["agent", "session", "a"]));
  expect(seeded).not.toBe(deriveSeededUuidV5(namespace, ["agent-session", "a"]));
  expect(seeded).not.toBe(deriveSeededUuidV5(namespace, ["agent", "session-a"]));
});

test("credential pattern helpers classify key names and safe values", () => {
  expect(isCredentialKey("api_key")).toBe(true);
  expect(isCredentialKey("accessToken")).toBe(true);
  expect(isCredentialKey("database_url")).toBe(true);
  expect(isCredentialKey("postgres_dsn")).toBe(true);
  expect(isCredentialKey("session_id")).toBe(false);
  expect(isCredentialKey(undefined)).toBe(false);

  expect(isSafeCredentialContextValue("")).toBe(true);
  expect(isSafeCredentialContextValue("[OPENAI_KEY]")).toBe(true);
  expect(isSafeCredentialContextValue("<pending>")).toBe(true);
  expect(isSafeCredentialContextValue("sk-live-secret-value")).toBe(false);

  expect(isOpaqueTokenValue("A987FBC9-4BED-4078-8F07-9141BA07C9F3")).toBe(true);
  expect(isOpaqueTokenValue(`sha256:${"a".repeat(64)}`)).toBe(true);
  expect(isOpaqueTokenValue("b".repeat(64))).toBe(true);
  expect(isOpaqueTokenValue("sk-live-secret-value")).toBe(false);
});
