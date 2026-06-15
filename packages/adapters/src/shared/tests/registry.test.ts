// @ts-nocheck
import { expect, test } from "bun:test";
import {
  createAdapterByName,
  createDefaultTrailAdapters,
  DEFAULT_ADAPTER_NAMES,
} from "../registry.js";

test("registry exposes the default adapters in user-visible order", () => {
  expect(DEFAULT_ADAPTER_NAMES).toEqual(["claude-code", "codex", "opencode", "pi"]);
  expect(createDefaultTrailAdapters().map((adapter) => adapter.name)).toEqual(
    DEFAULT_ADAPTER_NAMES,
  );
});

test("createAdapterByName resolves by adapter name", () => {
  expect(createAdapterByName("pi")?.name).toBe("pi");
  expect(createAdapterByName("missing")).toBeUndefined();
});

test("createDefaultTrailAdapters returns fresh adapter instances", () => {
  const adapters = createDefaultTrailAdapters();
  const next = createDefaultTrailAdapters();

  expect(adapters.map((adapter) => adapter.name)).toEqual(DEFAULT_ADAPTER_NAMES);
  expect(next.map((adapter) => adapter.name)).toEqual(DEFAULT_ADAPTER_NAMES);
  expect(adapters[0]).not.toBe(next[0]);
  adapters.pop();
  expect(adapters).toHaveLength(DEFAULT_ADAPTER_NAMES.length - 1);
  expect(next).toHaveLength(DEFAULT_ADAPTER_NAMES.length);
});
