import { readFile } from "node:fs/promises";
import path from "node:path";
import { GENERATED_TYPES_PATH, generateTypes } from "./generate-types.ts";
import { readSpecArtifactManifest, verifyVendoredSpecArtifacts } from "./spec-artifacts.ts";

async function main(root = process.cwd()): Promise<number> {
  const manifest = await readSpecArtifactManifest(root);
  const errors = await verifyVendoredSpecArtifacts(root, manifest);

  const expectedGeneratedTypes = await generateTypes(root, { write: false });
  const generatedTypesPath = path.join(root, GENERATED_TYPES_PATH);
  const actualGeneratedTypes = await readFile(generatedTypesPath, "utf8");
  if (actualGeneratedTypes !== expectedGeneratedTypes) {
    errors.push(`${GENERATED_TYPES_PATH} is stale; run bun run generate:types`);
  }

  if (errors.length === 0) {
    console.log("check-spec: ok");
    return 0;
  }

  console.error("check-spec: failed");
  for (const error of errors) console.error(error);
  return 1;
}

if (import.meta.main) {
  process.exitCode = await main();
}
