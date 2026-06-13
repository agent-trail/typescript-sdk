import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

test("TrailEntry rejects schema-invalid generated event payloads", () => {
  const root = process.cwd();
  const tempDir = mkdtempSync(path.join(tmpdir(), "agent-trail-type-contracts-"));
  const sourcePath = path.join(tempDir, "contracts.ts");
  writeFileSync(
    sourcePath,
    `import type { TrailEntry } from ${JSON.stringify(
      path.join(root, "packages/types/src/index.ts"),
    )};

const base = {
  id: "00000000-0000-0000-0000-000000000000",
  ts: "2026-06-13T00:00:00.000Z",
} as const;

const validToolCall: TrailEntry = {
  ...base,
  type: "tool_call",
  payload: { tool: "file_read", args: { path: "README.md" } },
};

const validTruncatedToolCall: TrailEntry = {
  ...base,
  type: "tool_call",
  payload: { tool: "other", args: { name: "custom" }, truncated: true, args_size: 12 },
};

const validToolCallAborted: TrailEntry = {
  ...base,
  type: "tool_call_aborted",
  payload: { scope: "turn", reason: "user_interrupt" },
};

const validToolCallScopedAbort: TrailEntry = {
  ...base,
  type: "tool_call_aborted",
  payload: {
    scope: "tool_call",
    for_id: "00000000-0000-0000-0000-000000000000",
    reason: "timeout",
  },
};

const validCapabilityChange: TrailEntry = {
  ...base,
  type: "capability_change",
  payload: {
    scope: "tool",
    reason: "registered",
    added: [{ name: "file_read" }],
  },
};

const validCapabilityChangeWithPrimitiveValues: TrailEntry = {
  ...base,
  type: "capability_change",
  payload: {
    scope: "tool",
    reason: "instructions_updated",
    changed: [{ name: "file_read", field: "enabled", from: false, to: true }],
  },
};

const validSessionMetadataExtension: TrailEntry = {
  ...base,
  type: "session_metadata_update",
  payload: {
    field: "x-acme/reviewers",
    value: ["alice", "bob"],
    previous_value: null,
    reason: "external",
  },
};

const validTaskPlanUpdate: TrailEntry = {
  ...base,
  type: "task_plan_update",
  payload: {
    items: [{ id: "plan-1", content: "Ship ATF-18", status: "completed" }],
  },
};

// @ts-expect-error tool_call payload requires tool and args.
const invalidToolCall: TrailEntry = { ...base, type: "tool_call", payload: {} };

// @ts-expect-error file_read tool_call args require path.
const invalidFileReadToolCall: TrailEntry = { ...base, type: "tool_call", payload: { tool: "file_read", args: {} } };

// @ts-expect-error truncated tool_call requires args_size.
const invalidTruncatedToolCall: TrailEntry = { ...base, type: "tool_call", payload: { tool: "other", args: { name: "custom" }, truncated: true } };

// @ts-expect-error tool_call_aborted payload requires scope and reason.
const invalidToolCallAborted: TrailEntry = {
  ...base,
  type: "tool_call_aborted",
  payload: {},
};

// @ts-expect-error tool_call-scoped abort requires for_id.
const invalidToolCallScopedAbort: TrailEntry = { ...base, type: "tool_call_aborted", payload: { scope: "tool_call", reason: "timeout" } };

// @ts-expect-error turn-scoped abort forbids for_id.
const invalidTurnScopedAbort: TrailEntry = { ...base, type: "tool_call_aborted", payload: { scope: "turn", for_id: "00000000-0000-0000-0000-000000000000", reason: "timeout" } };

// @ts-expect-error schema keyword minItems is not a task_plan_update payload field.
const invalidTaskPlanUpdate: TrailEntry = { ...base, type: "task_plan_update", payload: { items: [{ id: "plan-1", content: "Ship ATF-18", status: "completed" }], minItems: 0 } };

// @ts-expect-error capability_change payload requires at least one delta array.
const invalidCapabilityChange: TrailEntry = {
  ...base,
  type: "capability_change",
  payload: { scope: "tool", reason: "registered" },
};

void [
  validToolCall,
  validTruncatedToolCall,
  validToolCallAborted,
  validToolCallScopedAbort,
  validCapabilityChange,
  validCapabilityChangeWithPrimitiveValues,
  validSessionMetadataExtension,
  validTaskPlanUpdate,
  invalidToolCall,
  invalidFileReadToolCall,
  invalidTruncatedToolCall,
  invalidToolCallAborted,
  invalidToolCallScopedAbort,
  invalidTurnScopedAbort,
  invalidTaskPlanUpdate,
  invalidCapabilityChange,
];
`,
  );

  const result = Bun.spawnSync([
    "bun",
    "run",
    "tsc",
    "--noEmit",
    "--ignoreConfig",
    "--strict",
    "--module",
    "ESNext",
    "--target",
    "ESNext",
    "--moduleResolution",
    "bundler",
    "--allowImportingTsExtensions",
    sourcePath,
  ]);

  expect(result.stderr.toString()).toBe("");
  expect(result.stdout.toString()).toBe("");
  expect(result.success).toBe(true);
});
