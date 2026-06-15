import type { TrailEntryDraft } from "@agent-trail/adapter-kit";
import { defineMapping } from "@agent-trail/adapter-kit";
import { type CcEnvelope, isObject, stringValue } from "../source.js";
import { gate, meta, metadataSource, type Raw } from "./shared.js";

const aiTitleMetadata = defineMapping<Raw>({
  match: { type: "ai-title" },
  emit: (raw) => {
    const record = raw as CcEnvelope;
    if (!gate(record, true)) return [];
    const aiTitle = stringValue(record.aiTitle);
    if (aiTitle === undefined) return [];
    return [
      {
        type: "session_metadata_update",
        payload: { field: "name", value: aiTitle, reason: "ai_generated" },
        source: metadataSource(record, "ai-title"),
        meta: meta(record),
      },
    ];
  },
});

const agentNameMetadata = defineMapping<Raw>({
  match: { type: "agent-name" },
  emit: (raw) => {
    const record = raw as CcEnvelope;
    if (!gate(record, true)) return [];
    const agentName = stringValue(record.agentName);
    if (agentName === undefined) return [];
    return [
      {
        type: "session_metadata_update",
        payload: {
          field: "x-claudecode/agent_name",
          value: agentName,
          reason: "ai_generated",
        },
        source: metadataSource(record, "agent-name"),
        meta: meta(record),
      },
    ];
  },
});

const worktreeStateMetadata = defineMapping<Raw>({
  match: { type: "worktree-state" },
  emit: (raw) => {
    const record = raw as CcEnvelope;
    if (!gate(record, true)) return [];
    const ws = isObject(record.worktreeSession) ? record.worktreeSession : undefined;
    if (ws === undefined) return [];

    return [branchUpdate(record, ws), worktreeUpdate(record, ws)].filter(isPresent);
  },
});

function branchUpdate(
  record: CcEnvelope,
  ws: Record<string, unknown>,
): TrailEntryDraft | undefined {
  const branch = stringValue(ws.worktreeBranch);
  return branch === undefined ? undefined : metadataUpdate(record, "vcs.branch", branch);
}

function worktreeUpdate(
  record: CcEnvelope,
  ws: Record<string, unknown>,
): TrailEntryDraft | undefined {
  const worktree = worktreeValue(ws);
  return worktree === undefined ? undefined : metadataUpdate(record, "vcs.worktree", worktree);
}

function metadataUpdate(record: CcEnvelope, field: string, value: unknown): TrailEntryDraft {
  return {
    type: "session_metadata_update",
    payload: { field, value, reason: "runtime_inferred" },
    source: metadataSource(record, "worktree-state"),
    meta: meta(record),
  };
}

function worktreeValue(ws: Record<string, unknown>): Record<string, unknown> | undefined {
  const name = stringValue(ws.worktreeName);
  const path = stringValue(ws.worktreePath);
  if (name === undefined || path === undefined) return undefined;
  return {
    name,
    path,
    ...optionalString("original_cwd", ws.originalCwd),
    ...optionalString("original_branch", ws.originalBranch),
    ...originalHeadCommit(ws.originalHeadCommit),
  };
}

function originalHeadCommit(value: unknown): Record<string, string> {
  const commit = stringValue(value);
  return commit !== undefined && /^[a-f0-9]{7,64}$/.test(commit)
    ? { original_head_commit: commit }
    : {};
}

function optionalString(key: string, value: unknown): Record<string, string> {
  const string = stringValue(value);
  return string === undefined ? {} : { [key]: string };
}

function isPresent<T>(value: T | undefined): value is T {
  return value !== undefined;
}

export const metadataMappings = [aiTitleMetadata, agentNameMetadata, worktreeStateMetadata];
