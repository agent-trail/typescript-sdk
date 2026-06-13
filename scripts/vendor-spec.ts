import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { generateTypes } from "./generate-types.ts";
import {
  bytesSha256,
  fileSha256,
  listRegularFiles,
  SCHEMA_PACKAGE_DIR,
  SPEC_ARTIFACT_MANIFEST,
  type SpecArtifactManifest,
} from "./spec-artifacts.ts";

const SPEC_VERSION = "0.1.0";
const RELEASE_TAG = `v${SPEC_VERSION}`;
const RELEASE_URL = `https://github.com/agent-trail/spec/releases/tag/${RELEASE_TAG}`;
const RELEASE_DOWNLOAD_URL = `https://github.com/agent-trail/spec/releases/download/${RELEASE_TAG}`;
const SCHEMA_ASSET = {
  name: `schema-${RELEASE_TAG}.json`,
  url: `${RELEASE_DOWNLOAD_URL}/schema-${RELEASE_TAG}.json`,
  sha256: "6c89c0287a94925b98d228a12336786e76eefbb9b33de8b0ef5b9f8f5ae21a6f",
  targetPath: "schema/v0.1.0.json",
};
const FIXTURES_ASSET = {
  name: `fixtures-${RELEASE_TAG}.tar.gz`,
  url: `${RELEASE_DOWNLOAD_URL}/fixtures-${RELEASE_TAG}.tar.gz`,
  sha256: "6f361996a6c7bd0c21fd54655421c8b8e345c376a4c3fbbf0887e59f4bc0c39f",
  targetPath: "fixtures",
};
const CHECKSUMS_URL = `${RELEASE_DOWNLOAD_URL}/checksums-${RELEASE_TAG}.txt`;

async function main(root = process.cwd()): Promise<number> {
  const tempDir = await mkdtemp(path.join(tmpdir(), "agent-trail-spec-"));
  const schemaAssetPath = path.join(tempDir, SCHEMA_ASSET.name);
  const fixturesAssetPath = path.join(tempDir, FIXTURES_ASSET.name);

  const checksums = parseChecksums(await downloadText(CHECKSUMS_URL));
  verifyChecksumEntry(checksums, SCHEMA_ASSET.name, SCHEMA_ASSET.sha256);
  verifyChecksumEntry(checksums, FIXTURES_ASSET.name, FIXTURES_ASSET.sha256);

  await downloadAsset(SCHEMA_ASSET.url, schemaAssetPath, SCHEMA_ASSET.sha256);
  await downloadAsset(FIXTURES_ASSET.url, fixturesAssetPath, FIXTURES_ASSET.sha256);

  const packageDir = path.join(root, SCHEMA_PACKAGE_DIR);
  await mkdir(path.join(packageDir, "schema"), { recursive: true });
  await mkdir(packageDir, { recursive: true });
  await writeFile(path.join(packageDir, SCHEMA_ASSET.targetPath), await readFile(schemaAssetPath));

  const fixturesDir = path.join(packageDir, FIXTURES_ASSET.targetPath);
  const extractedFixturesDir = path.join(tempDir, "extracted", FIXTURES_ASSET.targetPath);
  await validateFixtureArchive(fixturesAssetPath);
  await extractFixtureArchive(fixturesAssetPath, path.join(tempDir, "extracted"));
  await listRegularFiles(extractedFixturesDir);
  await rm(fixturesDir, { force: true, recursive: true });
  await cp(extractedFixturesDir, fixturesDir, { recursive: true });

  await writeManifest(root, await buildManifest(root));
  await generateTypes(root);

  console.log(`vendor-spec: vendored ${RELEASE_TAG}`);
  return 0;
}

export function validateFixtureTarListing(listing: string): void {
  for (const line of listing.split("\n")) {
    if (line.trim() === "") continue;
    const match = line.match(/^(\S)\S*\s+\d+\s+\S+\s+\S+\s+\d+\s+\S+\s+\d+\s+\S+\s+(.+)$/);
    if (match === null) throw new Error(`unable to parse tar member: ${line}`);

    const type = match[1];
    const rawMemberPath = match[2];
    if (rawMemberPath === undefined) throw new Error(`unable to parse tar member path: ${line}`);
    if (type !== "-" && type !== "d") {
      throw new Error(`unsupported tar member type: ${rawMemberPath}`);
    }

    const memberPath = safeArchivePath(rawMemberPath);
    if (memberPath !== FIXTURES_ASSET.targetPath && !memberPath.startsWith("fixtures/")) {
      throw new Error(`tar member must stay inside fixtures/: ${rawMemberPath}`);
    }
  }
}

async function validateFixtureArchive(archivePath: string): Promise<void> {
  const result = Bun.spawnSync(["tar", "-tvzf", archivePath]);
  if (!result.success) throw new Error("failed to inspect fixtures release asset");
  validateFixtureTarListing(result.stdout.toString());
}

async function extractFixtureArchive(archivePath: string, targetDir: string): Promise<void> {
  await mkdir(targetDir, { recursive: true });
  const result = Bun.spawnSync(["tar", "-xzf", archivePath, "-C", targetDir]);
  if (!result.success) throw new Error("failed to extract fixtures release asset");
}

function safeArchivePath(rawPath: string): string {
  const normalized = rawPath.split(path.win32.sep).join(path.posix.sep);
  if (path.posix.isAbsolute(normalized) || path.win32.isAbsolute(rawPath)) {
    throw new Error(`tar member path must be relative: ${rawPath}`);
  }

  const memberPath = path.posix.normalize(normalized);
  if (memberPath === "." || memberPath === ".." || memberPath.startsWith("../")) {
    throw new Error(`tar member path must stay inside archive root: ${rawPath}`);
  }
  return memberPath;
}

async function downloadText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`download failed: ${url} (${response.status})`);
  return response.text();
}

async function downloadAsset(
  url: string,
  targetPath: string,
  expectedSha256: string,
): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`download failed: ${url} (${response.status})`);

  const bytes = new Uint8Array(await response.arrayBuffer());
  const actualSha256 = bytesSha256(bytes);
  if (actualSha256 !== expectedSha256) {
    throw new Error(`${url} checksum mismatch: expected ${expectedSha256} got ${actualSha256}`);
  }

  await writeFile(targetPath, bytes);
}

function parseChecksums(text: string): Map<string, string> {
  return new Map(
    text
      .trim()
      .split("\n")
      .map((line) => {
        const [sha256, name] = line.trim().split(/\s+/, 2);
        if (sha256 === undefined || name === undefined) {
          throw new Error(`invalid checksum line: ${line}`);
        }
        return [name, sha256];
      }),
  );
}

function verifyChecksumEntry(
  checksums: Map<string, string>,
  name: string,
  expectedSha256: string,
): void {
  const actualSha256 = checksums.get(name);
  if (actualSha256 !== expectedSha256) {
    throw new Error(
      `${name} checksum entry mismatch: expected ${expectedSha256} got ${actualSha256}`,
    );
  }
}

async function buildManifest(root: string): Promise<SpecArtifactManifest> {
  const packageDir = path.join(root, SCHEMA_PACKAGE_DIR);
  const fixturesDir = path.join(packageDir, FIXTURES_ASSET.targetPath);
  const extractedFiles = await Promise.all(
    (await listRegularFiles(fixturesDir)).map(async (filePath) => ({
      path: path.relative(packageDir, filePath).split(path.sep).join(path.posix.sep),
      sha256: await fileSha256(filePath),
    })),
  );

  return {
    specVersion: SPEC_VERSION,
    release: {
      tag: RELEASE_TAG,
      url: RELEASE_URL,
    },
    assets: {
      schema: SCHEMA_ASSET,
      fixtures: FIXTURES_ASSET,
    },
    extractedFiles: extractedFiles.sort((left, right) => left.path.localeCompare(right.path)),
  };
}

async function writeManifest(root: string, manifest: SpecArtifactManifest): Promise<void> {
  await writeFile(
    path.join(root, SCHEMA_PACKAGE_DIR, SPEC_ARTIFACT_MANIFEST),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

if (import.meta.main) {
  process.exitCode = await main();
}
