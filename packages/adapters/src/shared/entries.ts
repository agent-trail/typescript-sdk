import type { AgentName, Entry } from "@agent-trail/types";
import { enforceSourceRawSize, redactValue } from "./source-raw.js";

export type SourceForOptions = {
  synthesized?: boolean;
  envelopeRef?: string | undefined;
  schemaVersion?: string | undefined;
};

export type CreateSourceForConfig<Env> = {
  agent: AgentName;
  resolveSchemaVersion: (envelope: Env, options?: SourceForOptions) => string | undefined;
};

export function createSourceFor<Env extends object, Block extends object>(
  config: CreateSourceForConfig<Env>,
): (
  envelope: Env,
  originalType: string | undefined,
  block?: Block,
  blockIndex?: number,
  options?: SourceForOptions,
) => NonNullable<Entry["source"]> {
  return (envelope, originalType, block, blockIndex, options) => {
    const schemaVersion = config.resolveSchemaVersion(envelope, options);
    return {
      agent: config.agent,
      ...(originalType !== undefined ? { original_type: originalType } : {}),
      ...(schemaVersion !== undefined ? { schema_version: schemaVersion } : {}),
      ...(options?.synthesized === true ? { synthesized: true } : {}),
      raw: buildRaw(envelope, block, blockIndex, options?.envelopeRef),
    };
  };
}

function buildRaw<Env extends object, Block extends object>(
  envelope: Env,
  block: Block | undefined,
  blockIndex: number | undefined,
  envelopeRef: string | undefined,
): Record<string, unknown> {
  if (envelopeRef !== undefined) {
    const raw = {
      envelope_ref: envelopeRef,
      ...(block !== undefined ? { block: redactValue(block) as Block } : {}),
      ...(blockIndex !== undefined ? { block_index: blockIndex } : {}),
    };
    return enforceSourceRawSize(raw).value as Record<string, unknown>;
  }
  if (block === undefined) {
    return enforceSourceRawSize(redactValue(envelope) as Record<string, unknown>).value as Record<
      string,
      unknown
    >;
  }
  const inline = {
    envelope: redactValue(envelope) as Env,
    block: redactValue(block) as Block,
    block_index: blockIndex,
  };
  return enforceSourceRawSize(inline).value as Record<string, unknown>;
}
