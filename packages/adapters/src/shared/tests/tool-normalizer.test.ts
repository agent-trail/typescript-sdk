import { expect, test } from "bun:test";
import { normalizeToolCall } from "../tool-normalizer.js";

test("normalizeToolCall handles shell commands", () => {
  expect(normalizeToolCall({ name: "bash", args: { command: "git status" } })).toEqual({
    tool: "shell_command",
    args: { command: "git status" },
  });
  expect(normalizeToolCall({ name: "shell", args: { cmd: "pwd" } })).toEqual({
    tool: "shell_command",
    args: { command: "pwd" },
  });
});

test("normalizeToolCall handles file reads, writes, edits, and patches", () => {
  expect(normalizeToolCall({ name: "read", args: { path: "a.ts" } })).toEqual({
    tool: "file_read",
    args: { path: "a.ts" },
  });
  expect(normalizeToolCall({ name: "write", args: { file_path: "a.ts", content: "x" } })).toEqual({
    tool: "file_write",
    args: { path: "a.ts", content: "x" },
  });
  expect(
    normalizeToolCall({ name: "edit", args: { path: "a.ts", old_string: "a", new_string: "b" } }),
  ).toEqual({
    tool: "file_edit",
    args: { path: "a.ts", old: "a", new: "b" },
  });
  expect(
    normalizeToolCall({
      name: "file_patch",
      args: { files: [{ path: "a.ts", diff: "--- a" }], atomic: true },
    }),
  ).toEqual({
    tool: "file_patch",
    args: { files: [{ path: "a.ts", diff: "--- a" }], atomic: true },
  });
  expect(normalizeToolCall({ name: "apply_patch", args: { patch: "--- a" } })).toEqual({
    tool: "other",
    args: { name: "apply_patch", args: { patch: "--- a" } },
  });
});

test("normalizeToolCall handles search, todo, permission, and custom families", () => {
  expect(normalizeToolCall({ name: "grep", args: { pattern: "needle", path: "src" } })).toEqual({
    tool: "file_search",
    args: { query: "needle", path: "src" },
  });
  expect(normalizeToolCall({ name: "todo_write", args: { todos: [{ content: "ship" }] } })).toEqual(
    {
      tool: "other",
      args: { name: "todo_write", args: { todos: [{ content: "ship" }] } },
    },
  );
  expect(normalizeToolCall({ name: "permission_prompt", args: { tool: "bash" } })).toEqual({
    tool: "other",
    args: { name: "permission_prompt", args: { tool: "bash" } },
  });
  expect(normalizeToolCall({ name: "mcp__linear__create_issue", args: { title: "x" } })).toEqual({
    tool: "mcp_call",
    args: { server: "linear", tool: "create_issue", args: { title: "x" } },
  });
  expect(normalizeToolCall({ name: "mcp__computer_use__click", args: { x: 1 } })).toEqual({
    tool: "mcp_call",
    args: { server: "computer_use", tool: "click", args: { x: 1 } },
  });
  expect(normalizeToolCall({ name: "vendor_magic", args: { value: 1 } })).toEqual({
    tool: "other",
    args: { name: "vendor_magic", args: { value: 1 } },
  });
});
