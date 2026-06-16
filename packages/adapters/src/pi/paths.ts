import { join } from "node:path";
import { envValue, homeDir, joinPlatform, type PathPlatform } from "../shared/platform-paths.js";

export type PiPathOptions = {
  env?: NodeJS.ProcessEnv | undefined;
  agentDir?: string | undefined;
  sessionsDir?: string | undefined;
  platform?: PathPlatform | undefined;
};

type NormalizedPiPathOptions = PiPathOptions & {
  env: NodeJS.ProcessEnv;
  platform: PathPlatform;
};

function isPiPathOptions(input: NodeJS.ProcessEnv | PiPathOptions): input is PiPathOptions {
  return "env" in input || "agentDir" in input || "sessionsDir" in input || "platform" in input;
}

function normalizeOptions(
  input: NodeJS.ProcessEnv | PiPathOptions | undefined,
  platform?: PathPlatform,
): NormalizedPiPathOptions {
  if (input === undefined) return { env: process.env, platform: platform ?? process.platform };
  if (platform !== undefined || !isPiPathOptions(input)) {
    return { env: input as NodeJS.ProcessEnv, platform: platform ?? process.platform };
  }
  return { ...input, env: input.env ?? process.env, platform: input.platform ?? process.platform };
}

// Pi's config root env var (verified against pi-mono `coding-agent/src/config.ts`).
// Pi calls this `ENV_AGENT_DIR` (`<APP_NAME>_CODING_AGENT_DIR`). It points to the
// agent root — the directory that contains `sessions/`. Default: `~/.pi/agent`.
export function piAgentDir(
  input: NodeJS.ProcessEnv | PiPathOptions = process.env,
  platform?: PathPlatform,
): string | undefined {
  const options = normalizeOptions(input, platform);
  if (options.agentDir !== undefined && options.agentDir.length > 0) {
    return options.agentDir;
  }
  const override = envValue(options.env, "PI_CODING_AGENT_DIR");
  if (override !== undefined) {
    return override;
  }
  const home = homeDir(options.env, options.platform);
  return home === undefined ? undefined : joinPlatform(options.platform, home, ".pi", "agent");
}

// Pi also defines `ENV_SESSION_DIR` (`<APP_NAME>_CODING_AGENT_SESSION_DIR`) for
// relocating session storage independently of the agent root. Treat it as a hard
// override when set; otherwise sessions live under `<agentDir>/sessions`.
export function piSessionsDir(
  input: NodeJS.ProcessEnv | PiPathOptions = process.env,
  platform?: PathPlatform,
): string | undefined {
  const options = normalizeOptions(input, platform);
  if (options.sessionsDir !== undefined && options.sessionsDir.length > 0) {
    return options.sessionsDir;
  }
  const override = envValue(options.env, "PI_CODING_AGENT_SESSION_DIR");
  if (override !== undefined) {
    return override;
  }
  const agent = piAgentDir(options);
  return agent === undefined ? undefined : joinPlatform(options.platform, agent, "sessions");
}

// Pi mangling: drop leading `/`, replace path separators with `-`, wrap with
// `--...--`. Empirically verified against `~/.pi/agent/sessions`.
export function mangleCwd(cwd: string): string {
  const normalized = cwd.replace(/\\/g, "/").replace(/^\//, "");
  const inner = normalized.replace(/[/:]/g, "-");
  return `--${inner}--`;
}

export function piProjectDir({ sessionsDir, cwd }: { sessionsDir: string; cwd: string }): string {
  return join(sessionsDir, mangleCwd(cwd));
}

// Pi stores per-cwd dirs directly under `sessionsDir`; no extra subdirectory.
export function piProjectsRoot(sessionsDir: string): string {
  return sessionsDir;
}
