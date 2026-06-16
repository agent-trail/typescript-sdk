import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  checkPublishReadiness,
  discoverPublishPackages,
  type PublishPackage,
} from "../scripts/check-publish-readiness.ts";

function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function createWorkspace(): string {
  const root = mkdtempSync(path.join(tmpdir(), "agent-trail-check-publish-"));
  mkdirSync(path.join(root, "packages", "runtime"), { recursive: true });
  mkdirSync(path.join(root, "packages", "schema"), { recursive: true });
  mkdirSync(path.join(root, "packages", "source-schemas"), { recursive: true });
  mkdirSync(path.join(root, "packages", "private-app"), { recursive: true });
  writeJson(path.join(root, "package.json"), {
    private: true,
    workspaces: ["packages/*"],
  });

  writeJson(path.join(root, "packages", "runtime", "package.json"), {
    name: "@agent-trail/runtime",
    version: "0.1.0",
    types: "./dist/index.d.ts",
    exports: {
      ".": {
        types: "./dist/index.d.ts",
        default: "./dist/index.js",
      },
    },
  });
  writeJson(path.join(root, "packages", "schema", "package.json"), {
    name: "@agent-trail/schema",
    version: "0.1.0",
    exports: {
      ".": {
        default: "./schema.json",
      },
    },
  });
  writeJson(path.join(root, "packages", "source-schemas", "package.json"), {
    name: "@agent-trail/source-schemas",
    version: "0.1.0",
    exports: {
      "./codex/v1": {
        types: "./codex/v1.d.ts",
        default: "./codex/v1.json",
      },
    },
  });
  writeJson(path.join(root, "packages", "private-app", "package.json"), {
    name: "@agent-trail/private-app",
    version: "0.1.0",
    private: true,
    types: "./dist/index.d.ts",
  });

  return realpathSync(root);
}

test("discovers public workspace packages and marks typed packages", () => {
  const root = createWorkspace();
  const packages = discoverPublishPackages(root);

  expect(
    packages.map(({ attwIgnoreRules, name, shouldCheckTypes }) => ({
      attwIgnoreRules,
      name,
      shouldCheckTypes,
    })),
  ).toEqual([
    { attwIgnoreRules: [], name: "@agent-trail/runtime", shouldCheckTypes: true },
    { attwIgnoreRules: [], name: "@agent-trail/schema", shouldCheckTypes: false },
    {
      attwIgnoreRules: ["false-export-default"],
      name: "@agent-trail/source-schemas",
      shouldCheckTypes: true,
    },
  ]);
});

test("packs every public package and runs type checks only for typed packages", async () => {
  const root = createWorkspace();
  const packed: string[] = [];
  const publinted: string[] = [];
  const typeChecked: string[] = [];

  const errors = await checkPublishReadiness(root, {
    packPackage: (packageInfo) => {
      packed.push(packageInfo.name);
      return path.join("/tmp/packs", `${packageInfo.name.replace("/", "-")}.tgz`);
    },
    runPublint: (packageInfo, tarballPath) => {
      publinted.push(`${packageInfo.name}:${tarballPath}`);
      return { ok: true };
    },
    runAttw: (packageInfo, tarballPath) => {
      typeChecked.push(`${packageInfo.name}:${tarballPath}`);
      return { ok: true };
    },
  });

  expect(errors).toEqual([]);
  expect(packed).toEqual([
    "@agent-trail/runtime",
    "@agent-trail/schema",
    "@agent-trail/source-schemas",
  ]);
  expect(publinted).toEqual([
    "@agent-trail/runtime:/tmp/packs/@agent-trail-runtime.tgz",
    "@agent-trail/schema:/tmp/packs/@agent-trail-schema.tgz",
    "@agent-trail/source-schemas:/tmp/packs/@agent-trail-source-schemas.tgz",
  ]);
  expect(typeChecked).toEqual([
    "@agent-trail/runtime:/tmp/packs/@agent-trail-runtime.tgz",
    "@agent-trail/source-schemas:/tmp/packs/@agent-trail-source-schemas.tgz",
  ]);
});

test("reports package-scoped tool failures", async () => {
  const root = createWorkspace();
  const failingPackage = "@agent-trail/source-schemas";

  const errors = await checkPublishReadiness(root, {
    packPackage: (packageInfo) => `/tmp/${packageInfo.name}.tgz`,
    runPublint: (packageInfo) =>
      packageInfo.name === failingPackage
        ? { ok: false, output: "missing exported file" }
        : { ok: true },
    runAttw: (packageInfo: PublishPackage) =>
      packageInfo.name === "@agent-trail/runtime"
        ? { ok: false, output: "No types" }
        : { ok: true },
  });

  expect(errors).toEqual([
    "@agent-trail/runtime: attw failed: No types",
    "@agent-trail/source-schemas: publint failed: missing exported file",
  ]);
});
