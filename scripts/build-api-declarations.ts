import { existsSync } from "node:fs";
import path from "node:path";
import { discoverApiPackages } from "./check-api.ts";

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

  const results = apiPackages.map((packageInfo) => {
    const configPath = packageTsconfig(packageInfo.dir);
    if (existsSync(configPath)) return runTsc(configPath);

    console.error(`${packageInfo.name}: missing tsconfig.json for declaration build`);
    return false;
  });

  return results.every(Boolean) ? 0 : 1;
}

function packageTsconfig(packageDir: string): string {
  return path.join(packageDir, "tsconfig.json");
}

if (import.meta.main) {
  process.exitCode = main();
}
