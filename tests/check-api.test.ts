import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { type ApiPackage, checkApiPackages, discoverApiPackages } from "../scripts/check-api.ts";

function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function createWorkspace(): string {
  const root = mkdtempSync(path.join(tmpdir(), "agent-trail-check-api-"));
  mkdirSync(path.join(root, "packages", "core", "dist"), { recursive: true });
  writeJson(path.join(root, "package.json"), {
    private: true,
    workspaces: ["packages/*"],
  });

  return root;
}

function writePackage(root: string, packageJson: Record<string, unknown>): void {
  writeJson(path.join(root, "packages", "core", "package.json"), packageJson);
}

test("ignores packages without TypeScript declaration entrypoints", () => {
  const root = createWorkspace();
  writePackage(root, {
    name: "@agent-trail/schema",
    exports: {
      ".": {
        default: "./schema.json",
      },
    },
  });

  expect(discoverApiPackages(root)).toEqual([]);
  expect(checkApiPackages(root)).toEqual([]);
});

test("reports missing API Extractor config", () => {
  const root = createWorkspace();
  writePackage(root, {
    name: "@agent-trail/core",
    types: "./dist/index.d.ts",
  });
  writeFileSync(path.join(root, "packages", "core", "dist", "index.d.ts"), "export {};\n");

  expect(checkApiPackages(root)).toEqual(["@agent-trail/core: missing api-extractor.json"]);
});

test("reports missing declaration entrypoint", () => {
  const root = createWorkspace();
  writePackage(root, {
    name: "@agent-trail/core",
    exports: {
      ".": {
        types: "./dist/index.d.ts",
        default: "./dist/index.js",
      },
    },
  });
  writeJson(path.join(root, "packages", "core", "api-extractor.json"), {});

  expect(checkApiPackages(root)).toEqual([
    "@agent-trail/core: declaration entrypoint missing: ./dist/index.d.ts",
  ]);
});

test("runs API Extractor for packages with config and declarations", () => {
  const root = createWorkspace();
  writePackage(root, {
    name: "@agent-trail/core",
    exports: {
      ".": {
        types: "./dist/index.d.ts",
        default: "./dist/index.js",
      },
    },
  });
  writeJson(path.join(root, "packages", "core", "api-extractor.json"), {});
  writeFileSync(path.join(root, "packages", "core", "dist", "index.d.ts"), "export {};\n");

  const checkedPackages: ApiPackage[] = [];
  const errors = checkApiPackages(root, (packageInfo) => {
    checkedPackages.push(packageInfo);
    return true;
  });

  expect(errors).toEqual([]);
  expect(checkedPackages.map((packageInfo) => packageInfo.name)).toEqual(["@agent-trail/core"]);
});

test("reports API Extractor failure", () => {
  const root = createWorkspace();
  writePackage(root, {
    name: "@agent-trail/core",
    types: "./dist/index.d.ts",
  });
  writeJson(path.join(root, "packages", "core", "api-extractor.json"), {});
  writeFileSync(path.join(root, "packages", "core", "dist", "index.d.ts"), "export {};\n");

  expect(checkApiPackages(root, () => false)).toEqual(["@agent-trail/core: API Extractor failed"]);
});
