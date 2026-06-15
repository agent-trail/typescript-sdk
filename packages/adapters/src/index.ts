import type { Entry, Header, TrailEnvelope } from "@agent-trail/types";

export type TrailSessionGroup = { header: Header; entries: Entry[] };

export type TrailFile = { envelope?: TrailEnvelope | undefined; groups: TrailSessionGroup[] };

export type SessionRef = {
  id: string;
  adapter: string;
  path?: string | undefined;
  cwd?: string | undefined;
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

export type ResumeCommand = {
  label: string;
  argv: string[];
  cwd?: string | undefined;
  env?: Record<string, string> | undefined;
};

export type ResumeSessionResult =
  | { supported: true; command: ResumeCommand }
  | { supported: false; reason: string };

export type DetectOptions = {
  cwd?: string | undefined;
  since?: string | undefined;
  allCwds?: boolean | undefined;
};

export type AdapterSourceHealth = {
  adapter: string;
  path: string | null;
  present: boolean;
  readable: boolean;
  sessionCount: number;
  sourceVersion: string | null;
  warnings: string[];
};

export interface TrailAdapter {
  readonly name: string;
  detectSessions(opts?: DetectOptions): Promise<SessionRef[]>;
  parseSession(ref: SessionRef): Promise<TrailFile>;
  resumeSession?(ref: SessionRef): Promise<ResumeSessionResult>;
  isAvailable(): Promise<boolean>;
  sourceVersion(): Promise<string | null>;
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
