import type { SqliteDriver } from "@agent-trail/adapter-kit";
import { parseTrailJsonl, stampContentHashes } from "@agent-trail/core";
import type { Entry, Header } from "@agent-trail/types";
import pkg from "../../package.json" with { type: "json" };
import { buildTrailEnvelope } from "../envelope.js";
import { applyHeaderMetadataUpdates } from "../header-metadata.js";
import type {
  AdapterSourceHealth,
  DetectOptions,
  SessionRef,
  TrailAdapter,
  TrailFile,
} from "../index.js";
import { applyParseFidelity } from "../parse-fidelity.js";
import { resumeCommand } from "../resume.js";
import { OPENCODE_ENTRY_ID_NAMESPACE } from "../session-uid.js";
import { sanitizeTrailFile } from "../trail-sanitizer.js";
import { readGitVcs } from "../vcs.js";
import { synthesizeVcsCommitEvents } from "../vcs-commit.js";
import { headerFromLoaded } from "./header.js";
import { inspectSourceHealth } from "./health.js";
import { entriesFromLoaded } from "./mappings.js";
import { worktreeFromProject } from "./metadata.js";
import { stringValue } from "./source.js";
import {
  discoveredSummaries,
  loadDbSessionWithOptions,
  loadFileSessionWithOptions,
} from "./storage/index.js";

const PRODUCER = `@agent-trail/adapters-opencode/${pkg.version}`;

async function stampTrailFile(trail: TrailFile): Promise<TrailFile> {
  const sanitizedTrail = sanitizeTrailFile(trail);
  const records = [
    ...(sanitizedTrail.envelope !== undefined ? [sanitizedTrail.envelope] : []),
    ...sanitizedTrail.groups.flatMap((group) => [group.header, ...group.entries]),
  ];
  const jsonl = `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
  const stamped = stampContentHashes(await parseTrailJsonl(jsonl));
  const values = stamped.trail.records.map((record) => record.record);
  const envelope = values[0] as TrailFile["envelope"];
  const header = values[1] as Header;
  const entries = values.slice(2) as Entry[];
  return sanitizeTrailFile({ envelope, groups: [{ header, entries }] });
}

export type OpenCodeAdapterOptions = {
  env?: NodeJS.ProcessEnv;
  storageDir?: string;
  dbPath?: string;
  sqliteDriver?: SqliteDriver;
};

export function createOpenCodeAdapter(options: OpenCodeAdapterOptions = {}): TrailAdapter {
  const storageOptions = {
    env: options.env,
    storageDir: options.storageDir,
    dbPath: options.dbPath,
    sqliteDriver: options.sqliteDriver,
  };
  return {
    name: "opencode",

    async detectSessions(_opts?: DetectOptions): Promise<SessionRef[]> {
      return (await discoveredSummaries(_opts, storageOptions)).map((session) => ({
        id: session.id,
        adapter: "opencode",
        cwd: session.cwd,
        modifiedAt: session.modifiedAt,
        path: session.path,
      }));
    },

    async parseSession(ref: SessionRef): Promise<TrailFile> {
      if (ref.path === undefined) throw new Error("OpenCode parseSession requires ref.path");
      const loaded = ref.path.includes("#")
        ? loadDbSessionWithOptions(ref.path, storageOptions)
        : await loadFileSessionWithOptions(ref.path, storageOptions);
      const header = headerFromLoaded(loaded, ref);
      const vcs = header.cwd === undefined ? undefined : await readGitVcs(header.cwd);
      if (vcs !== undefined) {
        const projectWorktree = worktreeFromProject(loaded.project);
        header.vcs = {
          ...vcs,
          ...(vcs.worktree === undefined && projectWorktree !== undefined
            ? { worktree: projectWorktree }
            : {}),
        };
      }
      const entries = synthesizeVcsCommitEvents(entriesFromLoaded(loaded, header), {
        idNamespace: OPENCODE_ENTRY_ID_NAMESPACE,
        repo: header.vcs?.remote_url,
      });
      applyHeaderMetadataUpdates(header, entries);
      applyParseFidelity(header, entries);
      const group = { header, entries };
      return stampTrailFile({
        envelope: buildTrailEnvelope({
          producer: PRODUCER,
          groups: [group],
          name: stringValue(loaded.session.title) ?? stringValue(loaded.session.slug),
        }),
        groups: [group],
      });
    },

    async resumeSession(ref: SessionRef) {
      return resumeCommand(ref, `Resume OpenCode session ${ref.id}`, [
        "opencode",
        "--session",
        ref.id,
      ]);
    },

    async isAvailable(): Promise<boolean> {
      const health = await inspectSourceHealth(options.env);
      return health.present && health.readable;
    },

    async sourceVersion(): Promise<string | null> {
      return (await inspectSourceHealth(options.env)).sourceVersion;
    },

    async sourceHealth(): Promise<AdapterSourceHealth> {
      const health = await inspectSourceHealth(options.env);
      if (options.sqliteDriver === undefined && options.dbPath !== undefined) {
        return {
          ...health,
          warnings: [...health.warnings, "OpenCode SQLite discovery skipped: sqliteDriver missing"],
        };
      }
      return health;
    },
  };
}
