import { lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { Entry, Header } from "@agent-trail/types";
import pkg from "../../package.json" with { type: "json" };
import { buildTrailEnvelope } from "../envelope.js";
import { applyHeaderMetadataUpdates } from "../header-metadata.js";
import type {
  AdapterSourceHealth,
  DetectOptions,
  SessionRef,
  TrailAdapter,
  TrailFile,
  TrailSessionGroup,
} from "../index.js";
import { applyParseFidelity } from "../parse-fidelity.js";
import { resumeCommand } from "../resume.js";
import {
  CLAUDE_CODE_SESSION_UID_NAMESPACE,
  canonicalizeIdentityString,
  deriveSessionUid,
} from "../session-uid.js";
import {
  inspectLocalJsonlSourceHealth,
  newestLocalJsonlSourceVersion,
  scanLocalJsonlProjectRoot,
  scanLocalJsonlSessionDir,
} from "../shared/local-jsonl-sessions.js";
import { sanitizeTrailFile } from "../trail-sanitizer.js";
import { parseClaudeCodeSnapshotEntries } from "./kit.js";
import { buildHeader } from "./parser.js";
import { claudeCodeConfigDir, claudeCodeProjectDir, claudeCodeProjectsRoot } from "./paths.js";
import { isObject, parseLines } from "./source.js";

const PRODUCER = `@agent-trail/adapters-claude-code/${pkg.version}`;

async function dirExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function inspectSourceHealth(
  env: NodeJS.ProcessEnv = process.env,
): Promise<AdapterSourceHealth> {
  const configDir = claudeCodeConfigDir(env);
  if (configDir === undefined) {
    return inspectLocalJsonlSourceHealth({
      adapter: "claude-code",
      root: null,
      scanRoot: async () => [],
      sourceVersion: async () => null,
    });
  }

  const root = claudeCodeProjectsRoot(configDir);
  return inspectLocalJsonlSourceHealth({
    adapter: "claude-code",
    root,
    scanRoot: () => scanLocalJsonlProjectRoot({ adapter: "claude-code", root }),
    sourceVersion: () => createClaudeCodeAdapter({ env }).sourceVersion(),
  });
}

type ForkFrom = NonNullable<Header["fork_from"]>;

function textFromContent(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  const text = content
    .filter(isObject)
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("\n");
  return text.length > 0 ? text : undefined;
}

function textFromMessage(record: Record<string, unknown>): string | undefined {
  const message = record.message;
  if (!isObject(message)) return undefined;
  return textFromContent(message.content);
}

function subagentTask(entry: Entry): string | undefined {
  if (entry.type !== "tool_call" || entry.payload.tool !== "subagent_invoke") return undefined;
  const task = (entry.payload.args as { task?: unknown }).task;
  return typeof task === "string" && task.length > 0 ? task : undefined;
}

function childAgentKey(path: string, envelopes: Record<string, unknown>[]): string {
  const agentId = envelopes
    .map((envelope) => envelope.agentId)
    .find((value): value is string => typeof value === "string" && value.length > 0);
  return agentId ?? basename(path, ".jsonl");
}

function childPrompt(envelopes: Record<string, unknown>[]): string | undefined {
  for (const envelope of envelopes) {
    if (envelope.type !== "user") continue;
    const text = textFromMessage(envelope);
    if (text !== undefined && text.length > 0) return text;
  }
  return undefined;
}

function childBelongsToParent(envelopes: unknown[], parentSessionId: string): boolean {
  if (envelopes.length === 0) return false;
  const canonicalParentSessionId = canonicalizeIdentityString(parentSessionId);
  for (const envelope of envelopes) {
    if (!isObject(envelope)) return false;
    if (envelope.isSidechain !== true) return false;
    if (typeof envelope.sessionId !== "string") return false;
    if (canonicalizeIdentityString(envelope.sessionId) !== canonicalParentSessionId) return false;
  }
  return true;
}

async function parseGroup(
  path: string,
  options: {
    forkFrom?: ForkFrom;
    childKey?: string;
    parentSessionId?: string;
    includeSidechain?: boolean;
  } = {},
): Promise<TrailSessionGroup> {
  const text = await readFile(path, "utf8");
  const envelopes = parseLines(text);
  const header = buildHeader(envelopes, { includeSidechain: options.includeSidechain === true });
  if (options.childKey !== undefined && options.parentSessionId !== undefined) {
    const parentSessionId = canonicalizeIdentityString(options.parentSessionId);
    const childKey = canonicalizeIdentityString(options.childKey);
    const childId = deriveSessionUid(
      CLAUDE_CODE_SESSION_UID_NAMESPACE,
      `${parentSessionId}\x1f${childKey}`,
    );
    header.id = childId;
    header.session_uid = childId;
    header.meta = { ...header.meta, "dev.claudecode.agent_id": options.childKey };
  }
  if (options.forkFrom !== undefined) {
    header.fork_from = {
      ...options.forkFrom,
      session_id: canonicalizeIdentityString(options.forkFrom.session_id),
      ...(options.forkFrom.entry_id !== undefined
        ? { entry_id: canonicalizeIdentityString(options.forkFrom.entry_id) }
        : {}),
    };
  }
  const sessionUid = header.session_uid ?? header.id;
  const entries = await parseClaudeCodeSnapshotEntries(envelopes, sessionUid, {
    includeSidechain: options.includeSidechain === true,
  });
  applyHeaderMetadataUpdates(header, entries);
  applyParseFidelity(header, entries);
  return { header, entries };
}

function safeChildDir(parentPath: string): string | undefined {
  const parentDir = resolve(dirname(parentPath));
  const parentStem = basename(parentPath, ".jsonl");
  if (
    parentStem.length === 0 ||
    parentStem === "." ||
    parentStem === ".." ||
    parentStem.includes("/") ||
    parentStem.includes("\\")
  ) {
    return undefined;
  }
  const dir = resolve(parentDir, parentStem, "subagents");
  const rel = relative(parentDir, dir);
  if (rel.length === 0 || rel.startsWith("..") || isAbsolute(rel)) return undefined;
  return dir;
}

async function childFiles(parentPath: string): Promise<string[]> {
  const dir = safeChildDir(parentPath);
  if (dir === undefined) return [];
  const dirStat = await lstat(dir).catch(() => undefined);
  if (dirStat === undefined || !dirStat.isDirectory() || dirStat.isSymbolicLink()) return [];
  const realParentDir = await realpath(dirname(parentPath)).catch(() => undefined);
  const realDir = await realpath(dir).catch(() => undefined);
  if (realParentDir === undefined || realDir === undefined) return [];
  const rel = relative(realParentDir, realDir);
  if (rel.length === 0 || rel.startsWith("..") || isAbsolute(rel)) return [];
  const names = await readdir(dir).catch(() => undefined);
  if (names === undefined) return [];
  const files: string[] = [];
  for (const name of names) {
    if (!name.endsWith(".jsonl")) continue;
    const file = join(dir, name);
    const fileStat = await lstat(file).catch(() => undefined);
    if (fileStat === undefined || !fileStat.isFile() || fileStat.isSymbolicLink()) continue;
    files.push(file);
  }
  return files;
}

function withLinkedChildSessionIds(entries: Entry[], linked: Map<string, string>): Entry[] {
  return entries.map((entry) => {
    const childId = linked.get(entry.id);
    if (childId === undefined || entry.type !== "tool_call") return entry;
    if (entry.payload.tool !== "subagent_invoke") return entry;
    const args = isObject(entry.payload.args) ? entry.payload.args : {};
    return {
      ...entry,
      payload: { ...entry.payload, args: { ...args, session_id: childId } },
    } as Entry;
  });
}

async function directChildGroups(
  parentGroup: TrailSessionGroup,
  parentPath: string,
): Promise<TrailSessionGroup[]> {
  const files = await childFiles(parentPath);
  if (files.length === 0) return [];
  const childCandidates = await Promise.all(
    files.map(async (file) => {
      const text = await readFile(file, "utf8").catch(() => undefined);
      if (text === undefined) return undefined;
      let envelopes: Record<string, unknown>[];
      try {
        envelopes = parseLines(text) as Record<string, unknown>[];
      } catch {
        return undefined;
      }
      if (!childBelongsToParent(envelopes, parentGroup.header.id)) return undefined;
      return {
        file,
        envelopes,
        key: childAgentKey(file, envelopes),
        prompt: childPrompt(envelopes),
      };
    }),
  );
  const candidates = childCandidates.filter((candidate) => candidate !== undefined);

  const taskCounts = new Map<string, number>();
  for (const entry of parentGroup.entries) {
    const task = subagentTask(entry);
    if (task !== undefined) taskCounts.set(task, (taskCounts.get(task) ?? 0) + 1);
  }
  const linked = new Map<string, string>();
  const groups: TrailSessionGroup[] = [];
  const usedFiles = new Set<string>();
  const usedChildIds = new Set<string>();
  for (const entry of parentGroup.entries) {
    const task = subagentTask(entry);
    if (task === undefined) continue;
    if (taskCounts.get(task) !== 1) continue;
    const matches = candidates.filter(
      (candidate) => candidate.prompt === task && !usedFiles.has(candidate.file),
    );
    if (matches.length !== 1) continue;
    const [child] = matches;
    if (child === undefined) continue;
    const parsed = await parseGroup(child.file, {
      forkFrom: { session_id: parentGroup.header.id, entry_id: entry.id },
      childKey: child.key,
      parentSessionId: parentGroup.header.id,
      includeSidechain: true,
    }).catch(() => undefined);
    if (parsed === undefined) continue;
    if (usedChildIds.has(parsed.header.id)) continue;
    usedFiles.add(child.file);
    usedChildIds.add(parsed.header.id);
    linked.set(entry.id, parsed.header.id);
    groups.push(parsed);
  }
  parentGroup.entries = withLinkedChildSessionIds(parentGroup.entries, linked);
  return groups;
}

export type ClaudeCodeAdapterOptions = {
  env?: NodeJS.ProcessEnv;
};

export function createClaudeCodeAdapter(options: ClaudeCodeAdapterOptions = {}): TrailAdapter {
  const env = options.env ?? process.env;
  return {
    name: "claude-code",
    async detectSessions(opts?: DetectOptions): Promise<SessionRef[]> {
      const configDir = claudeCodeConfigDir(env);
      if (configDir === undefined) return [];
      if (opts?.allCwds === true) {
        const root = claudeCodeProjectsRoot(configDir);
        return scanLocalJsonlProjectRoot({ adapter: "claude-code", root });
      }
      const dir = claudeCodeProjectDir({ configDir, cwd: opts?.cwd ?? process.cwd() });
      return scanLocalJsonlSessionDir({ adapter: "claude-code", dir });
    },
    async parseSession(ref: SessionRef): Promise<TrailFile> {
      if (ref.path === undefined) {
        throw new Error("Claude Code adapter requires SessionRef.path");
      }
      const parentGroup = await parseGroup(ref.path);
      const groups = [parentGroup, ...(await directChildGroups(parentGroup, ref.path))];
      const envelope = buildTrailEnvelope({
        producer: PRODUCER,
        groups,
      });
      return sanitizeTrailFile({ envelope, groups });
    },
    async resumeSession(ref: SessionRef) {
      return resumeCommand(ref, `Resume Claude Code session ${ref.id}`, [
        "claude",
        "--resume",
        ref.id,
      ]);
    },
    async isAvailable(): Promise<boolean> {
      const configDir = claudeCodeConfigDir(env);
      if (configDir === undefined) return false;
      return dirExists(claudeCodeProjectDir({ configDir, cwd: process.cwd() }));
    },
    async sourceVersion(): Promise<string | null> {
      const configDir = claudeCodeConfigDir(env);
      if (configDir === undefined) return null;
      const dir = claudeCodeProjectDir({ configDir, cwd: process.cwd() });
      return newestLocalJsonlSourceVersion({
        dir,
        versionFrom: (record) => (typeof record.version === "string" ? record.version : null),
      });
    },
    sourceHealth: () => inspectSourceHealth(env),
  };
}
