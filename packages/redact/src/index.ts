export type { TrailJsonlInput } from "@agent-trail/core";
export type { RedactionConfig, ResolveRedactionConfigOptions } from "./packs.js";
export { resolveRedactionConfig } from "./packs.js";
export { DEFAULT_PATTERNS } from "./patterns.js";
export { redactTrailJsonl } from "./redactor.js";
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
} from "./types.js";
