import type { MappingDef } from "@agent-trail/adapter-kit";
import { branchMappings, branchStateMappings, branchVariantMappings } from "./mapping/branching.js";
import { compactionMappings, compactionVariantMappings } from "./mapping/compaction.js";
import { createPiMappingContext } from "./mapping/context.js";
import { customMappings, customVariantMappings } from "./mapping/custom.js";
import { messageMappings } from "./mapping/messages.js";
import { metadataMappings } from "./mapping/metadata.js";
import type { PiEnvelope } from "./source.js";

export { PARENT_HINT, type ParentHint } from "./mapping/shared.js";

/**
 * Build a mapping set bound to the session's source `version` string (e.g. "3").
 * v1 stamps `source.schema_version` from the session record's version on every
 * entry (message records carry no version of their own), so v2 must thread it
 * through the shared `sourceFor` helper to reproduce `source` byte-for-byte.
 */
export function makePiMappings(sessionVersion: string | undefined): MappingDef<PiEnvelope>[] {
  const ctx = createPiMappingContext(sessionVersion);

  return [
    ...messageMappings(ctx),
    ...customVariantMappings(ctx),
    ...branchVariantMappings(ctx),
    ...compactionVariantMappings(ctx),
    ...branchMappings(ctx),
    ...compactionMappings(ctx),
    ...metadataMappings(ctx),
    ...customMappings(ctx),
    ...branchStateMappings(ctx),
  ];
}
