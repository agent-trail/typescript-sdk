import { quoteShellArg } from "@agent-trail/adapter-kit";

export type NormalizedTool = {
  tool: string;
  args: Record<string, unknown>;
};

export type PatchFile = {
  path: string;
  diff: string;
};

const PATCH_FILE_MARKER = /^\*\*\* (Update|Add|Delete) File: (.+)$/gm;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function otherTool(name: string | undefined, input: unknown): NormalizedTool {
  return {
    tool: "other",
    args: {
      name: name ?? "unknown",
      ...(isObject(input) ? { args: input } : {}),
    },
  };
}

export function fileReadTool(
  args: Record<string, unknown>,
  pathKeys: readonly string[],
): NormalizedTool | undefined {
  const path = firstString(args, pathKeys);
  const offset = numberValue(args.offset);
  const limit = numberValue(args.limit);
  if (path === undefined) return undefined;
  return {
    tool: "file_read",
    args: {
      path,
      ...(offset !== undefined && limit !== undefined ? { range: [offset, offset + limit] } : {}),
    },
  };
}

export function fileWriteTool(
  args: Record<string, unknown>,
  pathKeys: readonly string[],
): NormalizedTool | undefined {
  const path = firstString(args, pathKeys);
  const content = stringValue(args.content);
  return path !== undefined && content !== undefined
    ? { tool: "file_write", args: { path, content } }
    : undefined;
}

export function replacementEditTool(input: {
  path: string | undefined;
  oldText: string | undefined;
  newText: string | undefined;
  extra?: Record<string, unknown>;
}): NormalizedTool | undefined {
  if (input.path === undefined || (input.oldText === undefined && input.newText === undefined)) {
    return undefined;
  }
  return {
    tool: "file_edit",
    args: {
      path: input.path,
      old: input.oldText ?? "",
      new: input.newText ?? "",
      ...input.extra,
    },
  };
}

export function shellCommandTool(input: {
  command: string | readonly string[] | undefined;
  cwd?: string | undefined;
  timeout?: number | undefined;
}): NormalizedTool | undefined {
  const command = Array.isArray(input.command)
    ? input.command.map(quoteShellArg).join(" ")
    : input.command;
  if (command === undefined || command.length === 0) return undefined;
  return {
    tool: "shell_command",
    args: {
      command,
      ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
      ...(input.timeout !== undefined ? { timeout: input.timeout } : {}),
    },
  };
}

export function fileSearchTool(input: {
  query: string | undefined;
  path?: string | undefined;
  glob?: string | undefined;
}): NormalizedTool | undefined {
  if (input.query === undefined) return undefined;
  return {
    tool: "file_search",
    args: {
      query: input.query,
      ...(input.path !== undefined ? { path: input.path } : {}),
      ...(input.glob !== undefined ? { glob: input.glob } : {}),
    },
  };
}

export function fileListTool(path: string | undefined): NormalizedTool {
  return { tool: "file_list", args: { path: path ?? "." } };
}

export function subagentInvokeTool(input: {
  task: string | undefined;
  agentType?: string | undefined;
  sessionId?: string | undefined;
}): NormalizedTool | undefined {
  if (input.task === undefined) return undefined;
  return {
    tool: "subagent_invoke",
    args: {
      task: input.task,
      ...(input.agentType !== undefined ? { agent_type: input.agentType } : {}),
      ...(input.sessionId !== undefined ? { session_id: input.sessionId } : {}),
    },
  };
}

export function stringArrayValue(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((part): part is string => typeof part === "string")
    : undefined;
}

function firstString(args: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = stringValue(args[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

export function patchFiles(input: string): PatchFile[] {
  const matches = [...input.matchAll(PATCH_FILE_MARKER)];
  const files: PatchFile[] = [];
  for (const [index, match] of matches.entries()) {
    const action = match[1];
    const sourcePath = match[2];
    if (
      (action !== "Update" && action !== "Add" && action !== "Delete") ||
      sourcePath === undefined
    ) {
      continue;
    }
    const path = sourcePath.trim();
    if (path.length === 0) continue;
    const start = match.index + match[0].length;
    const end = matches[index + 1]?.index ?? endPatchIndex(input, start);
    const body = input.slice(start, end === -1 ? undefined : end).trim();
    const moveTo = body.match(/^\*\*\* Move to: (.+)$/m)?.[1]?.trim();
    const newPath = moveTo && moveTo.length > 0 ? moveTo : path;
    const oldHeader = action === "Add" ? "/dev/null" : `a/${path}`;
    const newHeader = action === "Delete" ? "/dev/null" : `b/${newPath}`;
    const diffBody = normalizePatchBody(action, body);
    files.push({
      path: newPath,
      diff: [`--- ${oldHeader}`, `+++ ${newHeader}`, diffBody]
        .filter((part) => part.length > 0)
        .join("\n"),
    });
  }
  return files;
}

export function patchSingleFilePath(input: string): string | undefined {
  const paths = new Set(patchFiles(input).map((file) => file.path));
  if (paths.size === 1) {
    const [only] = paths;
    return only;
  }
  return undefined;
}

function endPatchIndex(input: string, start: number): number {
  const tail = input.slice(start);
  const match = tail.match(/^\*\*\* End Patch\b/m);
  return match?.index === undefined ? -1 : start + match.index;
}

function countPrefixedLines(lines: string[], prefix: string): number {
  return lines.filter((line) => line.startsWith(prefix)).length;
}

function normalizePatchBody(action: "Update" | "Add" | "Delete", body: string): string {
  const diffBody = body
    .split("\n")
    .filter((line) => !line.startsWith("*** Move to:") && line !== "*** End of File")
    .join("\n")
    .trim();
  if (diffBody.length === 0 || /^@@/m.test(diffBody)) return diffBody;

  const lines = diffBody.split("\n");
  const oldCount = action === "Add" ? 0 : countPrefixedLines(lines, "-");
  const newCount = action === "Delete" ? 0 : countPrefixedLines(lines, "+");
  return [`@@ -1,${oldCount} +1,${newCount} @@`, diffBody].join("\n");
}
