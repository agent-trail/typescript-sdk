import { expect, test } from "bun:test";
import {
  fileReadTool,
  fileSearchTool,
  otherTool,
  patchFiles,
  replacementEditTool,
  shellCommandTool,
  subagentInvokeTool,
} from "./tool-normalizer.js";

test("normalizes shell, read, edit, search, subagent, and unknown tool families", () => {
  expect(
    shellCommandTool({ command: ["bash", "-lc", "echo hello"], cwd: "/repo", timeout: 10 }),
  ).toEqual({
    tool: "shell_command",
    args: { command: "bash -lc 'echo hello'", cwd: "/repo", timeout: 10 },
  });
  expect(fileReadTool({ file_path: "src/index.ts", offset: 2, limit: 3 }, ["file_path"])).toEqual({
    tool: "file_read",
    args: { path: "src/index.ts", range: [2, 5] },
  });
  expect(replacementEditTool({ path: "a.ts", oldText: "old", newText: "new" })).toEqual({
    tool: "file_edit",
    args: { path: "a.ts", old: "old", new: "new" },
  });
  expect(fileSearchTool({ query: "needle", path: "src", glob: "*.ts" })).toEqual({
    tool: "file_search",
    args: { query: "needle", path: "src", glob: "*.ts" },
  });
  expect(subagentInvokeTool({ task: "inspect", agentType: "reviewer" })).toEqual({
    tool: "subagent_invoke",
    args: { task: "inspect", agent_type: "reviewer" },
  });
  expect(otherTool("custom", { value: 1 })).toEqual({
    tool: "other",
    args: { name: "custom", args: { value: 1 } },
  });
});

test("normalizes apply_patch envelopes into canonical file diffs", () => {
  expect(
    patchFiles(`*** Begin Patch
*** Update File: src/a.ts
-old
+new
*** End Patch`),
  ).toEqual([
    {
      path: "src/a.ts",
      diff: "--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,1 +1,1 @@\n-old\n+new",
    },
  ]);
});
