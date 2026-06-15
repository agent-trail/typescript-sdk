import { expect, test } from "bun:test";

test("@agent-trail/adapters root is factory-first and import-safe", async () => {
  const adapters = await import("../index.js");

  expect(typeof adapters.createClaudeCodeAdapter).toBe("function");
  expect(typeof adapters.createCodexAdapter).toBe("function");
  expect(typeof adapters.createPiAdapter).toBe("function");
  expect(typeof adapters.createOpenCodeAdapter).toBe("function");
  expect(typeof adapters.createDefaultTrailAdapters).toBe("function");
  expect("buildTrailEnvelope" in adapters).toBe(false);
  expect("createAdapterByName" in adapters).toBe(false);
  expect("DEFAULT_ADAPTER_NAMES" in adapters).toBe(false);
  expect("DISCOVERY_CONCURRENCY_LIMIT" in adapters).toBe(false);
  expect("mapConcurrent" in adapters).toBe(false);
  expect("trailRecords" in adapters).toBe(false);
  expect("validateAdapterTrail" in adapters).toBe(false);
  expect("claudeCodeAdapter" in adapters).toBe(false);
  expect("codexAdapter" in adapters).toBe(false);
  expect("piAdapter" in adapters).toBe(false);
  expect("opencodeAdapter" in adapters).toBe(false);
});
