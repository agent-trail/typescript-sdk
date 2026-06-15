import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  inspectLocalJsonlSourceHealth,
  newestLocalJsonlSourceVersion,
  scanLocalJsonlProjectDir,
  scanLocalJsonlProjectsRoot,
} from "./local-jsonl.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "adapter-local-jsonl-"));
});

afterEach(() => {
  if (existsSync(root)) {
    chmodSync(root, 0o700);
    rmSync(root, { recursive: true, force: true });
  }
});

function project(name: string): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function session(dir: string, name: string, records: readonly object[]): string {
  const file = join(dir, name);
  writeFileSync(file, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
  return file;
}

const options = {
  adapter: "test-agent",
  idFromPath: (path: string) => basename(path, ".jsonl"),
  cwdFromRecord: (record: Record<string, unknown>) =>
    typeof record.cwd === "string" ? record.cwd : undefined,
  versionFromRecord: (record: Record<string, unknown>) =>
    typeof record.version === "string" ? record.version : undefined,
};

describe("scanLocalJsonlProjectDir", () => {
  test("skips symlinks and non-jsonl files, preserves cwd and modified time", async () => {
    const dir = project("repo");
    const file = session(dir, "a.jsonl", [{ version: "1.0.0" }, { cwd: "/work/repo" }]);
    writeFileSync(join(dir, "notes.txt"), "{}\n");
    symlinkSync(file, join(dir, "linked.jsonl"));
    const modified = new Date("2026-01-02T03:04:05.000Z");
    utimesSync(file, modified, modified);

    await expect(scanLocalJsonlProjectDir(dir, options)).resolves.toEqual([
      {
        id: "a",
        adapter: "test-agent",
        path: file,
        cwd: "/work/repo",
        modifiedAt: modified.toISOString(),
      },
    ]);
  });
});

describe("scanLocalJsonlProjectsRoot", () => {
  test("allCwds scans every project bucket", async () => {
    const one = project("one");
    const two = project("two");
    session(one, "a.jsonl", [{ cwd: "/one" }]);
    session(two, "b.jsonl", [{ cwd: "/two" }]);

    const refs = await scanLocalJsonlProjectsRoot(root, {
      ...options,
      allCwds: true,
      projectDirForCwd: (cwd) => join(root, cwd.replaceAll("/", "-")),
      cwd: "/one",
    });

    expect(refs.map((ref) => ref.id).sort()).toEqual(["a", "b"]);
  });
});

describe("newestLocalJsonlSourceVersion", () => {
  test("selects the source version from the newest scanned JSONL file", async () => {
    const dir = project("repo");
    const older = session(dir, "old.jsonl", [{ version: "old" }]);
    const newer = session(dir, "new.jsonl", [{ version: "new" }]);
    const oldDate = new Date("2026-01-01T00:00:00.000Z");
    const newDate = new Date("2026-01-02T00:00:00.000Z");
    utimesSync(older, oldDate, oldDate);
    utimesSync(newer, newDate, newDate);

    await expect(newestLocalJsonlSourceVersion(dir, options)).resolves.toBe("new");
  });
});

describe("inspectLocalJsonlSourceHealth", () => {
  test("reports missing roots visibly", async () => {
    await expect(
      inspectLocalJsonlSourceHealth({
        adapter: "test-agent",
        root: join(root, "missing"),
        scan: () => Promise.resolve([]),
        sourceVersion: () => Promise.resolve(null),
      }),
    ).resolves.toMatchObject({
      adapter: "test-agent",
      present: false,
      readable: false,
      sessionCount: 0,
      sourceVersion: null,
      warnings: ["source path not found"],
    });
  });

  test("reports unreadable roots visibly", async () => {
    chmodSync(root, 0o000);
    const health = await inspectLocalJsonlSourceHealth({
      adapter: "test-agent",
      root,
      scan: () => Promise.resolve([]),
      sourceVersion: () => Promise.resolve(null),
    });

    expect(health.present).toBe(true);
    expect(health.readable).toBe(false);
    expect(health.warnings[0]).toStartWith("source path unreadable:");
  });
});
