import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

export type PackageJson = {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  workspaces?: string[] | { packages?: string[] };
  types?: string;
  exports?: unknown;
};

export function readPackageJson(filePath: string): PackageJson {
  return JSON.parse(readFileSync(filePath, "utf8")) as PackageJson;
}

export function workspacePackageDirs(root: string): string[] {
  const rootDir = realpathSync(root);
  return workspacePatterns(rootDir).flatMap((pattern) => expandWorkspacePattern(rootDir, pattern));
}

export function isInsidePath(parentPath: string, childPath: string): boolean {
  const relativePath = path.relative(parentPath, childPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function workspacePatterns(root: string): string[] {
  const packageJsonPath = path.join(root, "package.json");
  if (!isRegularFile(packageJsonPath)) return [];

  const packageJson = readPackageJson(packageJsonPath);
  return Array.isArray(packageJson.workspaces)
    ? packageJson.workspaces
    : (packageJson.workspaces?.packages ?? []);
}

function expandWorkspacePattern(root: string, pattern: string): string[] {
  if (!pattern.endsWith("/*")) {
    const workspaceDir = resolveWorkspacePath(root, pattern);
    if (!isDirectory(workspaceDir)) return [];
    return hasPackageJson(workspaceDir) ? [workspaceDir] : [];
  }

  const parentDir = resolveWorkspacePath(root, pattern.slice(0, -2));
  if (!isDirectory(parentDir)) return [];

  return readdirSync(parentDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(parentDir, entry.name))
    .filter(hasPackageJson);
}

function resolveWorkspacePath(root: string, patternPath: string): string {
  if (path.isAbsolute(patternPath)) {
    throw new Error(`workspace pattern must be relative: ${patternPath}`);
  }

  const resolvedPath = path.resolve(root, patternPath);
  if (!isInsidePath(root, resolvedPath)) {
    throw new Error(`workspace pattern escapes root: ${patternPath}`);
  }

  return resolvedPath;
}

function hasPackageJson(dir: string): boolean {
  return isRegularFile(path.join(dir, "package.json"));
}

function isDirectory(filePath: string): boolean {
  return existsSync(filePath) && lstatSync(filePath).isDirectory();
}

function isRegularFile(filePath: string): boolean {
  return existsSync(filePath) && lstatSync(filePath).isFile();
}
