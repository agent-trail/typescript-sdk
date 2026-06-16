import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import attwPackageJson from "@arethetypeswrong/cli/package.json" with { type: "json" };
import { publint } from "publint";
import { formatMessage } from "publint/utils";
import { readPackageJson, workspacePackageDirs } from "./workspaces.ts";

export type PublishPackage = {
  name: string;
  dir: string;
  shouldCheckTypes: boolean;
};

export type CommandResult = {
  ok: boolean;
  output?: string;
};

export type PublishReadinessRunner = {
  packPackage: (packageInfo: PublishPackage, destinationDir: string) => string;
  runPublint: (
    packageInfo: PublishPackage,
    tarballPath: string,
  ) => CommandResult | Promise<CommandResult>;
  runAttw: (
    packageInfo: PublishPackage,
    tarballPath: string,
  ) => CommandResult | Promise<CommandResult>;
};

type PackageJson = ReturnType<typeof readPackageJson> & {
  private?: boolean;
  version?: string;
};

export function discoverPublishPackages(root: string): PublishPackage[] {
  return workspacePackageDirs(root)
    .flatMap((dir) => {
      const packageJson = readPackageJson(path.join(dir, "package.json")) as PackageJson;
      if (packageJson.name === undefined || packageJson.private === true) return [];

      return [
        {
          name: packageJson.name,
          dir,
          shouldCheckTypes: hasTypeEntrypoint(packageJson),
        },
      ];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function checkPublishReadiness(
  root: string,
  runner: PublishReadinessRunner = defaultRunner,
): Promise<string[]> {
  const packages = discoverPublishPackages(root);
  const destinationDir = mkdtempSync(path.join(tmpdir(), "agent-trail-packs-"));
  const errors: string[] = [];

  try {
    for (const packageInfo of packages) {
      const tarballPath = packPackage(packageInfo, destinationDir, runner, errors);
      if (tarballPath === undefined) continue;

      await checkTool(
        packageInfo,
        "publint",
        () => runner.runPublint(packageInfo, tarballPath),
        errors,
      );

      if (packageInfo.shouldCheckTypes) {
        await checkTool(
          packageInfo,
          "attw",
          () => runner.runAttw(packageInfo, tarballPath),
          errors,
        );
      }
    }
  } finally {
    rmSync(destinationDir, { force: true, recursive: true });
  }

  return errors;
}

function packPackage(
  packageInfo: PublishPackage,
  destinationDir: string,
  runner: PublishReadinessRunner,
  errors: string[],
): string | undefined {
  try {
    return runner.packPackage(packageInfo, destinationDir);
  } catch (error) {
    errors.push(formatToolFailure(packageInfo, "pack", errorMessage(error)));
    return undefined;
  }
}

async function checkTool(
  packageInfo: PublishPackage,
  toolName: "publint" | "attw",
  run: () => CommandResult | Promise<CommandResult>,
  errors: string[],
): Promise<void> {
  try {
    const result = await run();
    if (!result.ok) errors.push(formatToolFailure(packageInfo, toolName, result.output));
  } catch (error) {
    errors.push(formatToolFailure(packageInfo, toolName, errorMessage(error)));
  }
}

function hasTypeEntrypoint(packageJson: PackageJson): boolean {
  if (typeof packageJson.types === "string") return true;

  const exportsMap = asRecord(packageJson.exports);
  if (exportsMap === undefined) return false;

  return exportsContainTypes(exportsMap["."]);
}

function exportsContainTypes(value: unknown): boolean {
  const record = asRecord(value);
  if (record === undefined) return false;

  return Object.entries(record).some(
    ([key, nested]) => key === "types" || exportsContainTypes(nested),
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function formatToolFailure(
  packageInfo: PublishPackage,
  toolName: "pack" | "publint" | "attw",
  output: string | undefined,
): string {
  const detail = output?.trim();
  return detail === undefined || detail.length === 0
    ? `${packageInfo.name}: ${toolName} failed`
    : `${packageInfo.name}: ${toolName} failed: ${detail}`;
}

const defaultRunner: PublishReadinessRunner = {
  packPackage(packageInfo, destinationDir) {
    const result = Bun.spawnSync(
      ["bun", "pm", "pack", "--destination", destinationDir, "--quiet"],
      {
        cwd: packageInfo.dir,
        stderr: "pipe",
        stdout: "pipe",
      },
    );
    if (!result.success) throw new Error(commandOutput(result));

    const tarballPath = parseTarballPath(commandOutput(result), destinationDir);
    if (!existsSync(tarballPath)) {
      throw new Error(`packed tarball not found: ${tarballPath}`);
    }

    return tarballPath;
  },
  async runPublint(_packageInfo, tarballPath) {
    const tarball = await Bun.file(tarballPath).arrayBuffer();
    const result = await publint({
      pack: { tarball },
      strict: true,
    });
    const failures = result.messages.filter(
      (message) => message.type === "error" || message.type === "warning",
    );

    return {
      ok: failures.length === 0,
      output: failures
        .map((message) => formatMessage(message, result.pkg, { color: false }))
        .filter(isPresent)
        .join("\n"),
    };
  },
  runAttw(_packageInfo, tarballPath) {
    return runCommand(["bun", attwBinPath(), tarballPath, "--profile", "esm-only", "--no-emoji"]);
  },
};

function runCommand(args: string[]): CommandResult {
  const result = Bun.spawnSync(args, {
    stderr: "pipe",
    stdout: "pipe",
  });

  return {
    ok: result.success,
    output: commandOutput(result),
  };
}

function commandOutput(result: Bun.SyncSubprocess<"pipe", "pipe">): string {
  const decoder = new TextDecoder();
  return [decoder.decode(result.stdout), decoder.decode(result.stderr)]
    .map((output) => output.trim())
    .filter((output) => output.length > 0)
    .join("\n");
}

function parseTarballPath(output: string, destinationDir: string): string {
  const tarballLine = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.endsWith(".tgz"));
  if (tarballLine === undefined) {
    throw new Error("bun pm pack did not report a tarball path");
  }

  return path.isAbsolute(tarballLine) ? tarballLine : path.join(destinationDir, tarballLine);
}

function isPresent<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function attwBinPath(): string {
  const bin = (attwPackageJson as { bin: Record<string, string> }).bin.attw;
  if (bin === undefined) throw new Error("@arethetypeswrong/cli package.json is missing bin.attw");
  return fileURLToPath(new URL(bin, import.meta.resolve("@arethetypeswrong/cli/package.json")));
}

async function main(root = process.cwd()): Promise<number> {
  const errors = await checkPublishReadiness(root);
  if (errors.length === 0) {
    console.log("check-publish-readiness: ok");
    return 0;
  }

  console.error("check-publish-readiness: failed");
  for (const error of errors) console.error(error);
  return 1;
}

if (import.meta.main) {
  process.exitCode = await main();
}
