import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export type PackageJson = {
  name?: string;
  workspaces?: string[] | { packages?: string[] };
  types?: string;
  exports?: unknown;
};

export function readPackageJson(filePath: string): PackageJson {
  return JSON.parse(readFileSync(filePath, "utf8")) as PackageJson;
}

export function workspacePackageDirs(root: string): string[] {
  return workspacePatterns(root).flatMap((pattern) => expandWorkspacePattern(root, pattern));
}

function workspacePatterns(root: string): string[] {
  const packageJsonPath = path.join(root, "package.json");
  if (!existsSync(packageJsonPath)) return [];

  const packageJson = readPackageJson(packageJsonPath);
  return Array.isArray(packageJson.workspaces)
    ? packageJson.workspaces
    : (packageJson.workspaces?.packages ?? []);
}

function expandWorkspacePattern(root: string, pattern: string): string[] {
  if (!pattern.endsWith("/*")) return [];

  const parentDir = path.join(root, pattern.slice(0, -2));
  if (!existsSync(parentDir)) return [];

  return readdirSync(parentDir)
    .map((entry) => path.join(parentDir, entry))
    .filter((entryPath) => statSync(entryPath).isDirectory())
    .filter((entryPath) => existsSync(path.join(entryPath, "package.json")));
}
