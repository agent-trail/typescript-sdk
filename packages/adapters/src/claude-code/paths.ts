import { join } from "node:path";
import { envValue, homeDir, joinPlatform, type PathPlatform } from "../shared/platform-paths.js";

export function claudeCodeConfigDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: PathPlatform = process.platform,
): string | undefined {
  const override = envValue(env, "CLAUDE_CONFIG_DIR");
  if (override !== undefined) {
    return override;
  }
  const home = homeDir(env, platform);
  return home === undefined ? undefined : joinPlatform(platform, home, ".claude");
}

export function mangleCwd(cwd: string): string {
  return cwd.replace(/\\/g, "/").replace(/[/:]/g, "-");
}

export function claudeCodeProjectDir({
  configDir,
  projectsRoot,
  cwd,
}: {
  configDir?: string;
  projectsRoot?: string;
  cwd: string;
}): string {
  const root =
    projectsRoot ?? (configDir === undefined ? undefined : claudeCodeProjectsRoot(configDir));
  if (root === undefined)
    throw new Error("Claude Code project dir requires configDir or projectsRoot");
  return join(root, mangleCwd(cwd));
}

export function claudeCodeProjectsRoot(configDir: string): string {
  return join(configDir, "projects");
}
