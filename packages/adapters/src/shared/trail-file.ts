import { type Diagnostic, type ValidationProfile, validateTrailJsonl } from "@agent-trail/core";
import type { TrailFile } from "../index.js";

export type ValidateAdapterTrailOptions = { profile?: ValidationProfile | undefined };

export function trailRecords(trail: TrailFile): object[] {
  const records: object[] = [];
  if (trail.envelope !== undefined) records.push(trail.envelope);
  for (const group of trail.groups) {
    records.push(group.header, ...group.entries);
  }
  return records;
}

export async function validateAdapterTrail(
  trail: TrailFile,
  options: ValidateAdapterTrailOptions = {},
): Promise<Diagnostic[]> {
  const lines = trailRecords(trail).map((record) => JSON.stringify(record));
  const result = await validateTrailJsonl(`${lines.join("\n")}\n`, {
    mode: options.profile === "reader-tolerant" ? "tolerant" : "strict",
  });
  return result.diagnostics;
}
