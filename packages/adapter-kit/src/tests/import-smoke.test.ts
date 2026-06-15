import { expect, test } from "bun:test";

test("@agent-trail/adapter-kit root omits Bun SQLite convenience export", async () => {
  const kit = await import("../index.js");

  expect(typeof kit.JsonlReader).toBe("function");
  expect(typeof kit.validateSourceRecord).toBe("function");
  expect("bunSqliteDriver" in kit).toBe(false);
});

test("@agent-trail/adapter-kit root omits implementation helpers", async () => {
  const kit = await import("../index.js");

  expect("dispatch" in kit).toBe(false);
  expect("runPass1" in kit).toBe(false);
  expect("quarantine" in kit).toBe(false);
  expect("quarantineDraft" in kit).toBe(false);
  expect("reconcile" in kit).toBe(false);
  expect("coerceInt" in kit).toBe(false);
  expect("isObject" in kit).toBe(false);
  expect("quoteShellArg" in kit).toBe(false);
  expect("deriveSessionUid" in kit).toBe(false);
  expect("deriveSynthesizedEntryId" in kit).toBe(false);
});

test("@agent-trail/adapter-kit/bun-sqlite convenience module exports Bun driver", async () => {
  const sqlite = await import("../readers/bun-sqlite-driver.js");

  expect(typeof sqlite.bunSqliteDriver.open).toBe("function");
});
