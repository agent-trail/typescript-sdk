import pkg from "../../package.json" with { type: "json" };
import type { DetectOptions, SessionRef, TrailAdapter, TrailFile } from "../index.js";
import { resumeCommand } from "../resume.js";
import { parseCodexTrailFile } from "./assembly.js";
import { detectCodexSessions, dirExists, newestCodexSourceVersion } from "./discovery.js";
import { inspectSourceHealth } from "./health.js";
import { codexSessionsDir } from "./paths.js";

const PRODUCER = `@agent-trail/adapters-codex/${pkg.version}`;

export type CodexAdapterOptions = {
  env?: NodeJS.ProcessEnv;
};

export function createCodexAdapter(options: CodexAdapterOptions = {}): TrailAdapter {
  const env = options.env ?? process.env;
  return {
    name: "codex",

    detectSessions(opts?: DetectOptions): Promise<SessionRef[]> {
      return detectCodexSessions(opts, env);
    },

    async parseSession(ref: SessionRef): Promise<TrailFile> {
      if (ref.path === undefined) {
        throw new Error("Codex adapter requires SessionRef.path");
      }
      return parseCodexTrailFile(ref.path, PRODUCER, { env });
    },

    async resumeSession(ref: SessionRef) {
      return resumeCommand(ref, `Resume Codex session ${ref.id}`, ["codex", "resume", ref.id]);
    },

    async isAvailable(): Promise<boolean> {
      const dir = codexSessionsDir(env);
      if (dir === undefined) return false;
      return dirExists(dir);
    },

    sourceVersion(): Promise<string | null> {
      return newestCodexSourceVersion(env);
    },

    sourceHealth: () => inspectSourceHealth(env),
  };
}
