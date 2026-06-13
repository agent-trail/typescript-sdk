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
import {
  CHECKSUMS_URL,
  FIXTURES_ASSET,
  RELEASE_TAG,
  RELEASE_URL,
  SCHEMA_ASSET,
  SPEC_VERSION,
} from "./spec-release.ts";

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

export function validateFixtureTarListing(pathListing: string, verboseListing: string): void {
  const memberPaths = pathListing.split("\n").filter((line) => line.trim() !== "");
  const memberTypes = verboseListing
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => line[0]);

  if (memberPaths.length !== memberTypes.length) {
    throw new Error("tar listing path and type counts differ");
  }

  for (const [index, rawMemberPath] of memberPaths.entries()) {
    const type = memberTypes[index];
    if (type === undefined) throw new Error(`missing tar member type: ${rawMemberPath}`);
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
  const pathResult = Bun.spawnSync(["tar", "-tzf", archivePath]);
  if (!pathResult.success) throw new Error("failed to inspect fixtures release asset paths");

  const typeResult = Bun.spawnSync(["tar", "-tvzf", archivePath]);
  if (!typeResult.success) throw new Error("failed to inspect fixtures release asset types");

  validateFixtureTarListing(pathResult.stdout.toString(), typeResult.stdout.toString());
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
