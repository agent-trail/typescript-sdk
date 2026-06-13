import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import * as ts from "typescript";
import { readPackageJson, workspacePackageDirs } from "./workspaces.ts";

export type WorkspacePackage = {
  name: string;
  dir: string;
  exportedSubpaths: string[];
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

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);
const IGNORED_DIRS = new Set([".git", ".fallow", "coverage", "dist", "node_modules"]);

function collectExportSubpaths(exportsField: unknown): string[] {
  if (exportsField === undefined) return [];
  if (typeof exportsField === "string") return ["."];
  if (exportsField === null || typeof exportsField !== "object") return [];

  const entries = Object.keys(exportsField);
  const explicitSubpaths = entries.filter((key) => key.startsWith("."));
  if (explicitSubpaths.length > 0) return explicitSubpaths.sort();

  return ["."];
}

export function discoverWorkspacePackages(root: string): WorkspacePackage[] {
  return workspacePackageDirs(root).flatMap((dir) => {
    const packageJson = readPackageJson(path.join(dir, "package.json"));
    if (packageJson.name === undefined) return [];

    return [
      {
        name: packageJson.name,
        dir,
        exportedSubpaths: collectExportSubpaths(packageJson.exports),
      },
    ];
  });
}

function findSourceFiles(dir: string, files: string[] = []): string[] {
  if (!existsSync(dir)) return files;

  for (const entry of readdirSync(dir)) {
    const entryPath = path.join(dir, entry);
    const stats = statSync(entryPath);

    if (stats.isDirectory()) {
      if (!IGNORED_DIRS.has(entry)) findSourceFiles(entryPath, files);
      continue;
    }

    if (SOURCE_EXTENSIONS.has(path.extname(entryPath)) && !entryPath.endsWith(".d.ts")) {
      files.push(entryPath);
    }
  }

  return files;
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

function requestedSubpath(packageName: string, specifier: string): string | undefined {
  if (specifier === packageName) return ".";
  if (!specifier.startsWith(`${packageName}/`)) return undefined;
  return `./${specifier.slice(packageName.length + 1)}`;
}

export function checkWorkspacePackageImports(
  root: string,
  files = findSourceFiles(root),
): ExportViolation[] {
  const workspacePackages = discoverWorkspacePackages(root);
  const violations: ExportViolation[] = [];

  for (const packageInfo of workspacePackages) {
    if (packageInfo.exportedSubpaths.length === 0) {
      violations.push({
        filePath: path.join(packageInfo.dir, "package.json"),
        specifier: packageInfo.name,
        message: "workspace package must define an explicit package.json exports map",
      });
    }
  }

  for (const filePath of files) {
    for (const importSite of collectImportSites(filePath)) {
      const matchingPackage = workspacePackages.find(
        (packageInfo) => requestedSubpath(packageInfo.name, importSite.specifier) !== undefined,
      );
      if (matchingPackage === undefined) continue;

      const subpath = requestedSubpath(matchingPackage.name, importSite.specifier);
      if (subpath === undefined) continue;

      const isAllowed = matchingPackage.exportedSubpaths.some((exportedSubpath) =>
        subpathMatches(exportedSubpath, subpath),
      );
      if (isAllowed) continue;

      violations.push({
        filePath: importSite.filePath,
        specifier: importSite.specifier,
        message: `workspace import must match ${matchingPackage.name} exports map`,
      });
    }
  }

  return violations.sort((a, b) =>
    `${a.filePath}:${a.specifier}`.localeCompare(`${b.filePath}:${b.specifier}`),
  );
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
