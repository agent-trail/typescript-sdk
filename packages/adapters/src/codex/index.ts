import pkg from "../../package.json" with { type: "json" };
import type { DetectOptions, SessionRef, TrailAdapter, TrailFile } from "../index.js";
import { resumeCommand } from "../shared/resume.js";
import { parseCodexTrailFile } from "./assembly.js";
import { detectCodexSessions, dirExists, newestCodexSourceVersion } from "./discovery.js";
import { inspectSourceHealth } from "./health.js";
import { codexSessionsDir } from "./paths.js";

const PRODUCER = `@agent-trail/adapters-codex/${pkg.version}`;

/** Options for the Codex adapter factory. */
export type CodexAdapterOptions = {
  /** Environment overrides used for discovery and parsing. */
  env?: NodeJS.ProcessEnv;
  /** Override for the Codex config root. */
  codexHome?: string;
  /** Override for the Codex sessions root. */
  sessionsDir?: string;
  /** Override for the Codex session index JSONL path. */
  sessionIndexPath?: string;
};

/** Create a Codex adapter instance. */
export function createCodexAdapter(options: CodexAdapterOptions = {}): TrailAdapter {
  const env = options.env ?? process.env;
  const pathOptions = { ...options, env };
  return {
    name: "codex",

    detectSessions(opts?: DetectOptions): Promise<SessionRef[]> {
      return detectCodexSessions(opts, pathOptions);
    },

    async parseSession(ref: SessionRef): Promise<TrailFile> {
      if (ref.path === undefined) {
        throw new Error("Codex adapter requires SessionRef.path");
      }
      return parseCodexTrailFile(ref.path, PRODUCER, pathOptions);
    },

    async resumeSession(ref: SessionRef) {
      return resumeCommand(ref, `Resume Codex session ${ref.id}`, ["codex", "resume", ref.id]);
    },

    async isAvailable(): Promise<boolean> {
      const dir = codexSessionsDir(pathOptions);
      if (dir === undefined) return false;
      return dirExists(dir);
    },

    sourceVersion(): Promise<string | null> {
      return newestCodexSourceVersion(pathOptions);
    },

    sourceHealth: () => inspectSourceHealth(pathOptions),
  };
}
