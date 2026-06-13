import { readFile } from "node:fs/promises";
import path from "node:path";
import { GENERATED_TYPES_PATH, generateTypes } from "./generate-types.ts";
import { readSpecArtifactManifest, verifyVendoredSpecArtifacts } from "./spec-artifacts.ts";

export async function checkSpecArtifacts(root = process.cwd()): Promise<string[]> {
  const manifest = await readSpecArtifactManifest(root);
  const errors = await verifyVendoredSpecArtifacts(root, manifest);

  const expectedGeneratedTypes = await generateTypes(root, { write: false });
  const generatedTypesPath = path.join(root, GENERATED_TYPES_PATH);
  const actualGeneratedTypes = await readGeneratedTypes(generatedTypesPath, errors);
  if (actualGeneratedTypes !== undefined && actualGeneratedTypes !== expectedGeneratedTypes) {
    errors.push(`${GENERATED_TYPES_PATH} is stale; run bun run generate:types`);
  }

  return errors.sort();
}

async function main(root = process.cwd()): Promise<number> {
  const errors = await checkSpecArtifacts(root);

  if (errors.length === 0) {
    console.log("check-spec: ok");
    return 0;
  }

  console.error("check-spec: failed");
  for (const error of errors) console.error(error);
  return 1;
}

async function readGeneratedTypes(filePath: string, errors: string[]): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    errors.push(
      `${GENERATED_TYPES_PATH} is missing or unreadable; run bun run generate:types (${String(error)})`,
    );
    return undefined;
  }
}

if (import.meta.main) {
  process.exitCode = await main();
}
