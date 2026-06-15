import { CREDENTIAL_PATTERNS, type RedactionPattern } from "@agent-trail/core/credential-patterns";

export {
  CREDENTIAL_CONTEXT_PLACEHOLDER,
  isCredentialKey,
  isOpaqueTokenValue,
  isSafeCredentialContextValue,
  type RedactionPattern,
} from "@agent-trail/core/credential-patterns";

const HOME_PATH: RedactionPattern = {
  id: "home_path",
  description: "User home directory path",
  regex: /\/(?:Users|home)\/[^/\s"'`]+/g,
  placeholder: "<home>",
};

const HOME_PATH_WINDOWS: RedactionPattern = {
  id: "home_path_windows",
  description: "Windows user profile directory path",
  regex: /[A-Za-z]:[\\/]Users[\\/][^\\/\s"'`]+/g,
  placeholder: "<home>",
};

/**
 * Built-in secret redaction patterns used by default.
 *
 * @public
 */
export const DEFAULT_PATTERNS: RedactionPattern[] = [
  ...CREDENTIAL_PATTERNS,
  HOME_PATH,
  HOME_PATH_WINDOWS,
];
