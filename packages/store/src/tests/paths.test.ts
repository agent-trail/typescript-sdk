import { expect, test } from "bun:test";
import { join, win32 } from "node:path";
import { objectPath, resolveStoreRoot } from "../index.ts";

test("resolveStoreRoot prefers explicit override", () => {
  withStoreEnv({ AGENT_TRAIL_HOME: "/env/store", HOME: "/home/tester" }, () => {
    expect(resolveStoreRoot("/explicit/store")).toBe("/explicit/store");
  });
  expect(
    resolveStoreRoot({
      storeRoot: "/explicit/store",
      env: { AGENT_TRAIL_HOME: "/env/store", HOME: "/home/tester" },
    }),
  ).toBe("/explicit/store");
});

test("resolveStoreRoot falls back to AGENT_TRAIL_HOME, XDG_DATA_HOME, and HOME", () => {
  withStoreEnv({ AGENT_TRAIL_HOME: "/env/store", HOME: "/home/tester" }, () => {
    expect(resolveStoreRoot()).toBe("/env/store");
  });
  expect(
    resolveStoreRoot({
      env: { AGENT_TRAIL_HOME: "/env/store", HOME: "/home/tester" },
    }),
  ).toBe("/env/store");
  expect(
    resolveStoreRoot({
      env: { AGENT_TRAIL_HOME: "", XDG_DATA_HOME: "/xdg/data", HOME: "/home/tester" },
      platform: "linux",
    }),
  ).toBe(join("/xdg/data", "trail"));
  withStoreEnv({ AGENT_TRAIL_HOME: "", HOME: "/home/tester" }, () => {
    expect(resolveStoreRoot()).toBe(join("/home/tester", ".local/share/trail"));
  });
});

test("resolveStoreRoot uses Windows data locations when platform is win32", () => {
  expect(
    resolveStoreRoot({
      env: { LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local" },
      platform: "win32",
    }),
  ).toBe(win32.join("C:\\Users\\tester\\AppData\\Local", "trail"));
  expect(
    resolveStoreRoot({
      env: { APPDATA: "C:\\Users\\tester\\AppData\\Roaming" },
      platform: "win32",
    }),
  ).toBe(win32.join("C:\\Users\\tester\\AppData\\Roaming", "trail"));
  expect(
    resolveStoreRoot({
      env: { HOMEDRIVE: "C:", HOMEPATH: "\\Users\\tester" },
      platform: "win32",
    }),
  ).toBe(win32.join("C:\\Users\\tester", "AppData", "Local", "trail"));
});

test("resolveStoreRoot requires an explicit root, env root, or home/data directory", () => {
  withStoreEnv({ AGENT_TRAIL_HOME: "", HOME: "" }, () => {
    expect(() => resolveStoreRoot()).toThrow(
      "Cannot resolve store root: pass opts.storeRoot, set AGENT_TRAIL_HOME, or configure a home/data directory.",
    );
  });
});

test("objectPath rejects malformed content hashes", () => {
  expect(() => objectPath("/store", "abc")).toThrow("Invalid trail object content hash");
  expect(() => objectPath("/store", "g".repeat(64))).toThrow("Invalid trail object content hash");
});

function withStoreEnv(
  env: { AGENT_TRAIL_HOME: string | undefined; HOME: string | undefined },
  run: () => void,
): void {
  const previousHome = process.env.HOME;
  const previousAgentTrailHome = process.env.AGENT_TRAIL_HOME;
  try {
    setEnv("HOME", env.HOME);
    setEnv("AGENT_TRAIL_HOME", env.AGENT_TRAIL_HOME);
    run();
  } finally {
    setEnv("HOME", previousHome);
    setEnv("AGENT_TRAIL_HOME", previousAgentTrailHome);
  }
}

function setEnv(key: "AGENT_TRAIL_HOME" | "HOME", value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
