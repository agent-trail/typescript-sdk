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
  const normalized = `${tightenGeneratedTypes(generated).trimEnd()}\n`;

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

function tightenGeneratedTypes(generated: string): string {
  let tightened = generated;
  tightened = replaceRequired(
    tightened,
    `  payload: {
    [k: string]: unknown | undefined;
  };`,
    "  payload: object;",
    "EntryBase.payload",
  );
  tightened = replaceRequired(
    tightened,
    "\n    minItems?: 0;",
    "",
    "TaskPlanUpdate.payload.minItems",
  );
  tightened = replaceRequired(
    tightened,
    `export interface ToolCallAborted {
  /**
   * Tool-call abort event discriminator.
   */
  type?: "tool_call_aborted";
  /**
   * Tool-call abort event payload.
   */
  payload?:
    | {
        /**
         * Abort granularity. tool_call aborts reference a specific tool_call by for_id; turn aborts describe a broader turn-level stop when the source cannot identify one call.
         */
        scope: "tool_call";
        /**
         * Globally-unique identifier shape: canonical uppercase ULID (26 Crockford base32 chars), lowercase hyphenated UUID (36 chars), or lowercase unhyphenated UUID (32 hex chars). Header ids, event ids, and envelope ids share this shape so cross-segment reconciliation can dedup by exact string equality (spec §9.5).
         */
        for_id: string;
        /**
         * Why execution stopped before a normal tool_result.
         */
        reason:
          | ("user_interrupt" | "hook_blocked" | "timeout" | "permission_denied" | "runtime_error")
          | string;
        /**
         * Source component or policy that blocked the tool call.
         */
        blocked_by?: string;
      }
    | {
        /**
         * Abort granularity. tool_call aborts reference a specific tool_call by for_id; turn aborts describe a broader turn-level stop when the source cannot identify one call.
         */
        scope: "turn" | string;
        /**
         * Why execution stopped before a normal tool_result.
         */
        reason:
          | ("user_interrupt" | "hook_blocked" | "timeout" | "permission_denied" | "runtime_error")
          | string;
        /**
         * Source component or policy that blocked the tool call.
         */
        blocked_by?: string;
      };
  [k: string]: unknown | undefined;
}`,
    `export interface ToolCallAborted {
  type?: "tool_call_aborted";
  payload?: ToolCallAbortedPayload;
  [k: string]: unknown | undefined;
}
export type ToolCallAbortedReason =
  | "user_interrupt"
  | "hook_blocked"
  | "timeout"
  | "permission_denied"
  | "runtime_error"
  | \`x-\${string}/\${string}\`;
export type ToolCallAbortedPayload = {
  /**
   * Why execution stopped before a normal tool_result.
   */
  reason: ToolCallAbortedReason;
  blocked_by?: string;
} & (
  | {
      /**
       * Abort granularity. tool_call aborts reference a specific tool_call by for_id; turn aborts describe a broader turn-level stop when the source cannot identify one call.
       */
      scope: "tool_call";
      /**
       * Globally-unique identifier shape: canonical uppercase ULID (26 Crockford base32 chars), lowercase hyphenated UUID (36 chars), or lowercase unhyphenated UUID (32 hex chars). Header ids, event ids, and envelope ids share this shape so cross-segment reconciliation can dedup by exact string equality (spec §9.5).
       */
      for_id: string;
    }
  | {
      /**
       * Abort granularity. tool_call aborts reference a specific tool_call by for_id; turn aborts describe a broader turn-level stop when the source cannot identify one call.
       */
      scope: "turn" | \`x-\${string}/\${string}\`;
      for_id?: never;
    }
);
`,
    "ToolCallAborted.payload",
  );
  return tightened;
}

function replaceRequired(
  text: string,
  searchValue: string,
  replaceValue: string,
  label: string,
): string {
  if (!text.includes(searchValue)) {
    throw new Error(`generated type tightening target not found: ${label}`);
  }
  return text.replace(searchValue, replaceValue);
}

if (import.meta.main) {
  await generateTypes();
}
