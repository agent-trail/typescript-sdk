import {
  computeContentHashes,
  type ParsedTrail,
  type TrailDiagnostic,
  validateTrailJsonl,
} from "@agent-trail/core";
import type { IndexEntryKind } from "./index-file.js";

/**
 * @internal
 */
export type FinalizedObjectIndexRow = {
  contentHash: string;
  kind: IndexEntryKind;
  session_uid: string | null;
};

/**
 * @internal
 */
export type FinalizedObjectIndexPolicy = {
  rows: FinalizedObjectIndexRow[];
  primaryHash: string | undefined;
};

/**
 * @internal
 */
export type WriterStrictObjectIndexPolicy =
  | {
      status: "valid";
      trail: ParsedTrail;
      policy: FinalizedObjectIndexPolicy;
    }
  | {
      status: "invalid";
      diagnostics: TrailDiagnostic[];
    };

/**
 * @internal
 */
export async function writerStrictObjectIndexPolicy(
  raw: string,
): Promise<WriterStrictObjectIndexPolicy> {
  const result = await validateTrailJsonl(raw, { mode: "strict" });
  const diagnostics = result.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  if (diagnostics.length > 0) {
    return { status: "invalid", diagnostics };
  }

  return { status: "valid", trail: result.trail, policy: finalizedObjectIndexPolicy(result.trail) };
}

function finalizedObjectIndexPolicy(trail: ParsedTrail): FinalizedObjectIndexPolicy {
  const hashes = computeContentHashes(trail);
  const rows = finalizedSessionRows(trail, hashes.sessionHashes);
  const trailRow = finalizedTrailRow(trail, hashes.fileHash);
  if (trailRow !== undefined) rows.push(trailRow);

  const primaryHash =
    rows.find((row) => row.kind === "trail")?.contentHash ??
    rows.find((row) => row.kind === "session")?.contentHash;

  return { rows, primaryHash };
}

function finalizedSessionRows(
  trail: ParsedTrail,
  sessionHashes: ReturnType<typeof computeContentHashes>["sessionHashes"],
): FinalizedObjectIndexRow[] {
  const rows: FinalizedObjectIndexRow[] = [];
  for (const [index, group] of trail.groups.entries()) {
    const hash = sessionHashes[index]?.hash;
    if (hash === undefined || group.header.record.content_hash !== hash) continue;
    rows.push({
      contentHash: hash,
      kind: "session",
      session_uid: extractSessionUidFromHeader(group.header),
    });
  }
  return rows;
}

function finalizedTrailRow(
  trail: ParsedTrail,
  fileHash: string | undefined,
): FinalizedObjectIndexRow | undefined {
  if (
    trail.envelope !== undefined &&
    fileHash !== undefined &&
    trail.envelope.record.content_hash === fileHash
  ) {
    return {
      contentHash: fileHash,
      kind: "trail",
      session_uid: null,
    };
  }
  return undefined;
}

function extractSessionUidFromHeader(
  header: ParsedTrail["groups"][number]["header"],
): string | null {
  const uid = header.record.session_uid;
  return typeof uid === "string" ? uid : null;
}
