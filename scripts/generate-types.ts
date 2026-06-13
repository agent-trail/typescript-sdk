import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { compileFromFile } from "json-schema-to-typescript";
import { readSpecArtifactManifest } from "./spec-artifacts.ts";

export const GENERATED_TYPES_PATH = "packages/types/src/generated.ts";

export type GenerateTypesOptions = {
  write?: boolean;
};

export async function generateTypes(
  root = process.cwd(),
  options: GenerateTypesOptions = {},
): Promise<string> {
  const manifest = await readSpecArtifactManifest(root);
  const schemaPath = path.join(root, "packages/schema", manifest.assets.schema.targetPath);
  await assertNoExternalSchemaRefs(schemaPath);

  const generated = await compileFromFile(schemaPath, {
    bannerComment:
      "/* This file is generated from @agent-trail/schema. Run `bun run generate:types` to update it. */",
    cwd: root,
    style: {
      printWidth: 100,
      semi: true,
      singleQuote: false,
      trailingComma: "all",
    },
    strictIndexSignatures: true,
    unreachableDefinitions: true,
    unknownAny: true,
  });
  const normalized = `${generated.trimEnd()}\n`;

  if (options.write ?? true) {
    const outputPath = path.join(root, GENERATED_TYPES_PATH);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, normalized);
  }

  return normalized;
}

export async function assertNoExternalSchemaRefs(schemaPath: string): Promise<void> {
  const schema = JSON.parse(await readFile(schemaPath, "utf8")) as unknown;
  const refs = collectSchemaRefs(schema);
  const externalRefs = refs.filter((ref) => !ref.startsWith("#"));

  if (externalRefs.length > 0) {
    throw new Error(`schema contains external $ref values: ${externalRefs.join(", ")}`);
  }
}

function collectSchemaRefs(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => collectSchemaRefs(item));
  if (value === null || typeof value !== "object") return [];

  const refs: string[] = [];
  for (const [key, child] of Object.entries(value)) {
    if (key === "$ref" && typeof child === "string") {
      refs.push(child);
      continue;
    }
    refs.push(...collectSchemaRefs(child));
  }
  return refs;
}

if (import.meta.main) {
  await generateTypes();
}
