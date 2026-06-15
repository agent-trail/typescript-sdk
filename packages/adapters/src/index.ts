/**
 * Concrete Agent Trail source adapters for supported coding agents.
 *
 * @packageDocumentation
 */
import type { Entry, Header, TrailEnvelope } from "@agent-trail/types";

/** One parsed trail session inside a trail file. */
export type TrailSessionGroup = { header: Header; entries: Entry[] };

/** Parsed trail output from an adapter, including optional multi-session envelope. */
export type TrailFile = { envelope?: TrailEnvelope | undefined; groups: TrailSessionGroup[] };

/** Discovered source session reference. */
export type SessionRef = {
  /** Adapter-specific session id. */
  id: string;
  /** Adapter name that discovered this session. */
  adapter: string;
  /** Source locator for parsing, usually a filesystem path. */
  path?: string | undefined;
  /** Working directory associated with the source session. */
  cwd?: string | undefined;
  /** Source modified timestamp as an ISO string when available. */
  modifiedAt?: string | undefined;
  /**
   * Provenance of `id`. `"header"` means the adapter read the canonical id out
   * of the session header. `"filename-fallback"` means the header was
   * unreadable and the id was reconstructed from the filename — downstream
   * consumers should treat the session as suspect (truncated / corrupted).
   * Optional; adapters that can't distinguish leave it unset.
   */
  headerStatus?: "header" | "filename-fallback" | undefined;
};

/** Command needed to resume a source session in its native agent. */
export type ResumeCommand = {
  /** Human-readable command label. */
  label: string;
  /** Executable and arguments. */
  argv: string[];
  /** Working directory for the command. */
  cwd?: string | undefined;
  /** Extra environment variables for the command. */
  env?: Record<string, string> | undefined;
};

/** Result of asking an adapter for a native resume command. */
export type ResumeSessionResult =
  | { supported: true; command: ResumeCommand }
  | { supported: false; reason: string };

/** Filters for adapter session discovery. */
export type DetectOptions = {
  /** Working directory to match. */
  cwd?: string | undefined;
  /** Lower bound for source modified timestamps. */
  since?: string | undefined;
  /** Search all known working-directory buckets for adapters that support it. */
  allCwds?: boolean | undefined;
};

/** Adapter source storage health snapshot. */
export type AdapterSourceHealth = {
  /** Adapter name. */
  adapter: string;
  /** Source root path or virtual locator when known. */
  path: string | null;
  /** Whether the source storage is present. */
  present: boolean;
  /** Whether the source storage can be read. */
  readable: boolean;
  /** Number of discoverable sessions. */
  sessionCount: number;
  /** Newest detected upstream source version. */
  sourceVersion: string | null;
  /** Non-fatal source health warnings. */
  warnings: string[];
};

/** Common interface implemented by every concrete source adapter. */
export interface TrailAdapter {
  /** Stable adapter name. */
  readonly name: string;
  /** Discover source sessions for this adapter. */
  detectSessions(opts?: DetectOptions): Promise<SessionRef[]>;
  /** Parse one discovered source session into trail records. */
  parseSession(ref: SessionRef): Promise<TrailFile>;
  /** Build a native command that resumes the source session. */
  resumeSession?(ref: SessionRef): Promise<ResumeSessionResult>;
  /** Return whether the current environment has readable source storage. */
  isAvailable(): Promise<boolean>;
  /** Return the newest known source format version. */
  sourceVersion(): Promise<string | null>;
  /** Return detailed source storage health. */
  sourceHealth(): Promise<AdapterSourceHealth>;
}

export type { ClaudeCodeAdapterOptions } from "./claude-code/index.js";
export { createClaudeCodeAdapter } from "./claude-code/index.js";
export type { CodexAdapterOptions } from "./codex/index.js";
export { createCodexAdapter } from "./codex/index.js";
export type { OpenCodeAdapterOptions } from "./opencode/index.js";
export { createOpenCodeAdapter } from "./opencode/index.js";
export type { PiAdapterOptions } from "./pi/index.js";
export { createPiAdapter } from "./pi/index.js";
export type { DefaultTrailAdaptersOptions } from "./shared/registry.js";
export { createDefaultTrailAdapters } from "./shared/registry.js";
