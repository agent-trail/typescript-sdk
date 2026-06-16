import { homeDir, joinPlatform, type PathPlatform } from "../shared/platform-paths.js";

export type CodexPathOptions = {
  env?: NodeJS.ProcessEnv | undefined;
  codexHome?: string | undefined;
  sessionsDir?: string | undefined;
  sessionIndexPath?: string | undefined;
  platform?: PathPlatform | undefined;
};

type NormalizedCodexPathOptions = CodexPathOptions & {
  env: NodeJS.ProcessEnv;
  platform: PathPlatform;
};

function isCodexPathOptions(
  input: NodeJS.ProcessEnv | CodexPathOptions,
): input is CodexPathOptions {
  return "env" in input;
}

function normalizeOptions(
  input: NodeJS.ProcessEnv | CodexPathOptions | undefined,
  platform?: PathPlatform,
): NormalizedCodexPathOptions {
  if (input === undefined) return { env: process.env, platform: platform ?? process.platform };
  if (platform !== undefined || !isCodexPathOptions(input)) {
    return { env: input as NodeJS.ProcessEnv, platform: platform ?? process.platform };
  }
  return { ...input, env: input.env ?? process.env, platform: input.platform ?? process.platform };
}

// Codex CLI honors `CODEX_HOME` as the home directory override (defaults to
// `~/.codex`). Sessions live under `<codexHome>/sessions/YYYY/MM/DD/`. Verified
// against Codex CLI 0.98.0 (originator `codex_sdk_ts`); see
// `docs/parser-source-matrix.md` Codex row for layout notes.
export function codexHomeDir(
  input: NodeJS.ProcessEnv | CodexPathOptions = process.env,
  platform?: PathPlatform,
): string | undefined {
  const options = normalizeOptions(input, platform);
  if (options.codexHome !== undefined && options.codexHome.length > 0) {
    return options.codexHome;
  }
  // Trim before length check so a whitespace-only `CODEX_HOME=" "` (almost
  // always a shell-quoting mistake) falls through to the default instead of
  // silently producing an unreachable `"   /sessions/"` path.
  const override = options.env.CODEX_HOME?.trim();
  if (override !== undefined && override.length > 0) {
    return override;
  }
  const home = homeDir(options.env, options.platform);
  return home === undefined ? undefined : joinPlatform(options.platform, home, ".codex");
}

export function codexSessionsDir(
  input: NodeJS.ProcessEnv | CodexPathOptions = process.env,
  platform?: PathPlatform,
): string | undefined {
  const options = normalizeOptions(input, platform);
  if (options.sessionsDir !== undefined && options.sessionsDir.length > 0) {
    return options.sessionsDir;
  }
  const home = codexHomeDir(options);
  return home === undefined ? undefined : joinPlatform(options.platform, home, "sessions");
}

export function codexSessionIndexPath(
  input: NodeJS.ProcessEnv | CodexPathOptions = process.env,
  platform?: PathPlatform,
): string | undefined {
  const options = normalizeOptions(input, platform);
  if (options.sessionIndexPath !== undefined && options.sessionIndexPath.length > 0) {
    return options.sessionIndexPath;
  }
  const home = codexHomeDir(options);
  return home === undefined
    ? undefined
    : joinPlatform(options.platform, home, "session_index.jsonl");
}
