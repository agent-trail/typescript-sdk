// @ts-nocheck
// biome-ignore-all lint/style/noNonNullAssertion: ported oracle fixture tests assert fixed fixture shape.
import { Database } from "bun:sqlite";
import { expect } from "bun:test";
import { statSync } from "node:fs";
import { join } from "node:path";
import type { Entry } from "@agent-trail/types";
import { bunSqliteDriver } from "../../../adapter-kit/src/readers/bun-sqlite-driver.js";
import { createOpenCodeAdapter } from "../index.js";
import {
  assertEmbeddedSourceUsageCaptured,
  firstJsonFile,
  ID_PATTERN,
  runRealSessionSmoke,
} from "../test-helpers.js";
import { opencodeDbPath, opencodeStorageDir } from "./paths.js";
import { loadFileSession } from "./storage/index.js";

const opencodeAdapter = createOpenCodeAdapter({ sqliteDriver: bunSqliteDriver });

const HEX_SHA256 = /^[0-9a-f]{64}$/;
const OPENCODE_SOURCE_SCHEMA_VERSION = "v1";

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function assertOptionalString(value: unknown, label: string, summary: string): void {
  if (value !== undefined && stringValue(value) === undefined) {
    throw new Error(`${label} must be a non-empty string when present\n${summary}`);
  }
}

async function assertOpenCodeMessageTotalsCaptured(
  trail: Parameters<NonNullable<Parameters<typeof runRealSessionSmoke>[0]["assertTrail"]>>[0],
  summary: string,
  ref: { path?: string },
): Promise<void> {
  if (ref.path === undefined || ref.path.includes("#")) return;
  const totalsByMessageId = await messageTotalsById(ref.path);
  if (totalsByMessageId.size === 0) return;
  const checked = assertEmittedUsageTotals(trail, totalsByMessageId);
  if (checked === 0) {
    throw new Error(
      `real OpenCode session had message totals but no emitted merged usage\n${summary}`,
    );
  }
}

async function messageTotalsById(path: string): Promise<Map<string, number>> {
  const loaded = await loadFileSession(path);
  const totals = new Map<string, number>();
  for (const message of loaded.messages) {
    const total = numberValue(objectValue(message.tokens)?.total);
    if (total !== undefined) totals.set(message.id, total);
  }
  return totals;
}

function assertEmittedUsageTotals(
  trail: Parameters<NonNullable<Parameters<typeof runRealSessionSmoke>[0]["assertTrail"]>>[0],
  totalsByMessageId: Map<string, number>,
): number {
  let checked = 0;
  for (const group of trail.groups) {
    for (const entry of group.entries) {
      checked += assertUsageTotal(entry, totalsByMessageId);
    }
  }
  return checked;
}

function assertUsageTotal(entry: Entry, totalsByMessageId: Map<string, number>): number {
  const usage = usagePayload(entry);
  if (usage === undefined) return 0;
  const messageId = sourceMessageId(entry);
  const expectedTotal = messageId === undefined ? undefined : totalsByMessageId.get(messageId);
  if (expectedTotal === undefined) return 0;
  expect(usage.total_tokens).toBe(expectedTotal);
  return 1;
}

function usagePayload(entry: Entry): Record<string, unknown> | undefined {
  return objectValue(objectValue(entry.payload)?.usage);
}

function sourceMessageId(entry: Entry): string | undefined {
  const data = objectValue(objectValue(entry.source?.raw)?.data);
  return stringValue(data?.messageID) ?? stringValue(data?.message_id);
}

function firstOpenCodeSessionJson(root: string | undefined): string | undefined {
  return firstJsonFile(root, (path) => /^ses_.*\.json$/.test(path.split(/[\\/]/).at(-1) ?? ""));
}

function opencodeDbFile(path: string | undefined): string | undefined {
  if (path === undefined || path.length === 0) return undefined;
  if (path.includes("#")) return path;
  try {
    const stat = statSync(path);
    if (stat.isDirectory()) return join(path, "opencode.db");
    if (stat.isFile()) return path;
  } catch {
    return undefined;
  }
  return undefined;
}

function firstOpenCodeDbSession(path: string | undefined): string | undefined {
  const dbPath = opencodeDbFile(path);
  if (dbPath === undefined) return undefined;
  if (dbPath.includes("#")) return dbPath;
  let db: Database | undefined;
  try {
    db = new Database(dbPath, { readonly: true });
    const row = db.query("SELECT id FROM session ORDER BY time_updated DESC, id ASC LIMIT 1").get();
    const id =
      row !== null &&
      typeof row === "object" &&
      !Array.isArray(row) &&
      typeof (row as Record<string, unknown>).id === "string"
        ? (row as Record<string, string>).id
        : undefined;
    return id === undefined ? undefined : `${dbPath}#${id}`;
  } catch {
    return undefined;
  } finally {
    db?.close();
  }
}

function assertOpenCodeEntry(entry: Entry, toolCallIds: Set<string>, summary: string): void {
  try {
    const payload = assertEntryBase(entry, summary);
    const assertPayload = ENTRY_ASSERTIONS[entry.type];
    assertPayload?.(entry, payload, toolCallIds, summary);
  } catch (error) {
    throw new Error(
      `OpenCode real-session optional-field invariant failed for ${entry.type}: ${
        error instanceof Error ? error.message : String(error)
      }\n${summary}`,
    );
  }
}

function assertEntryBase(entry: Entry, summary: string): Record<string, unknown> {
  const source = objectValue(entry.source);
  expect(source?.agent).toBe("opencode");
  if (source?.synthesized !== true) assertOpenCodeSource(entry, source);
  const payload = objectValue(entry.payload);
  expect(payload).toBeDefined();
  if (entry.semantic !== undefined) {
    assertOptionalString(entry.semantic.call_id, "semantic.call_id", summary);
    assertOptionalString(entry.semantic.tool_kind, "semantic.tool_kind", summary);
  }
  return payload ?? {};
}

function assertOpenCodeSource(entry: Entry, source: Record<string, unknown> | undefined): void {
  expect(entry.meta?.["dev.opencode.raw_type"]).toEqual(expect.any(String));
  expect(String(entry.meta?.["dev.opencode.raw_type"]).length).toBeGreaterThan(0);
  expect(source?.schema_version).toBe(OPENCODE_SOURCE_SCHEMA_VERSION);
  if (source?.raw !== undefined) expect(objectValue(source.raw)).toBeDefined();
}

const ENTRY_ASSERTIONS: Record<
  string,
  (
    entry: Entry,
    payload: Record<string, unknown>,
    toolCallIds: Set<string>,
    summary: string,
  ) => void
> = {
  user_message: assertTextEntry,
  agent_message: assertTextEntry,
  agent_thinking: assertTextEntry,
  tool_call: assertToolCallEntry,
  tool_result: assertToolResultEntry,
  tool_call_aborted: assertToolAbortedEntry,
  context_compact: assertContextCompactEntry,
  model_change: assertModelChangeEntry,
  task_plan_update: assertTaskPlanEntry,
  session_terminated: assertSessionTerminatedEntry,
  system_event: assertSystemEventEntry,
};

function assertTextEntry(
  entry: Entry,
  payload: Record<string, unknown>,
  _toolCallIds: Set<string>,
  summary: string,
): void {
  expect(payload.text).toEqual(expect.any(String));
  assertOptionalString(payload.model, `${entry.type}.payload.model`, summary);
}

function assertToolCallEntry(
  entry: Entry,
  payload: Record<string, unknown>,
  toolCallIds: Set<string>,
  summary: string,
): void {
  expect(payload.tool).toEqual(expect.any(String));
  const args = objectValue(payload.args);
  expect(args).toBeDefined();
  toolCallIds.add(entry.id);
  TOOL_ARG_ASSERTIONS[String(payload.tool)]?.(args ?? {}, summary);
}

const TOOL_ARG_ASSERTIONS: Record<
  string,
  (args: Record<string, unknown>, summary: string) => void
> = {
  file_read: (args, summary) => assertOptionalString(args.path, "file_read.args.path", summary),
  file_write: assertFileWriteArgs,
  file_edit: assertFileEditArgs,
  shell_command: (args, summary) =>
    assertOptionalString(args.command, "shell_command.args.command", summary),
  web_fetch: (args, summary) => assertOptionalString(args.url, "web_fetch.args.url", summary),
  subagent_invoke: (args, summary) =>
    assertOptionalString(args.task, "subagent_invoke.args.task", summary),
  other: (args, summary) => assertOptionalString(args.name, "other.args.name", summary),
};

function assertFileWriteArgs(args: Record<string, unknown>, summary: string): void {
  assertOptionalString(args.path, "file_write.args.path", summary);
  assertOptionalString(args.content, "file_write.args.content", summary);
}

function assertFileEditArgs(args: Record<string, unknown>, summary: string): void {
  assertOptionalString(args.path, "file_edit.args.path", summary);
  assertOptionalString(args.diff, "file_edit.args.diff", summary);
}

function assertToolResultEntry(
  _entry: Entry,
  payload: Record<string, unknown>,
  toolCallIds: Set<string>,
  summary: string,
): void {
  expect(payload.for_id).toMatch(ID_PATTERN);
  expect(toolCallIds.has(String(payload.for_id))).toBe(true);
  expect(typeof payload.ok).toBe("boolean");
  assertOptionalString(payload.output, "tool_result.payload.output", summary);
  assertOptionalString(payload.error, "tool_result.payload.error", summary);
}

function assertToolAbortedEntry(
  _entry: Entry,
  payload: Record<string, unknown>,
  toolCallIds: Set<string>,
  summary: string,
): void {
  if (payload.scope === "tool_call") {
    expect(payload.for_id).toMatch(ID_PATTERN);
    expect(toolCallIds.has(String(payload.for_id))).toBe(true);
  }
  assertOptionalString(payload.reason, "tool_call_aborted.payload.reason", summary);
}

function assertContextCompactEntry(_entry: Entry, payload: Record<string, unknown>): void {
  expect(payload.summary).toEqual(expect.any(String));
  if (payload.trigger !== undefined) {
    expect(["auto", "manual"].includes(String(payload.trigger))).toBe(true);
  }
}

function assertModelChangeEntry(
  _entry: Entry,
  payload: Record<string, unknown>,
  _toolCallIds: Set<string>,
  summary: string,
): void {
  expect(payload.to_model).toEqual(expect.any(String));
  assertOptionalString(payload.from_model, "model_change.payload.from_model", summary);
  assertOptionalString(payload.to_provider, "model_change.payload.to_provider", summary);
}

function assertTaskPlanEntry(_entry: Entry, payload: Record<string, unknown>): void {
  expect(Array.isArray(payload.items)).toBe(true);
  for (const item of (payload.items ?? []) as unknown[]) assertTaskPlanItem(item);
}

function assertTaskPlanItem(item: unknown): void {
  const obj = objectValue(item);
  expect(obj?.id).toEqual(expect.any(String));
  expect(obj?.content).toEqual(expect.any(String));
  expect(
    ["pending", "in_progress", "completed", "cancelled", "blocked"].includes(String(obj?.status)),
  ).toBe(true);
}

function assertSessionTerminatedEntry(_entry: Entry, payload: Record<string, unknown>): void {
  expect(payload.reason).toEqual(expect.any(String));
  if (Array.isArray(payload.open_call_ids)) {
    for (const id of payload.open_call_ids) expect(String(id)).toMatch(ID_PATTERN);
  }
}

function assertSystemEventEntry(_entry: Entry, payload: Record<string, unknown>): void {
  expect(payload.kind).toEqual(expect.any(String));
  if (payload.kind === "x-opencode/unknown_record") {
    expect(objectValue(objectValue(payload.data)?.raw)).toBeDefined();
  }
}

// Opt-in real-session test. Hard-skipped in CI and skipped locally unless
// AGENT_TRAIL_REAL_OPENCODE_ROOT points to a real OpenCode root/session file, or
// a session exists under OpenCode's default storage dir.
//
//   AGENT_TRAIL_REAL_OPENCODE_ROOT=/abs/path/to/opencode bun test packages/adapters
runRealSessionSmoke({
  adapter: opencodeAdapter,
  envVar: "AGENT_TRAIL_REAL_OPENCODE_ROOT",
  expectedAgentName: "opencode",
  fallbackSessionId: "real-opencode-session",
  resolveSessionPath: (path) => firstOpenCodeSessionJson(path),
  defaultSessionPath: () => firstOpenCodeSessionJson(opencodeStorageDir()),
  testName:
    "real OpenCode session (AGENT_TRAIL_REAL_OPENCODE_ROOT) parses, validates, and exposes feature coverage",
  assertTrail: async (trail, summary, ref) => {
    expect(trail.envelope?.content_hash).toMatch(HEX_SHA256);
    const group = trail.groups[0]!;
    expect(group.header.content_hash).toMatch(HEX_SHA256);
    expect(group.header.source?.agent).toBe("opencode");
    assertOptionalString(group.header.agent.version, "header.agent.version", summary);
    assertOptionalString(
      group.header.source?.format_version,
      "header.source.format_version",
      summary,
    );
    const toolCallIds = new Set<string>();
    for (const entry of group.entries) assertOpenCodeEntry(entry, toolCallIds, summary);
    assertEmbeddedSourceUsageCaptured(trail, summary);
    await assertOpenCodeMessageTotalsCaptured(trail, summary, ref);
  },
});

// Opt-in DB real-session test. Hard-skipped in CI and skipped locally unless
// AGENT_TRAIL_REAL_OPENCODE_DB_SESSION points to a real OpenCode DB, DB#session
// ref, or OpenCode data root. Falls back to the default OpenCode DB.
//
//   AGENT_TRAIL_REAL_OPENCODE_DB_SESSION=/abs/path/to/opencode.db#ses_... bun test packages/adapters
runRealSessionSmoke({
  adapter: opencodeAdapter,
  envVar: "AGENT_TRAIL_REAL_OPENCODE_DB_SESSION",
  expectedAgentName: "opencode",
  fallbackSessionId: "real-opencode-db-session",
  resolveSessionPath: firstOpenCodeDbSession,
  defaultSessionPath: () => firstOpenCodeDbSession(opencodeDbPath()),
  testName:
    "real OpenCode SQLite session (AGENT_TRAIL_REAL_OPENCODE_DB_SESSION) parses, validates, and exposes feature coverage",
  assertTrail: (trail, summary) => {
    expect(trail.envelope?.content_hash).toMatch(HEX_SHA256);
    const group = trail.groups[0]!;
    expect(group.header.content_hash).toMatch(HEX_SHA256);
    expect(group.header.source?.agent).toBe("opencode");
    expect(group.header.source?.path).toContain("opencode.db#");
    assertOptionalString(group.header.agent.version, "header.agent.version", summary);
    assertOptionalString(
      group.header.source?.format_version,
      "header.source.format_version",
      summary,
    );
    const toolCallIds = new Set<string>();
    for (const entry of group.entries) assertOpenCodeEntry(entry, toolCallIds, summary);
    assertEmbeddedSourceUsageCaptured(trail, summary);
  },
});
