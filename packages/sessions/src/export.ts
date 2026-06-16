import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { findGeneratedTrail } from "./shared.js";
import type { ExportSessionOptions, ExportSessionResult } from "./types.js";

/**
 * Export raw finalized stored trail bytes.
 *
 * @public
 */
export async function exportSession(options: ExportSessionOptions): Promise<ExportSessionResult> {
  const generated = await findGeneratedTrail(options);
  if (generated.status !== "found") {
    return { status: generated.status, adapter: options.adapter, sourceId: options.sourceId };
  }
  const jsonl = await readFile(generated.path, "utf8");
  if (options.toPath !== undefined) {
    await mkdir(dirname(options.toPath), { recursive: true });
    await writeFile(options.toPath, jsonl, "utf8");
    return {
      status: "exported",
      adapter: options.adapter,
      sourceId: options.sourceId,
      contentHash: generated.contentHash,
      path: options.toPath,
    };
  }
  return {
    status: "exported",
    adapter: options.adapter,
    sourceId: options.sourceId,
    contentHash: generated.contentHash,
    jsonl,
  };
}
