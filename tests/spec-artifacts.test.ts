import { expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { assertNoExternalSchemaRefs } from "../scripts/generate-types.ts";
import {
  parseSpecArtifactManifest,
  readSpecArtifactManifest,
  SCHEMA_PACKAGE_DIR,
  verifyVendoredSpecArtifacts,
} from "../scripts/spec-artifacts.ts";
import { validateFixtureTarListing } from "../scripts/vendor-spec.ts";

function createVendoredCopy(): string {
  const root = mkdtempSync(path.join(tmpdir(), "agent-trail-spec-artifacts-"));
  mkdirSync(path.join(root, "packages"), { recursive: true });
  cpSync(SCHEMA_PACKAGE_DIR, path.join(root, SCHEMA_PACKAGE_DIR), { recursive: true });
  return root;
}

test("accepts untampered vendored spec artifacts", async () => {
  const root = createVendoredCopy();
  const manifest = await readSpecArtifactManifest(root);

  expect(await verifyVendoredSpecArtifacts(root, manifest)).toEqual([]);
});

test("rejects a tampered vendored fixture", async () => {
  const root = createVendoredCopy();
  const manifest = await readSpecArtifactManifest(root);
  writeFileSync(
    path.join(root, SCHEMA_PACKAGE_DIR, "fixtures/validation/valid/minimal-linear.trail.jsonl"),
    "\n",
    { flag: "a" },
  );

  expect(await verifyVendoredSpecArtifacts(root, manifest)).toEqual(
    expect.arrayContaining([expect.stringContaining("vendored artifact checksum mismatch")]),
  );
});

test("rejects unexpected vendored schema files", async () => {
  const root = createVendoredCopy();
  const manifest = await readSpecArtifactManifest(root);
  writeFileSync(path.join(root, SCHEMA_PACKAGE_DIR, "schema/extra.json"), "{}\n");

  expect(await verifyVendoredSpecArtifacts(root, manifest)).toEqual(
    expect.arrayContaining([expect.stringContaining("unexpected vendored schema file")]),
  );
});

test("rejects manifests that drift from pinned release metadata", async () => {
  const root = createVendoredCopy();
  const manifest = await readSpecArtifactManifest(root);

  expect(
    await verifyVendoredSpecArtifacts(root, {
      ...manifest,
      assets: {
        ...manifest.assets,
        schema: {
          ...manifest.assets.schema,
          sha256: "0000000000000000000000000000000000000000000000000000000000000000",
        },
      },
    }),
  ).toEqual(
    expect.arrayContaining([
      expect.stringContaining("manifest assets.schema.sha256 drifted from pinned release"),
    ]),
  );
});

test("rejects extracted manifest files outside the fixtures root", () => {
  const validManifest = {
    specVersion: "0.1.0",
    release: {
      tag: "v0.1.0",
      url: "https://github.com/agent-trail/spec/releases/tag/v0.1.0",
    },
    assets: {
      schema: {
        name: "schema-v0.1.0.json",
        url: "https://github.com/agent-trail/spec/releases/download/v0.1.0/schema-v0.1.0.json",
        sha256: "6c89c0287a94925b98d228a12336786e76eefbb9b33de8b0ef5b9f8f5ae21a6f",
        targetPath: "schema/v0.1.0.json",
      },
      fixtures: {
        name: "fixtures-v0.1.0.tar.gz",
        url: "https://github.com/agent-trail/spec/releases/download/v0.1.0/fixtures-v0.1.0.tar.gz",
        sha256: "6f361996a6c7bd0c21fd54655421c8b8e345c376a4c3fbbf0887e59f4bc0c39f",
        targetPath: "fixtures",
      },
    },
    extractedFiles: [
      {
        path: "schema/v0.1.0.json",
        sha256: "6c89c0287a94925b98d228a12336786e76eefbb9b33de8b0ef5b9f8f5ae21a6f",
      },
    ],
  };

  expect(() => parseSpecArtifactManifest(validManifest)).toThrow(
    "manifest.extractedFiles[0].path must be inside fixtures",
  );
});

test("rejects fixture tar members outside fixtures", () => {
  expect(() =>
    validateFixtureTarListing(
      "../escape.txt\n",
      "-rw-r--r--  0 root root 1 Jun 13 01:07 ../escape.txt\n",
    ),
  ).toThrow("tar member path must stay inside archive root");
});

test("rejects fixture tar links", () => {
  expect(() =>
    validateFixtureTarListing(
      "fixtures/link\n",
      "lrwxrwxrwx  0 root root 0 Jun 13 01:07 fixtures/link -> /tmp/x\n",
    ),
  ).toThrow("unsupported tar member type");
});

test("accepts GNU tar verbose listings", () => {
  expect(() =>
    validateFixtureTarListing(
      "fixtures/validation/valid/minimal-linear.trail.jsonl\n",
      "-rw-r--r-- root/root 3 2026-06-13 01:07 fixtures/validation/valid/minimal-linear.trail.jsonl\n",
    ),
  ).not.toThrow();
});

test("rejects manifest entries that point at directories", async () => {
  const root = createVendoredCopy();
  const manifest = await readSpecArtifactManifest(root);

  expect(
    await verifyVendoredSpecArtifacts(root, {
      ...manifest,
      extractedFiles: [
        { path: "fixtures/validation", sha256: manifest.extractedFiles[0]?.sha256 ?? "" },
      ],
    }),
  ).toEqual(expect.arrayContaining([expect.stringContaining("vendored artifact is not a file")]));
});

test("rejects external schema refs before generating types", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "agent-trail-schema-refs-"));
  const schemaPath = path.join(root, "schema.json");
  writeFileSync(
    schemaPath,
    JSON.stringify({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $ref: "https://example.invalid/schema.json",
    }),
  );

  await expect(assertNoExternalSchemaRefs(schemaPath)).rejects.toThrow(
    "schema contains external $ref values",
  );
});

test("rejects manifest paths that escape the schema package", () => {
  expect(() =>
    parseSpecArtifactManifest({
      specVersion: "0.1.0",
      release: {
        tag: "v0.1.0",
        url: "https://github.com/agent-trail/spec/releases/tag/v0.1.0",
      },
      assets: {
        schema: {
          name: "schema-v0.1.0.json",
          url: "https://github.com/agent-trail/spec/releases/download/v0.1.0/schema-v0.1.0.json",
          sha256: "6c89c0287a94925b98d228a12336786e76eefbb9b33de8b0ef5b9f8f5ae21a6f",
          targetPath: "../schema.json",
        },
        fixtures: {
          name: "fixtures-v0.1.0.tar.gz",
          url: "https://github.com/agent-trail/spec/releases/download/v0.1.0/fixtures-v0.1.0.tar.gz",
          sha256: "6f361996a6c7bd0c21fd54655421c8b8e345c376a4c3fbbf0887e59f4bc0c39f",
          targetPath: "fixtures",
        },
      },
      extractedFiles: [],
    }),
  ).toThrow("manifest path must stay inside package");
});
