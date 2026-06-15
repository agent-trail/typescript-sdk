/**
 * Redaction APIs for transforming Agent Trail JSONL before sharing or export.
 *
 * @packageDocumentation
 */

export type { TrailJsonlInput } from "@agent-trail/core";
export type { RedactionConfig, ResolveRedactionConfigOptions } from "./config/packs.js";
export { resolveRedactionConfig } from "./config/packs.js";
export { DEFAULT_PATTERNS } from "./patterns/patterns.js";
export type {
  LoadedRedactionPack,
  PiiConfig,
  RedactedSessionGroup,
  RedactedTrail,
  RedactedTrailRecord,
  RedactionPackSource,
  RedactionPackSummary,
  RedactionPattern,
  RedactionSample,
  RedactionSummary,
  RedactTrailJsonlInput,
  RedactTrailOptions,
  RedactTrailResult,
} from "./public/types.js";
export { redactTrailJsonl } from "./transform/redactor.js";
