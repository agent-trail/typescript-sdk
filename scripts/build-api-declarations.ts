import { existsSync } from "node:fs";
import path from "node:path";
import { type ApiPackage, discoverApiPackages } from "./check-api.ts";
import { readPackageJson } from "./workspaces.ts";

function runTsc(configPath: string): boolean {
  const result = Bun.spawnSync(["bun", "run", "tsc", "--project", configPath], {
    stderr: "inherit",
    stdout: "inherit",
  });

  return result.success;
}

function main(root = process.cwd()): number {
  const apiPackages = discoverApiPackages(root);
  if (apiPackages.length === 0) {
    console.log("build-declarations: no TS API packages found");
    return 0;
  }

  const results = sortByWorkspaceDependencies(apiPackages).map((packageInfo) => {
    const configPath = packageTsconfig(packageInfo.dir);
    if (existsSync(configPath)) return runTsc(configPath);

    console.error(`${packageInfo.name}: missing tsconfig.json for declaration build`);
    return false;
  });

  return results.every(Boolean) ? 0 : 1;
}

function packageTsconfig(packageDir: string): string {
  const buildConfig = path.join(packageDir, "tsconfig.build.json");
  return existsSync(buildConfig) ? buildConfig : path.join(packageDir, "tsconfig.json");
}

function sortByWorkspaceDependencies(apiPackages: ApiPackage[]): ApiPackage[] {
  const byName = new Map(apiPackages.map((packageInfo) => [packageInfo.name, packageInfo]));
  const visited = new Set<string>();
  const sorted: ApiPackage[] = [];

  function visit(packageInfo: ApiPackage): void {
    if (visited.has(packageInfo.name)) return;
    visited.add(packageInfo.name);

    for (const dependencyName of workspaceDependencyNames(packageInfo.dir)) {
      const dependency = byName.get(dependencyName);
      if (dependency !== undefined) visit(dependency);
    }

    sorted.push(packageInfo);
  }

  for (const packageInfo of apiPackages) visit(packageInfo);
  return sorted;
}

function workspaceDependencyNames(packageDir: string): string[] {
  const packageJson = readPackageJson(path.join(packageDir, "package.json"));
  const dependencyFields = [
    packageJson.dependencies,
    packageJson.devDependencies,
    packageJson.peerDependencies,
  ];
  return dependencyFields.flatMap((dependencies) =>
    dependencies === undefined
      ? []
      : Object.entries(dependencies)
          .filter(([, version]) => version === "workspace:*")
          .map(([name]) => name),
  );
}

if (import.meta.main) {
  process.exitCode = main();
}
