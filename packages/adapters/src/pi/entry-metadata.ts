import { createSourceFor } from "../shared/entries.js";
import type { PiBlock, PiEnvelope } from "./source.js";
import { versionString } from "./source.js";

// Builds each entry's `source` block from a Pi envelope (+ optional content
// block), reproducing `source.agent`/`schema_version`/`original_type`/`raw`
// byte-for-byte. Shared by the kit mappings — see pi/mappings.ts.
export const sourceFor = createSourceFor<PiEnvelope, PiBlock>({
  agent: "pi",
  resolveSchemaVersion: (envelope, options) =>
    versionString(envelope.version) ?? options?.schemaVersion,
});
