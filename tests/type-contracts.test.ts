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
  payload: { tool: "file_read", args: {} },
};

const validToolCallAborted: TrailEntry = {
  ...base,
  type: "tool_call_aborted",
  payload: { scope: "turn", reason: "user_interrupt" },
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

// @ts-expect-error tool_call payload requires tool and args.
const invalidToolCall: TrailEntry = { ...base, type: "tool_call", payload: {} };

// @ts-expect-error tool_call_aborted payload requires scope and reason.
const invalidToolCallAborted: TrailEntry = {
  ...base,
  type: "tool_call_aborted",
  payload: {},
};

// @ts-expect-error capability_change payload requires at least one delta array.
const invalidCapabilityChange: TrailEntry = {
  ...base,
  type: "capability_change",
  payload: { scope: "tool", reason: "registered" },
};

void [
  validToolCall,
  validToolCallAborted,
  validCapabilityChange,
  invalidToolCall,
  invalidToolCallAborted,
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
