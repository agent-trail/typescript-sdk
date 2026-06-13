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
    `export interface ToolCall {
  /**
   * Tool call event discriminator.
   */
  type?: "tool_call";
  /**
   * Tool call event payload.
   */
  payload?: {
    [k: string]: unknown | undefined;
  };
  [k: string]: unknown | undefined;
}`,
    `export interface ToolCall {
  type?: "tool_call";
  payload?: ToolCallPayload;
  [k: string]: unknown | undefined;
}
export type ToolCallPayload = ToolCallPayloadByTool & ToolCallPayloadCommon & ToolCallTruncation;
export type ToolCallPayloadCommon = {
  usage?: AgentMessageUsage;
  overflow_ref?: string | null;
};
export type ToolCallTruncation =
  | {
      truncated: true;
      /**
       * UTF-8 byte length of the original args object before truncation. Required when truncated is true.
       */
      args_size: number;
    }
  | {
      truncated?: false;
      /**
       * UTF-8 byte length of the original args object before truncation. Required when truncated is true.
       */
      args_size?: number;
    };
export type ToolCallPayloadByTool =
  | {
      tool: "file_read";
      args: {
        path: string;
        range?: [number, number];
      };
    }
  | {
      tool: "file_write";
      args: {
        path: string;
        content: string;
      };
    }
  | {
      tool: "file_edit";
      args:
        | {
            path: string;
            diff: string;
          }
        | {
            path: string;
            old: string;
            new: string;
            replace_all?: boolean;
          };
    }
  | {
      tool: "file_patch";
      args: {
        files: [
          {
            path: string;
            diff: string;
          },
          ...{
            path: string;
            diff: string;
          }[],
        ];
        atomic?: boolean;
      };
    }
  | {
      tool: "file_list";
      args: {
        path: string;
        recursive?: boolean;
        glob?: string;
      };
    }
  | {
      tool: "file_search";
      args: {
        query: string;
        path?: string;
        glob?: string;
      };
    }
  | {
      tool: "shell_command";
      args: {
        command: string;
        cwd?: string;
        timeout?: number;
      };
    }
  | {
      tool: "shell_output";
      args: {
        command_id?: string;
      };
    }
  | {
      tool: "shell_input";
      args: {
        input: string;
        session_id?: string;
        command_id?: string;
      };
    }
  | {
      tool: "mcp_call";
      args: {
        server: string;
        tool: string;
        args?: {
          [k: string]: unknown | undefined;
        };
        headers?: {
          [k: string]: unknown | undefined;
        };
      };
    }
  | {
      tool: "web_fetch";
      args: {
        url: string;
        method?: string;
        headers?: {
          [k: string]: unknown | undefined;
        };
      };
    }
  | {
      tool: "web_search";
      args: {
        query: string;
      };
    }
  | {
      tool: "tool_search";
      args: {
        query: string;
        limit?: number;
      };
    }
  | {
      tool: "notebook_edit";
      args: {
        path: string;
        cell_id?: string;
        diff?: string;
        content?: string;
      };
    }
  | {
      tool: "subagent_invoke";
      args: {
        task: string;
        agent_type?: string;
        session_id?: string;
      };
    }
  | {
      tool: "other";
      args: {
        name: string;
        args?: {
          [k: string]: unknown | undefined;
        };
      };
    };
`,
    "ToolCall.payload",
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
  payload?: {
    [k: string]: unknown | undefined;
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
  tightened = replaceRequired(
    tightened,
    `export interface CapabilityChange {
  /**
   * Capability change event discriminator.
   */
  type?: "capability_change";
  /**
   * Capability change event payload.
   */
  payload?: {
    /**
     * Capability domain changed by this event.
     */
    scope: (
      | ("tool" | "skill" | "mcp_server" | "mcp_tool" | "plugin")
      | {
          [k: string]: unknown | undefined;
        }
    ) &
      string;
    /**
     * Reason the capability set changed.
     */
    reason: (
      | (
          | "initial"
          | "registered"
          | "deregistered"
          | "connected"
          | "disconnected"
          | "loaded"
          | "unloaded"
          | "error"
          | "instructions_updated"
        )
      | {
          [k: string]: unknown | undefined;
        }
    ) &
      string;
    /**
     * Capabilities added by this change.
     *
     * @minItems 1
     */
    added?: [CapabilityAddedItem, ...CapabilityAddedItem[]];
    /**
     * Capabilities removed by this change.
     *
     * @minItems 1
     */
    removed?: [CapabilityRemovedItem, ...CapabilityRemovedItem[]];
    /**
     * Capabilities modified by this change.
     *
     * @minItems 1
     */
    changed?: [CapabilityChangedItem, ...CapabilityChangedItem[]];
    /**
     * Full capability snapshot after this change.
     *
     * @minItems 1
     */
    snapshot?: [CapabilityAddedItem, ...CapabilityAddedItem[]];
  } & {
    [k: string]: unknown | undefined;
  };
  [k: string]: unknown | undefined;
}`,
    `export interface CapabilityChange {
  type?: "capability_change";
  payload?: {
    scope: (
      | ("tool" | "skill" | "mcp_server" | "mcp_tool" | "plugin")
      | {
          [k: string]: unknown | undefined;
        }
    ) &
      string;
    reason: (
      | (
          | "initial"
          | "registered"
          | "deregistered"
          | "connected"
          | "disconnected"
          | "loaded"
          | "unloaded"
          | "error"
          | "instructions_updated"
        )
      | {
          [k: string]: unknown | undefined;
        }
    ) &
      string;
    /**
     * @minItems 1
     */
    added?: [CapabilityAddedItem, ...CapabilityAddedItem[]];
    /**
     * @minItems 1
     */
    removed?: [CapabilityRemovedItem, ...CapabilityRemovedItem[]];
    /**
     * @minItems 1
     */
    changed?: [CapabilityChangedItem, ...CapabilityChangedItem[]];
    /**
     * @minItems 1
     */
    snapshot?: [CapabilityAddedItem, ...CapabilityAddedItem[]];
  } & (
    | {
        added: [CapabilityAddedItem, ...CapabilityAddedItem[]];
      }
    | {
        removed: [CapabilityRemovedItem, ...CapabilityRemovedItem[]];
      }
    | {
        changed: [CapabilityChangedItem, ...CapabilityChangedItem[]];
      }
    | {
        snapshot: [CapabilityAddedItem, ...CapabilityAddedItem[]];
      }
  );
  [k: string]: unknown | undefined;
}
`,
    "CapabilityChange.payload",
  );
  tightened = replaceRequired(
    tightened,
    `  /**
   * Previous capability field value.
   */
  from?: {
    [k: string]: unknown | undefined;
  };`,
    `  /**
   * Previous capability field value.
   */
  from?: unknown;`,
    "CapabilityChangedItem.from",
  );
  tightened = replaceRequired(
    tightened,
    `  /**
   * New capability field value.
   */
  to?: {
    [k: string]: unknown | undefined;
  };`,
    `  /**
   * New capability field value.
   */
  to?: unknown;`,
    "CapabilityChangedItem.to",
  );
  tightened = replaceRequired(
    tightened,
    `        /**
         * New session metadata value.
         */
        value: {
          [k: string]: unknown | undefined;
        };
        /**
         * Previous session metadata value when known.
         */
        previous_value?: {
          [k: string]: unknown | undefined;
        };`,
    `        /**
         * New session metadata value.
         */
        value: unknown;
        /**
         * Previous session metadata value when known.
         */
        previous_value?: unknown;`,
    "SessionMetadataUpdate.extensionValue",
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
