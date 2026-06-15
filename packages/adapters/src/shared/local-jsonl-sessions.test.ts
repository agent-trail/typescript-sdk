import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  inspectLocalJsonlSourceHealth,
  newestLocalJsonlSourceVersion,
  scanLocalJsonlSessionDir,
} from "./local-jsonl-sessions.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "adapter-local-jsonl-"));
});

afterEach(() => {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
});

function writeJsonl(name: string, lines: string[]): string {
  const filePath = join(dir, name);
  writeFileSync(filePath, `${lines.join("\n")}\n`);
  return filePath;
}

describe("scanLocalJsonlSessionDir", () => {
  test("discovers safe JSONL files with mtime and cwd from a head scan", async () => {
    const filePath = writeJsonl("session-a.jsonl", [
      JSON.stringify({ type: "queue" }),
      JSON.stringify({ type: "user", cwd: "/work/project" }),
    ]);
    const mtime = new Date("2026-06-01T12:00:00.000Z");
    utimesSync(filePath, mtime, mtime);
    writeFileSync(join(dir, "ignore.txt"), "{}");
    symlinkSync(filePath, join(dir, "linked.jsonl"));

    await expect(scanLocalJsonlSessionDir({ adapter: "pi", dir })).resolves.toEqual([
      {
        id: "session-a",
        adapter: "pi",
        path: filePath,
        cwd: "/work/project",
        modifiedAt: "2026-06-01T12:00:00.000Z",
      },
    ]);
  });
});

describe("newestLocalJsonlSourceVersion", () => {
  test("reads the newest safe file through the supplied version extractor", async () => {
    const older = writeJsonl("older.jsonl", [JSON.stringify({ version: "old" })]);
    const newer = writeJsonl("newer.jsonl", [JSON.stringify({ version: "new" })]);
    utimesSync(older, new Date("2026-01-01T00:00:00.000Z"), new Date("2026-01-01T00:00:00.000Z"));
    utimesSync(newer, new Date("2026-02-01T00:00:00.000Z"), new Date("2026-02-01T00:00:00.000Z"));

    await expect(
      newestLocalJsonlSourceVersion({
        dir,
        versionFrom: (record) => (typeof record.version === "string" ? record.version : null),
      }),
    ).resolves.toBe("new");
  });
});

describe("inspectLocalJsonlSourceHealth", () => {
  test("reports missing roots without throwing", async () => {
    await expect(
      inspectLocalJsonlSourceHealth({
        adapter: "claude-code",
        root: join(dir, "missing"),
        scanRoot: async () => [],
        sourceVersion: async () => "v1",
      }),
    ).resolves.toEqual({
      adapter: "claude-code",
      path: join(dir, "missing"),
      present: false,
      readable: false,
      sessionCount: 0,
      sourceVersion: null,
      warnings: ["source path not found"],
    });
  });

  test("counts sessions and preserves source version warnings", async () => {
    await mkdir(join(dir, "root"));

    await expect(
      inspectLocalJsonlSourceHealth({
        adapter: "pi",
        root: join(dir, "root"),
        scanRoot: async () => [{ id: "a", adapter: "pi" }],
        sourceVersion: async () => {
          throw new Error("bad version");
        },
      }),
    ).resolves.toEqual({
      adapter: "pi",
      path: join(dir, "root"),
      present: true,
      readable: true,
      sessionCount: 1,
      sourceVersion: null,
      warnings: ["source version check failed: bad version"],
    });
  });
});
