import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  FIXTURES_ASSET,
  RELEASE_TAG,
  RELEASE_URL,
  SCHEMA_ASSET,
  SPEC_VERSION,
} from "./spec-release.ts";

export type ReleaseAsset = {
  name: string;
  url: string;
  sha256: string;
};

export type SchemaAsset = ReleaseAsset & {
  targetPath: string;
};

export type FixturesAsset = ReleaseAsset & {
  targetPath: string;
};

export type ExtractedFile = {
  path: string;
  sha256: string;
};

export type SpecArtifactManifest = {
  specVersion: string;
  release: {
    tag: string;
    url: string;
  };
  assets: {
    schema: SchemaAsset;
    fixtures: FixturesAsset;
  };
  extractedFiles: ExtractedFile[];
};

export const SCHEMA_PACKAGE_DIR = "packages/schema";
export const SPEC_ARTIFACT_MANIFEST = "spec-artifacts.json";

function specArtifactManifestPath(root: string): string {
  return path.join(root, SCHEMA_PACKAGE_DIR, SPEC_ARTIFACT_MANIFEST);
}

export async function readSpecArtifactManifest(root: string): Promise<SpecArtifactManifest> {
  const manifest = JSON.parse(await readFile(specArtifactManifestPath(root), "utf8")) as unknown;
  return parseSpecArtifactManifest(manifest);
}

export function parseSpecArtifactManifest(value: unknown): SpecArtifactManifest {
  const manifest = requireRecord(value, "manifest");
  const release = requireRecord(manifest.release, "manifest.release");
  const assets = requireRecord(manifest.assets, "manifest.assets");
  const schema = requireRecord(assets.schema, "manifest.assets.schema");
  const fixtures = requireRecord(assets.fixtures, "manifest.assets.fixtures");
  const extractedFiles = requireArray(manifest.extractedFiles, "manifest.extractedFiles");
  const fixturesTargetPath = safeManifestPath(
    requireString(fixtures.targetPath, "manifest.assets.fixtures.targetPath"),
  );

  return {
    specVersion: requireString(manifest.specVersion, "manifest.specVersion"),
    release: {
      tag: requireString(release.tag, "manifest.release.tag"),
      url: requireString(release.url, "manifest.release.url"),
    },
    assets: {
      schema: {
        name: requireString(schema.name, "manifest.assets.schema.name"),
        url: requireString(schema.url, "manifest.assets.schema.url"),
        sha256: requireSha256(schema.sha256, "manifest.assets.schema.sha256"),
        targetPath: safeManifestPath(
          requireString(schema.targetPath, "manifest.assets.schema.targetPath"),
        ),
      },
      fixtures: {
        name: requireString(fixtures.name, "manifest.assets.fixtures.name"),
        url: requireString(fixtures.url, "manifest.assets.fixtures.url"),
        sha256: requireSha256(fixtures.sha256, "manifest.assets.fixtures.sha256"),
        targetPath: fixturesTargetPath,
      },
    },
    extractedFiles: extractedFiles.map((file, index) => {
      const record = requireRecord(file, `manifest.extractedFiles[${index}]`);
      const filePath = safeManifestPath(
        requireString(record.path, `manifest.extractedFiles[${index}].path`),
      );
      if (!isInsideManifestPath(fixturesTargetPath, filePath)) {
        throw new Error(
          `manifest.extractedFiles[${index}].path must be inside ${fixturesTargetPath}: ${filePath}`,
        );
      }
      return {
        path: filePath,
        sha256: requireSha256(record.sha256, `manifest.extractedFiles[${index}].sha256`),
      };
    }),
  };
}

function safeManifestPath(relativePath: string): string {
  if (relativePath.length === 0) throw new Error("manifest path must not be empty");
  if (path.posix.isAbsolute(relativePath) || path.win32.isAbsolute(relativePath)) {
    throw new Error(`manifest path must be relative: ${relativePath}`);
  }

  const normalized = relativePath.split(path.win32.sep).join(path.posix.sep);
  const cleanPath = path.posix.normalize(normalized);
  if (cleanPath === "." || cleanPath === ".." || cleanPath.startsWith("../")) {
    throw new Error(`manifest path must stay inside package: ${relativePath}`);
  }
  return cleanPath;
}

export async function fileSha256(filePath: string): Promise<string> {
  return bytesSha256(await readFile(filePath));
}

export function bytesSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function listRegularFiles(root: string): Promise<string[]> {
  if (!existsSync(root)) return [];
  const rootStat = await lstat(root);
  if (rootStat.isSymbolicLink()) throw new Error(`refusing symlinked artifact: ${root}`);
  if (rootStat.isFile()) return [root];
  if (!rootStat.isDirectory()) throw new Error(`refusing unsupported artifact type: ${root}`);

  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`refusing symlinked artifact: ${entryPath}`);
    if (entry.isDirectory()) {
      files.push(...(await listRegularFiles(entryPath)));
      continue;
    }
    if (entry.isFile()) {
      files.push(entryPath);
      continue;
    }

    throw new Error(`refusing unsupported artifact type: ${entryPath}`);
  }

  return files.sort();
}

export async function verifyVendoredSpecArtifacts(
  root: string,
  manifest: SpecArtifactManifest,
): Promise<string[]> {
  const errors: string[] = [];
  const packageDir = path.join(root, SCHEMA_PACKAGE_DIR);
  const schemaPath = path.join(packageDir, manifest.assets.schema.targetPath);
  const fixturesPath = path.join(packageDir, manifest.assets.fixtures.targetPath);

  verifyPinnedManifestMetadata(manifest, errors);
  await verifyFileHash(schemaPath, manifest.assets.schema.sha256, errors);
  await verifySchemaDirectory(packageDir, manifest, errors);
  await verifySchemaPackageExports(packageDir, manifest, errors);

  const expectedFiles = new Map<string, string>();
  for (const file of manifest.extractedFiles) {
    expectedFiles.set(file.path, file.sha256);
    await verifyFileHash(path.join(packageDir, file.path), file.sha256, errors);
  }

  const actualFiles = (await listRegularFiles(fixturesPath)).map((filePath) =>
    toPosixPath(path.relative(packageDir, filePath)),
  );
  for (const filePath of actualFiles) {
    if (!expectedFiles.has(filePath)) errors.push(`unexpected vendored fixture: ${filePath}`);
  }
  return errors.sort();
}

function verifyPinnedManifestMetadata(manifest: SpecArtifactManifest, errors: string[]): void {
  verifyPinnedValue("specVersion", manifest.specVersion, SPEC_VERSION, errors);
  verifyPinnedValue("release.tag", manifest.release.tag, RELEASE_TAG, errors);
  verifyPinnedValue("release.url", manifest.release.url, RELEASE_URL, errors);
  verifyPinnedAsset("assets.schema", manifest.assets.schema, SCHEMA_ASSET, errors);
  verifyPinnedAsset("assets.fixtures", manifest.assets.fixtures, FIXTURES_ASSET, errors);
}

function verifyPinnedAsset(
  label: string,
  actual: ReleaseAsset & { targetPath: string },
  expected: ReleaseAsset & { targetPath: string },
  errors: string[],
): void {
  verifyPinnedValue(`${label}.name`, actual.name, expected.name, errors);
  verifyPinnedValue(`${label}.url`, actual.url, expected.url, errors);
  verifyPinnedValue(`${label}.sha256`, actual.sha256, expected.sha256, errors);
  verifyPinnedValue(`${label}.targetPath`, actual.targetPath, expected.targetPath, errors);
}

function verifyPinnedValue(
  label: string,
  actual: string,
  expected: string,
  errors: string[],
): void {
  if (actual !== expected) {
    errors.push(
      `manifest ${label} drifted from pinned release: expected ${expected} got ${actual}`,
    );
  }
}

async function verifySchemaDirectory(
  packageDir: string,
  manifest: SpecArtifactManifest,
  errors: string[],
): Promise<void> {
  const schemaDir = path.dirname(path.join(packageDir, manifest.assets.schema.targetPath));
  const expectedSchemaPath = manifest.assets.schema.targetPath;
  const actualFiles = (await listRegularFiles(schemaDir)).map((filePath) =>
    toPosixPath(path.relative(packageDir, filePath)),
  );
  for (const filePath of actualFiles) {
    if (filePath !== expectedSchemaPath)
      errors.push(`unexpected vendored schema file: ${filePath}`);
  }
}

async function verifySchemaPackageExports(
  packageDir: string,
  manifest: SpecArtifactManifest,
  errors: string[],
): Promise<void> {
  const packageJson = requireRecord(
    JSON.parse(await readFile(path.join(packageDir, "package.json"), "utf8")) as unknown,
    "packages/schema/package.json",
  );
  const exportsRecord = requireRecord(packageJson.exports, "packages/schema/package.json.exports");
  const schemaExportPath = `./${manifest.assets.schema.targetPath}`;

  verifyPackageExport(".", schemaExportPath, exportsRecord, errors);
  verifyPackageExport(`./v${manifest.specVersion}`, schemaExportPath, exportsRecord, errors);
  verifyPackageExport(schemaExportPath, schemaExportPath, exportsRecord, errors);
}

function verifyPackageExport(
  subpath: string,
  expectedDefault: string,
  exportsRecord: Record<string, unknown>,
  errors: string[],
): void {
  const exportValue = exportsRecord[subpath];
  if (typeof exportValue === "string") {
    if (exportValue !== expectedDefault) {
      errors.push(
        `packages/schema package export ${subpath} drifted from pinned schema path: expected ${expectedDefault} got ${exportValue}`,
      );
    }
    return;
  }

  const exportRecord = requireRecord(
    exportValue,
    `packages/schema/package.json.exports.${subpath}`,
  );
  const actualDefault = requireString(
    exportRecord.default,
    `packages/schema/package.json.exports.${subpath}.default`,
  );
  if (actualDefault !== expectedDefault) {
    errors.push(
      `packages/schema package export ${subpath} drifted from pinned schema path: expected ${expectedDefault} got ${actualDefault}`,
    );
  }
}

async function verifyFileHash(
  filePath: string,
  expectedSha256: string,
  errors: string[],
): Promise<void> {
  if (!existsSync(filePath)) {
    errors.push(`missing vendored artifact: ${filePath}`);
    return;
  }

  if (!(await lstat(filePath)).isFile()) {
    errors.push(`vendored artifact is not a file: ${filePath}`);
    return;
  }

  const actualSha256 = await fileSha256(filePath);
  if (actualSha256 !== expectedSha256) {
    errors.push(
      `vendored artifact checksum mismatch: ${filePath} expected ${expectedSha256} got ${actualSha256}`,
    );
  }
}

function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join(path.posix.sep);
}

function isInsideManifestPath(parentPath: string, childPath: string): boolean {
  return childPath.startsWith(`${parentPath}/`);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  return value;
}

function requireSha256(value: unknown, label: string): string {
  const text = requireString(value, label);
  if (!/^[a-f0-9]{64}$/.test(text)) throw new Error(`${label} must be a SHA-256 hex digest`);
  return text;
}
