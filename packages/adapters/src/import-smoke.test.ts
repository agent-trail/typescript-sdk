import { expect, test } from "bun:test";

test("@agent-trail/adapters root is factory-first and import-safe", async () => {
  const adapters = await import("./index.js");

  expect(typeof adapters.createClaudeCodeAdapter).toBe("function");
  expect(typeof adapters.createCodexAdapter).toBe("function");
  expect(typeof adapters.createPiAdapter).toBe("function");
  expect(typeof adapters.createOpenCodeAdapter).toBe("function");
  expect(typeof adapters.createDefaultTrailAdapters).toBe("function");
  expect("claudeCodeAdapter" in adapters).toBe(false);
  expect("codexAdapter" in adapters).toBe(false);
  expect("piAdapter" in adapters).toBe(false);
  expect("opencodeAdapter" in adapters).toBe(false);
});
