import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, resolve as resolvePath } from "node:path";
import { gunzipSync } from "node:zlib";
import { type CatalogDb, initializeCatalog, upsertTrailObject } from "@agent-trail/catalog";
import { type ParsedTrail, serializeTrailJsonl, type TrailDiagnostic } from "@agent-trail/core";
import {
  type FinalizedObjectIndexRow,
  writerStrictObjectIndexPolicy,
} from "./object-index-policy.js";
import { objectPath as computeObjectPath, resolveStoreRoot } from "./paths.js";
import { catalogMetadataForObjectRow, sessionGroupForObjectRow } from "./trail-metadata.js";

/**
 * Result status for registering a trail file into the local store.
 *
 * @public
 */
export type RegisterStatus = "finalized" | "already_present" | "skipped_pending" | "invalid";

/**
 * Result of validating and registering one trail file.
 *
 * @public
 */
export type RegisterResult = {
  status: RegisterStatus;
  contentHash: string | null;
  objectPath: string | null;
  diagnostics: TrailDiagnostic[];
};

/**
 * Options for registering a trail file into the local store.
 *
 * @public
 */
export type RegisterOptions = {
  storeRoot?: string;
  /**
   * SQLite catalog driver. When provided, successful registrations upsert
   * trail object metadata into the catalog. Omit it to write object bytes only.
   */
  catalogDb?: CatalogDb;
  /**
   * Provenance recorded in the catalog `source_path` field. Default is the
   * absolute path of `filePath`. Callers that hand `registerTrail` a
   * transient artifact (e.g. a downloaded payload staged in a tmp dir
   * that will be deleted) should pass `null` so the catalog does not
   * point at a guaranteed-stale path.
   */
  sourcePath?: string | null;
};

/**
 * Validate, canonicalize, and write finalized trail object bytes.
 *
 * @public
 */
export async function registerTrail(
  filePath: string,
  opts: RegisterOptions = {},
): Promise<RegisterResult> {
  const storeRoot = resolveStoreRoot(opts.storeRoot);

  const rawResult = await readTrailFileText(filePath);
  if ("diagnostics" in rawResult) {
    return {
      status: "invalid",
      contentHash: null,
      objectPath: null,
      diagnostics: rawResult.diagnostics,
    };
  }
  const raw = rawResult.text;
  const eligible = await writerStrictObjectIndexPolicy(raw);
  if (eligible.status === "invalid") {
    return {
      status: "invalid",
      contentHash: null,
      objectPath: null,
      diagnostics: eligible.diagnostics,
    };
  }

  const { trail, policy: indexPolicy } = eligible;
  if (indexPolicy.rows.length === 0) {
    return {
      status: "skipped_pending",
      contentHash: null,
      objectPath: null,
      diagnostics: [],
    };
  }

  // Multi-session files (spec §9.6) write one full-file object keyed by the
  // envelope hash when present, plus one sliced session object per finalized
  // session hash. Each object path therefore contains bytes for the hash in
  // its filename; unrelated sibling sessions cannot overwrite a stable
  // session-hash object.
  const canonical = serializeTrailJsonl(trail);
  const sourcePath = opts.sourcePath === undefined ? resolvePath(filePath) : opts.sourcePath;
  const registeredAt = new Date().toISOString();
  if (opts.catalogDb !== undefined) {
    await initializeCatalog(opts.catalogDb);
  }

  // The "primary" content hash returned in RegisterResult is the file-level
  // identity. Envelope hash when present (spec §7.4 file-level hash); else
  // the first finalized session hash as the surrogate file identity (spec
  // §8.5 envelope-absent default). `finalize-redacted.ts` makes the same
  // choice so register + share/transport agree on identity.
  if (indexPolicy.primaryHash === undefined) {
    return {
      status: "skipped_pending",
      contentHash: null,
      objectPath: null,
      diagnostics: [],
    };
  }
  const primaryTarget = computeObjectPath(storeRoot, indexPolicy.primaryHash);
  let status: RegisterStatus = "already_present";

  // Per-session object rows for every finalized group. Pending groups are
  // skipped silently; a subsequent register call on the (now-finalized) file
  // picks them up.
  for (const row of indexPolicy.rows) {
    const target = computeObjectPath(storeRoot, row.contentHash);
    const bytes = objectBytesForRow(trail, row, canonical);
    await mkdir(dirname(target), { recursive: true });
    const existing = await readFileIfExists(target);
    if (existing !== bytes) {
      await atomicWriteFile(target, bytes);
      status = "finalized";
    }
    if (opts.catalogDb !== undefined) {
      await upsertTrailObject(opts.catalogDb, {
        content_hash: row.contentHash,
        kind: row.kind,
        object_path: target,
        source_path: sourcePath,
        session_uid: row.session_uid,
        registered_at: registeredAt,
        ...catalogMetadataForObjectRow(trail, row),
      });
    }
  }

  return {
    status,
    contentHash: indexPolicy.primaryHash,
    objectPath: primaryTarget,
    diagnostics: [],
  };
}

function objectBytesForRow(
  trail: ParsedTrail,
  row: FinalizedObjectIndexRow,
  canonical: string,
): string {
  if (row.kind === "trail") return canonical;
  const group = sessionGroupForObjectRow(trail, row);
  if (group === undefined) {
    throw new Error(`Cannot locate finalized session for content hash ${row.contentHash}`);
  }
  return serializeTrailJsonl({
    groups: [group],
    records: [group.header, ...group.events],
  });
}

async function readTrailFileText(
  filePath: string,
): Promise<{ text: string } | { diagnostics: TrailDiagnostic[] }> {
  if (!isGzippedTrailPath(filePath)) {
    return { text: await readFile(filePath, "utf8") };
  }

  try {
    const fileInfo = await stat(filePath);
    assertGzippedTrailCompressedSize(filePath, fileInfo.size);
    return { text: decodeGzippedTrailBytes(await readFile(filePath), filePath) };
  } catch (error) {
    if (error instanceof TrailFileDecodeError) {
      return {
        diagnostics: [
          {
            line: 0,
            path: "",
            severity: "error",
            code: "gzip_decode_failed",
            message: error.message,
          },
        ],
      };
    }
    throw error;
  }
}

const GZIPPED_TRAIL_EXTENSION = ".trail.jsonl.gz";
const GZIPPED_TRAIL_MAX_COMPRESSED_BYTES = 1_500_000;
const GZIPPED_TRAIL_MAX_DECOMPRESSED_BYTES = 8_000_000;

class TrailFileDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TrailFileDecodeError";
  }
}

function isGzippedTrailPath(path: string): boolean {
  return path.toLowerCase().endsWith(GZIPPED_TRAIL_EXTENSION);
}

function assertGzippedTrailCompressedSize(path: string, byteLength: number): void {
  if (byteLength <= GZIPPED_TRAIL_MAX_COMPRESSED_BYTES) return;
  throw new TrailFileDecodeError(
    `failed to decode gzip trail ${path}: compressed payload exceeds ${GZIPPED_TRAIL_MAX_COMPRESSED_BYTES} bytes`,
  );
}

function decodeGzippedTrailBytes(bytes: Uint8Array, path: string): string {
  try {
    const buffer = gunzipSync(bytes, {
      maxOutputLength: GZIPPED_TRAIL_MAX_DECOMPRESSED_BYTES,
    });
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch (error) {
    if (error instanceof TrailFileDecodeError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ERR_BUFFER_TOO_LARGE") {
      throw new TrailFileDecodeError(
        `failed to decode gzip trail ${path}: decompressed payload exceeds ${GZIPPED_TRAIL_MAX_DECOMPRESSED_BYTES} bytes`,
      );
    }
    if (error instanceof TypeError) {
      throw new TrailFileDecodeError(`failed to decode gzip trail ${path}: invalid UTF-8`);
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new TrailFileDecodeError(`failed to decode gzip trail ${path}: ${detail}`);
  }
}

async function readFileIfExists(path: string): Promise<string | null> {
  try {
    const info = await lstat(path);
    if (!info.isFile()) return null;
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function atomicWriteFile(target: string, contents: string): Promise<void> {
  // Per-write unique suffix so two concurrent calls writing the same target
  // (e.g. duplicate same-hash registers racing in the same store) do not
  // collide on a single shared `.tmp` path. `rename` is atomic on POSIX, so
  // whichever rename wins lands a complete file; the other becomes a no-op
  // overwrite of identical bytes.
  const tmp = `${target}.${randomUUID()}.tmp`;
  await writeFile(tmp, contents, "utf8");
  await rename(tmp, target);
}
