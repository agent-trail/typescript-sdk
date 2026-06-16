import { readFile } from "node:fs/promises";
import { markGistShared } from "@agent-trail/catalog";
import { redactTrailJsonl } from "@agent-trail/redact";
import { findGeneratedTrail } from "./shared.js";
import type { ShareSessionOptions, ShareSessionResult } from "./types.js";

/**
 * Redact and share a generated trail through an injected transport.
 *
 * @public
 */
export async function shareSession(options: ShareSessionOptions): Promise<ShareSessionResult> {
  if (options.transport === undefined) {
    return { status: "transport_missing", adapter: options.adapter, sourceId: options.sourceId };
  }
  const generated = await findGeneratedTrail(options);
  if (generated.status !== "found") {
    return { status: generated.status, adapter: options.adapter, sourceId: options.sourceId };
  }
  const raw = await readFile(generated.path, "utf8");
  const redacted = await redactTrailJsonl(raw, options.redaction);
  const shared = await options.transport.share({
    adapter: options.adapter,
    sourceId: options.sourceId,
    contentHash: generated.contentHash,
    filename: `${generated.contentHash}.trail.jsonl`,
    jsonl: redacted.jsonl,
    redactionSummary: redacted.summary,
  });
  await markGistShared(options.catalogDb, {
    agent_name: options.adapter,
    source_id: options.sourceId,
    gist_id: shared.gistId,
  });
  const result: ShareSessionResult = {
    status: "shared",
    adapter: options.adapter,
    sourceId: options.sourceId,
    contentHash: generated.contentHash,
    gistId: shared.gistId,
    redactionSummary: redacted.summary,
  };
  if (shared.url !== undefined) result.url = shared.url;
  return result;
}
