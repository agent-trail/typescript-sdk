import { existsSync } from "node:fs";
import path from "node:path";
import { Extractor } from "@microsoft/api-extractor";
import { readPackageJson, workspacePackageDirs } from "./workspaces.ts";

type ApiPackage = {
  name: string;
  dir: string;
  declarationEntrypoint: string;
};

const API_EXTRACTOR_CONFIG = "api-extractor.json";

function findExportTypes(exportsField: unknown): string | undefined {
  const exportsMap = asRecord(exportsField);
  const rootExport = exportsMap?.["."] ?? exportsMap;
  return findNestedTypes(rootExport);
}

function findNestedTypes(value: unknown): string | undefined {
  const record = asRecord(value);
  if (record === undefined) return undefined;

  return directTypes(record) ?? Object.values(record).map(directTypes).find(isPresent);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function directTypes(value: unknown): string | undefined {
  const typesValue = asRecord(value)?.types;
  return typeof typesValue === "string" ? typesValue : undefined;
}

function isPresent<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function discoverApiPackages(root: string): ApiPackage[] {
  return workspacePackageDirs(root).flatMap((dir) => {
    const packageJson = readPackageJson(path.join(dir, "package.json"));
    if (packageJson.name === undefined) return [];

    const declarationEntrypoint = packageJson.types ?? findExportTypes(packageJson.exports);
    if (declarationEntrypoint === undefined) return [];

    return [{ name: packageJson.name, dir, declarationEntrypoint }];
  });
}

function runApiExtractor(packageInfo: ApiPackage): boolean {
  const configPath = path.join(packageInfo.dir, API_EXTRACTOR_CONFIG);
  const declarationPath = path.join(packageInfo.dir, packageInfo.declarationEntrypoint);

  if (!existsSync(configPath)) {
    console.error(`${packageInfo.name}: missing ${API_EXTRACTOR_CONFIG}`);
    return false;
  }

  if (!existsSync(declarationPath)) {
    console.error(
      `${packageInfo.name}: declaration entrypoint missing: ${packageInfo.declarationEntrypoint}`,
    );
    return false;
  }

  const result = Extractor.loadConfigAndInvoke(configPath, {
    localBuild: false,
    printApiReportDiff: true,
    showVerboseMessages: false,
  });

  return result.succeeded;
}

function main(root = process.cwd()): number {
  const apiPackages = discoverApiPackages(root);
  if (apiPackages.length === 0) {
    console.log("check-api: no TS API packages found");
    return 0;
  }

  return apiPackages.map(runApiExtractor).every(Boolean) ? 0 : 1;
}

if (import.meta.main) {
  process.exitCode = main();
}
