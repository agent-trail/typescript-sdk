import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkWorkspacePackageImports } from "../scripts/check-exports.ts";

function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function createWorkspace(): string {
  const root = mkdtempSync(path.join(tmpdir(), "agent-trail-check-exports-"));
  mkdirSync(path.join(root, "packages", "core"), { recursive: true });
  mkdirSync(path.join(root, "packages", "schema"), { recursive: true });
  mkdirSync(path.join(root, "src"), { recursive: true });

  writeJson(path.join(root, "package.json"), {
    private: true,
    workspaces: ["packages/*"],
  });
  writeJson(path.join(root, "packages", "core", "package.json"), {
    name: "@agent-trail/core",
    exports: {
      ".": {
        types: "./dist/index.d.ts",
        default: "./dist/index.js",
      },
      "./package.json": "./package.json",
    },
  });
  writeJson(path.join(root, "packages", "schema", "package.json"), {
    name: "@agent-trail/schema",
    exports: {
      ".": {
        default: "./schema.json",
      },
      "./v0.1.0": {
        default: "./schema.json",
      },
      "./fixtures/*": "./fixtures/*",
      "./fixtures/private/*": null,
      "./conformance/fixtures/*": "./conformance/fixtures/*",
      "./package.json": "./package.json",
    },
  });

  return root;
}

function writeSource(root: string, source: string): string {
  const filePath = path.join(root, "src", "entry.ts");
  writeFileSync(filePath, source);
  return filePath;
}

test("allows bare workspace package imports", () => {
  const root = createWorkspace();
  writeSource(root, 'import { validateTrailString } from "@agent-trail/core";\n');

  expect(checkWorkspacePackageImports(root)).toEqual([]);
});

test("allows declared asset and wildcard subpath imports", () => {
  const root = createWorkspace();
  writeSource(
    root,
    [
      'import schema from "@agent-trail/schema/v0.1.0";',
      'import fixture from "@agent-trail/schema/conformance/fixtures/minimal.json";',
    ].join("\n"),
  );

  expect(checkWorkspacePackageImports(root)).toEqual([]);
});

test("rejects src deep imports", () => {
  const root = createWorkspace();
  const filePath = writeSource(
    root,
    'import { computeContentHash } from "@agent-trail/core/src/hash.ts";\n',
  );

  expect(checkWorkspacePackageImports(root)).toEqual([
    {
      filePath,
      specifier: "@agent-trail/core/src/hash.ts",
      message: "workspace import must match @agent-trail/core exports map",
    },
  ]);
});

test("rejects undeclared package subpaths", () => {
  const root = createWorkspace();
  const filePath = writeSource(
    root,
    'import { computeContentHash } from "@agent-trail/core/hash";\n',
  );

  expect(checkWorkspacePackageImports(root)).toEqual([
    {
      filePath,
      specifier: "@agent-trail/core/hash",
      message: "workspace import must match @agent-trail/core exports map",
    },
  ]);
});

test("rejects subpaths denied by null package exports", () => {
  const root = createWorkspace();
  const filePath = writeSource(
    root,
    'import secret from "@agent-trail/schema/fixtures/private/secret.json";\n',
  );

  expect(checkWorkspacePackageImports(root)).toEqual([
    {
      filePath,
      specifier: "@agent-trail/schema/fixtures/private/secret.json",
      message: "workspace import must match @agent-trail/schema exports map",
    },
  ]);
});

test("rejects workspace packages without explicit exports", () => {
  const root = createWorkspace();
  mkdirSync(path.join(root, "packages", "store"), { recursive: true });
  writeJson(path.join(root, "packages", "store", "package.json"), {
    name: "@agent-trail/store",
  });

  expect(checkWorkspacePackageImports(root)).toEqual([
    {
      filePath: path.join(root, "packages", "store", "package.json"),
      specifier: "@agent-trail/store",
      message: "workspace package must define an explicit package.json exports map",
    },
  ]);
});

test("ignores relative imports inside packages", () => {
  const root = createWorkspace();
  writeSource(root, 'import { helper } from "./helper";\nexport type Helper = typeof helper;\n');

  expect(checkWorkspacePackageImports(root)).toEqual([]);
});
