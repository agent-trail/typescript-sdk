import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import * as ts from "typescript";
import { isInsidePath, readPackageJson, workspacePackageDirs } from "./workspaces.ts";

export type WorkspacePackage = {
  name: string;
  dir: string;
  exportRules: ExportRule[];
};

export type ExportViolation = {
  filePath: string;
  specifier: string;
  message: string;
};

type ImportSite = {
  filePath: string;
  specifier: string;
};

type ExportRule = {
  subpath: string;
  target: unknown;
  order: number;
};

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);
const IGNORED_DIRS = new Set([".git", ".fallow", "coverage", "dist", "node_modules"]);

function collectExportRules(exportsField: unknown): ExportRule[] {
  if (exportsField === undefined) return [];
  if (typeof exportsField === "string") return [{ subpath: ".", target: exportsField, order: 0 }];
  if (exportsField === null || typeof exportsField !== "object") return [];

  const entries = Object.entries(exportsField);
  const explicitSubpaths = entries.filter(([key]) => key.startsWith("."));
  if (explicitSubpaths.length > 0) {
    return explicitSubpaths.map(([subpath, target], order) => ({ subpath, target, order }));
  }

  return [{ subpath: ".", target: exportsField, order: 0 }];
}

export function discoverWorkspacePackages(root: string): WorkspacePackage[] {
  return workspacePackageDirs(root).flatMap((dir) => {
    const packageJson = readPackageJson(path.join(dir, "package.json"));
    if (packageJson.name === undefined) return [];

    return [
      {
        name: packageJson.name,
        dir,
        exportRules: collectExportRules(packageJson.exports),
      },
    ];
  });
}

function findSourceFiles(dir: string, root = realpathSync(dir), files: string[] = []): string[] {
  if (!existsSync(dir)) return files;
  if (!isInsidePath(root, realpathSync(dir))) return files;

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;

    if (isSearchableDirectory(entry.name, entry.isDirectory())) {
      if (!IGNORED_DIRS.has(entry.name)) findSourceFiles(entryPath, root, files);
      continue;
    }

    if (isSourceFile(entryPath, entry.isFile())) files.push(entryPath);
  }

  return files;
}

function isSearchableDirectory(name: string, isDirectory: boolean): boolean {
  return isDirectory && !IGNORED_DIRS.has(name);
}

function isSourceFile(filePath: string, isFile: boolean): boolean {
  return isFile && SOURCE_EXTENSIONS.has(path.extname(filePath)) && !filePath.endsWith(".d.ts");
}

function collectImportSites(filePath: string): ImportSite[] {
  const sourceText = readFileSync(filePath, "utf8");
  const importedFiles = ts.preProcessFile(sourceText, true, true).importedFiles;
  return importedFiles.map((importedFile) => ({ filePath, specifier: importedFile.fileName }));
}

function subpathMatches(exportedSubpath: string, requestedSubpath: string): boolean {
  if (exportedSubpath === requestedSubpath) return true;

  const wildcardIndex = exportedSubpath.indexOf("*");
  if (wildcardIndex === -1) return false;

  const prefix = exportedSubpath.slice(0, wildcardIndex);
  const suffix = exportedSubpath.slice(wildcardIndex + 1);
  return requestedSubpath.startsWith(prefix) && requestedSubpath.endsWith(suffix);
}

function exportRulePrecedence(rule: ExportRule): { prefixLength: number; subpathLength: number } {
  const wildcardIndex = rule.subpath.indexOf("*");
  if (wildcardIndex === -1) {
    return {
      prefixLength: Number.MAX_SAFE_INTEGER,
      subpathLength: Number.MAX_SAFE_INTEGER,
    };
  }

  return {
    prefixLength: rule.subpath.slice(0, wildcardIndex).length,
    subpathLength: rule.subpath.length,
  };
}

function isAllowedByExports(exportRules: ExportRule[], subpath: string): boolean {
  const matchingRules = exportRules
    .filter((rule) => subpathMatches(rule.subpath, subpath))
    .sort((a, b) => {
      const aPrecedence = exportRulePrecedence(a);
      const bPrecedence = exportRulePrecedence(b);
      const prefixPrecedence = bPrecedence.prefixLength - aPrecedence.prefixLength;
      if (prefixPrecedence !== 0) return prefixPrecedence;

      const subpathPrecedence = bPrecedence.subpathLength - aPrecedence.subpathLength;
      return subpathPrecedence === 0 ? a.order - b.order : subpathPrecedence;
    });

  const selectedRule = matchingRules[0];
  return selectedRule !== undefined && selectedRule.target !== null;
}

function requestedSubpath(packageName: string, specifier: string): string | undefined {
  if (specifier === packageName) return ".";
  if (!specifier.startsWith(`${packageName}/`)) return undefined;
  return `./${specifier.slice(packageName.length + 1)}`;
}

export function checkWorkspacePackageImports(root: string, files?: string[]): ExportViolation[] {
  const rootDir = realpathSync(root);
  const sourceFiles = files ?? findSourceFiles(rootDir);
  const workspacePackages = discoverWorkspacePackages(rootDir);

  return [
    ...missingExportsViolations(workspacePackages),
    ...importViolations(rootDir, sourceFiles, workspacePackages),
  ].sort((a, b) => `${a.filePath}:${a.specifier}`.localeCompare(`${b.filePath}:${b.specifier}`));
}

function missingExportsViolations(workspacePackages: WorkspacePackage[]): ExportViolation[] {
  return workspacePackages
    .filter((packageInfo) => packageInfo.exportRules.length === 0)
    .map((packageInfo) => ({
      filePath: path.join(packageInfo.dir, "package.json"),
      specifier: packageInfo.name,
      message: "workspace package must define an explicit package.json exports map",
    }));
}

function importViolations(
  rootDir: string,
  sourceFiles: string[],
  workspacePackages: WorkspacePackage[],
): ExportViolation[] {
  return sourceFiles
    .filter((filePath) => isSafeSourceFile(rootDir, filePath))
    .flatMap((filePath) => collectImportSites(filePath))
    .flatMap((importSite) => importViolation(importSite, workspacePackages) ?? []);
}

function isSafeSourceFile(rootDir: string, filePath: string): boolean {
  if (!existsSync(filePath) || lstatSync(filePath).isSymbolicLink()) return false;
  return isInsidePath(rootDir, realpathSync(filePath));
}

function importViolation(
  importSite: ImportSite,
  workspacePackages: WorkspacePackage[],
): ExportViolation | undefined {
  const matchingPackage = workspacePackages.find(
    (packageInfo) => requestedSubpath(packageInfo.name, importSite.specifier) !== undefined,
  );
  if (matchingPackage === undefined) return undefined;

  const subpath = requestedSubpath(matchingPackage.name, importSite.specifier);
  if (subpath === undefined || isAllowedByExports(matchingPackage.exportRules, subpath)) {
    return undefined;
  }

  return {
    filePath: importSite.filePath,
    specifier: importSite.specifier,
    message: `workspace import must match ${matchingPackage.name} exports map`,
  };
}

export function formatExportViolation(root: string, violation: ExportViolation): string {
  const filePath = path.relative(root, violation.filePath);
  return `${filePath}: ${violation.specifier} - ${violation.message}`;
}

export function main(root = process.cwd()): number {
  const violations = checkWorkspacePackageImports(root);
  if (violations.length === 0) {
    console.log("check-exports: ok");
    return 0;
  }

  console.error("check-exports: failed");
  for (const violation of violations) {
    console.error(formatExportViolation(root, violation));
  }

  return 1;
}

if (import.meta.main) {
  process.exitCode = main();
}
