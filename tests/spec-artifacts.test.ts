import { expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  parseSpecArtifactManifest,
  readSpecArtifactManifest,
  SCHEMA_PACKAGE_DIR,
  verifyVendoredSpecArtifacts,
} from "../scripts/spec-artifacts.ts";

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
