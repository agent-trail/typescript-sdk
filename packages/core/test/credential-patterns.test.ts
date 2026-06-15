import { expect, test } from "bun:test";
import {
  BEARER_TOKEN,
  CREDENTIAL_PATTERNS,
  isCredentialKey,
  isOpaqueTokenValue,
  isSafeCredentialContextValue,
} from "../src/credential-patterns.js";

test("credential pattern seam exposes bearer token and credential-key helpers", () => {
  expect(CREDENTIAL_PATTERNS).toContain(BEARER_TOKEN);
  expect(
    "Authorization: Bearer abcdefABCDEF0123456789xyzXYZ".replace(
      BEARER_TOKEN.regex,
      BEARER_TOKEN.placeholder,
    ),
  ).toBe("Authorization: Bearer [TOKEN]");
  expect(isCredentialKey("database_url")).toBe(true);
  expect(isCredentialKey("checksum")).toBe(false);
  expect(isSafeCredentialContextValue("[CREDENTIAL_VALUE]")).toBe(true);
  expect(
    isOpaqueTokenValue("sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"),
  ).toBe(true);
});
