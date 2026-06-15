import { lstat, readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
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
import { withLinkedSubagentSessionIds } from "../shared/child-session-links.js";
import {
  inspectLocalJsonlSourceHealth,
  listSafeJsonlFiles,
  newestLocalJsonlSourceVersion,
  scanLocalJsonlProjectsRoot,
} from "../shared/local-jsonl.js";
import { sanitizeTrailFile } from "../trail-sanitizer.js";
import { parseClaudeCodeSnapshotEntries } from "./kit.js";
import { buildHeader } from "./parser.js";
import { claudeCodeConfigDir, claudeCodeProjectDir, claudeCodeProjectsRoot } from "./paths.js";
import { isObject, parseLines, textFromTextBlocks } from "./source.js";

const PRODUCER = `@agent-trail/adapters-claude-code/${pkg.version}`;

async function dirExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}

const LOCAL_JSONL = {
  adapter: "claude-code",
  cwdFromRecord: (record: Record<string, unknown>) =>
    typeof record.cwd === "string" ? record.cwd : undefined,
  versionFromRecord: (record: Record<string, unknown>) =>
    typeof record.version === "string" ? record.version : undefined,
};

function projectDirForCwd(configDir: string): (cwd: string) => string {
  return (cwd) => claudeCodeProjectDir({ configDir, cwd });
}

async function inspectSourceHealth(
  env: NodeJS.ProcessEnv = process.env,
): Promise<AdapterSourceHealth> {
  const configDir = claudeCodeConfigDir(env);
  const root = configDir === undefined ? null : claudeCodeProjectsRoot(configDir);
  const scan =
    configDir === undefined || root === null
      ? () => Promise.resolve([])
      : () =>
          scanLocalJsonlProjectsRoot(root, {
            ...LOCAL_JSONL,
            allCwds: true,
            projectDirForCwd: projectDirForCwd(configDir),
          });
  return inspectLocalJsonlSourceHealth({
    adapter: "claude-code",
    root,
    scan,
    sourceVersion: () => createClaudeCodeAdapter({ env }).sourceVersion(),
  });
}

type ForkFrom = NonNullable<Header["fork_from"]>;

function textFromContent(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  const text = textFromTextBlocks(content);
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
  if (!(await isSafeChildDirectory(parentPath, dir))) return [];
  return listSafeJsonlFiles(dir).catch(() => []);
}

async function isSafeChildDirectory(parentPath: string, dir: string): Promise<boolean> {
  const dirStat = await lstat(dir).catch(() => undefined);
  if (dirStat === undefined || !dirStat.isDirectory() || dirStat.isSymbolicLink()) return false;
  const realParentDir = await realpath(dirname(parentPath)).catch(() => undefined);
  const realDir = await realpath(dir).catch(() => undefined);
  if (realParentDir === undefined || realDir === undefined) return false;
  const rel = relative(realParentDir, realDir);
  return rel.length > 0 && !rel.startsWith("..") && !isAbsolute(rel);
}

async function directChildGroups(
  parentGroup: TrailSessionGroup,
  parentPath: string,
): Promise<TrailSessionGroup[]> {
  const files = await childFiles(parentPath);
  if (files.length === 0) return [];
  const childCandidates = await Promise.all(
    files.map((file) => childCandidate(file, parentGroup.header.id)),
  );
  const candidates = childCandidates.filter((candidate) => candidate !== undefined);

  const taskCounts = subagentTaskCounts(parentGroup.entries);
  const linked = new Map<string, string>();
  const groups: TrailSessionGroup[] = [];
  const usedFiles = new Set<string>();
  const usedChildIds = new Set<string>();
  for (const entry of parentGroup.entries) {
    const task = subagentTask(entry);
    if (task === undefined) continue;
    if (taskCounts.get(task) !== 1) continue;
    const child = matchingChildCandidate(candidates, task, usedFiles);
    if (child === undefined) continue;
    const parsed = await parseLinkedChildGroup(child, parentGroup.header.id, entry.id);
    if (parsed === undefined) continue;
    if (usedChildIds.has(parsed.header.id)) continue;
    usedFiles.add(child.file);
    usedChildIds.add(parsed.header.id);
    linked.set(entry.id, parsed.header.id);
    groups.push(parsed);
  }
  parentGroup.entries = withLinkedSubagentSessionIds(parentGroup.entries, linked);
  return groups;
}

type ChildCandidate = {
  file: string;
  envelopes: Record<string, unknown>[];
  key: string;
  prompt: string | undefined;
};

async function childCandidate(
  file: string,
  parentSessionId: string,
): Promise<ChildCandidate | undefined> {
  const text = await readFile(file, "utf8").catch(() => undefined);
  if (text === undefined) return undefined;
  const envelopes = parseChildEnvelopes(text);
  if (envelopes === undefined || !childBelongsToParent(envelopes, parentSessionId)) {
    return undefined;
  }
  return {
    file,
    envelopes,
    key: childAgentKey(file, envelopes),
    prompt: childPrompt(envelopes),
  };
}

function parseChildEnvelopes(text: string): Record<string, unknown>[] | undefined {
  try {
    return parseLines(text) as Record<string, unknown>[];
  } catch {
    return undefined;
  }
}

function subagentTaskCounts(entries: Entry[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const task = subagentTask(entry);
    if (task !== undefined) counts.set(task, (counts.get(task) ?? 0) + 1);
  }
  return counts;
}

function matchingChildCandidate(
  candidates: ChildCandidate[],
  task: string,
  usedFiles: Set<string>,
): ChildCandidate | undefined {
  const matches = candidates.filter(
    (candidate) => candidate.prompt === task && !usedFiles.has(candidate.file),
  );
  return matches.length === 1 ? matches[0] : undefined;
}

function parseLinkedChildGroup(
  child: ChildCandidate,
  parentSessionId: string,
  parentEntryId: string,
): Promise<TrailSessionGroup | undefined> {
  return parseGroup(child.file, {
    forkFrom: { session_id: parentSessionId, entry_id: parentEntryId },
    childKey: child.key,
    parentSessionId,
    includeSidechain: true,
  }).catch(() => undefined);
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
      return scanLocalJsonlProjectsRoot(claudeCodeProjectsRoot(configDir), {
        ...LOCAL_JSONL,
        allCwds: opts?.allCwds,
        cwd: opts?.cwd,
        projectDirForCwd: projectDirForCwd(configDir),
      });
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
      return newestLocalJsonlSourceVersion(dir, LOCAL_JSONL);
    },
    sourceHealth: () => inspectSourceHealth(env),
  };
}
