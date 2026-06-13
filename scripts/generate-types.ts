import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { compileFromFile } from "json-schema-to-typescript";

export const GENERATED_TYPES_PATH = "packages/types/src/generated.ts";
export const SCHEMA_PATH = "packages/schema/schema/v0.1.0.json";

export type GenerateTypesOptions = {
  write?: boolean;
};

export async function generateTypes(
  root = process.cwd(),
  options: GenerateTypesOptions = {},
): Promise<string> {
  const generated = await compileFromFile(path.join(root, SCHEMA_PATH), {
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

if (import.meta.main) {
  await generateTypes();
}
