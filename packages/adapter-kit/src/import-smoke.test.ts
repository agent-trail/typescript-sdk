import { expect, test } from "bun:test";

test("@agent-trail/adapter-kit root omits Bun SQLite convenience export", async () => {
  const kit = await import("./index.js");

  expect(typeof kit.JsonlReader).toBe("function");
  expect(typeof kit.validateSourceRecord).toBe("function");
  expect("bunSqliteDriver" in kit).toBe(false);
});

test("@agent-trail/adapter-kit/bun-sqlite convenience module exports Bun driver", async () => {
  const sqlite = await import("./readers/bun-sqlite-driver.js");

  expect(typeof sqlite.bunSqliteDriver.open).toBe("function");
});
