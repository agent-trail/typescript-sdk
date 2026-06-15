import type { MappingDef } from "@agent-trail/adapter-kit";
import { capabilityMappings } from "./mapping/capabilities.js";
import { messageMappings } from "./mapping/messages.js";
import { metadataMappings } from "./mapping/metadata.js";
import type { Raw } from "./mapping/shared.js";
import { systemMappings } from "./mapping/system.js";

export {
  type CcHint,
  HINT,
  INCLUDE_SIDECHAIN,
  INLINE_ATTACHMENT_MAX_DECODED_BYTES,
} from "./mapping/shared.js";

export const claudeCodeMappings: MappingDef<Raw>[] = [
  ...messageMappings,
  ...metadataMappings,
  ...capabilityMappings,
  ...systemMappings,
];
