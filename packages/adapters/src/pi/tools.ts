import { coerceInt as maybeNumber, quoteShellArg } from "../legacy-kit-helpers.js";
import { patchFiles } from "../shared/apply-patch-parser.js";
import { isObject, jsonObjectValue, stringValue } from "./source.js";

type ToolMapping = {
  tool: string;
  args: object;
};

// Pi's built-in tools (pi-mono `coding-agent/src/core/tools/`): bash, read, write, edit,
// grep, find, ls. Mapped to canonical kinds (spec §11). MCP-extension tools real Pi
// sessions also carry fall through to the `other` escape hatch (spec §11.7).
export function toolKindAndArgs(name: string | undefined, input: unknown): ToolMapping {
  const args = jsonObjectValue(input) ?? {};
  switch (name) {
    case "read":
      return readTool(args) ?? otherTool(name, input);
    case "write":
      return writeTool(args) ?? otherTool(name, input);
    case "edit":
      return editTool(args) ?? otherTool(name, input);
    case "bash":
      return bashTool(args) ?? otherTool(name, input);
    case "grep":
      return grepTool(args) ?? otherTool(name, input);
    case "find":
      return findTool(args) ?? otherTool(name, input);
    case "ls":
      return listTool(args);
    default:
      return otherTool(name, input);
  }
}

function readTool(args: Record<string, unknown>): ToolMapping | undefined {
  const path = pathValue(args);
  if (path === undefined) return undefined;
  const offset = maybeNumber(args.offset);
  const limit = maybeNumber(args.limit);
  return {
    tool: "file_read",
    args: {
      path,
      ...(offset !== undefined && limit !== undefined ? { range: [offset, offset + limit] } : {}),
    },
  };
}

function writeTool(args: Record<string, unknown>): ToolMapping | undefined {
  const path = pathValue(args);
  const content = stringValue(args.content);
  return path !== undefined && content !== undefined
    ? { tool: "file_write", args: { path, content } }
    : undefined;
}

// Pi `edit` arguments empirically come in four shapes:
// single replacement, multi replacement, current `edits` array, and raw apply_patch text.
function editTool(args: Record<string, unknown>): ToolMapping | undefined {
  const topPath = pathValue(args);
  if (Array.isArray(args.edits) && topPath !== undefined) {
    return editFromEditsArray(args, topPath);
  }
  if (Array.isArray(args.multi) && args.multi.length > 0) {
    return editFromMulti(args, topPath);
  }
  if (stringValue(args.patch) !== undefined) {
    return editFromPatch(args);
  }
  return editFromReplacement(args, topPath);
}

function editFromEditsArray(
  args: Record<string, unknown>,
  topPath: string | undefined,
): ToolMapping | undefined {
  const editsArray = Array.isArray(args.edits) ? args.edits : undefined;
  if (editsArray === undefined || topPath === undefined) return undefined;
  return editFromSingleHunk(topPath, replacementHunks(editsArray));
}

function editFromMulti(
  args: Record<string, unknown>,
  topPath: string | undefined,
): ToolMapping | undefined {
  const multi = Array.isArray(args.multi) ? args.multi : undefined;
  if (multi === undefined || multi.length === 0) return undefined;
  const editsByPath = editsGroupedByPath(multi, topPath);
  if (editsByPath === undefined || editsByPath.size !== 1) return undefined;
  const [entry] = editsByPath.entries();
  if (entry === undefined) return undefined;
  return editFromSingleHunk(entry[0], entry[1]);
}

function editFromPatch(args: Record<string, unknown>): ToolMapping | undefined {
  const patch = stringValue(args.patch);
  if (patch === undefined) return undefined;
  const files = patchFiles(patch);
  if (files.length > 1) return { tool: "file_patch", args: { files, atomic: true } };
  const file = files[0];
  return file === undefined ? undefined : { tool: "file_edit", args: file };
}

function editFromReplacement(
  args: Record<string, unknown>,
  topPath: string | undefined,
): ToolMapping | undefined {
  if (topPath === undefined) return undefined;
  const hunk = replacementHunk(args);
  return hunk === undefined
    ? undefined
    : { tool: "file_edit", args: { path: topPath, old: hunk.oldText, new: hunk.newText } };
}

function editFromSingleHunk(
  path: string,
  hunks: Array<{ oldText: string; newText: string }>,
): ToolMapping | undefined {
  const [hunk] = hunks;
  return hunks.length === 1 && hunk !== undefined
    ? { tool: "file_edit", args: { path, old: hunk.oldText, new: hunk.newText } }
    : undefined;
}

function editsGroupedByPath(
  values: unknown[],
  topPath: string | undefined,
): Map<string, Array<{ oldText: string; newText: string }>> | undefined {
  const editsByPath = new Map<string, Array<{ oldText: string; newText: string }>>();
  for (const value of values) {
    if (!isObject(value)) return undefined;
    const path = pathValue(value) ?? topPath;
    if (path === undefined) return undefined;
    const hunk = replacementHunk(value);
    if (hunk === undefined) continue;
    const arr = editsByPath.get(path) ?? [];
    arr.push(hunk);
    editsByPath.set(path, arr);
  }
  return editsByPath;
}

function replacementHunks(values: unknown[]): Array<{ oldText: string; newText: string }> {
  return values.filter(isObject).map(replacementHunk).filter(isPresent);
}

function replacementHunk(
  value: Record<string, unknown>,
): { oldText: string; newText: string } | undefined {
  const oldText =
    stringValue(value.oldText) ?? stringValue(value.old_text) ?? stringValue(value.oldString);
  const newText =
    stringValue(value.newText) ?? stringValue(value.new_text) ?? stringValue(value.newString);
  return oldText !== undefined || newText !== undefined
    ? { oldText: oldText ?? "", newText: newText ?? "" }
    : undefined;
}

function bashTool(args: Record<string, unknown>): ToolMapping | undefined {
  // Defensive arg shapes (real Pi sessions): string command, cmd alias, or argv-style command.
  const command =
    stringValue(args.command) ?? stringValue(args.cmd) ?? commandArrayString(args.command);
  if (command === undefined) return undefined;
  const cwd = stringValue(args.cwd);
  const timeout = maybeNumber(args.timeout);
  return {
    tool: "shell_command",
    args: {
      command,
      ...(cwd !== undefined ? { cwd } : {}),
      ...(timeout !== undefined ? { timeout } : {}),
    },
  };
}

function commandArrayString(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const parts = value.filter((part): part is string => typeof part === "string");
  return parts.length > 0 ? parts.map(quoteShellArg).join(" ") : undefined;
}

function grepTool(args: Record<string, unknown>): ToolMapping | undefined {
  const pattern = stringValue(args.pattern);
  if (pattern === undefined) return undefined;
  const path = stringValue(args.path);
  const glob = stringValue(args.glob);
  return {
    tool: "file_search",
    args: {
      query: pattern,
      ...(path !== undefined ? { path } : {}),
      ...(glob !== undefined ? { glob } : {}),
    },
  };
}

function findTool(args: Record<string, unknown>): ToolMapping | undefined {
  const pattern = stringValue(args.pattern);
  if (pattern === undefined) return undefined;
  const path = stringValue(args.path);
  return {
    tool: "file_search",
    args: { query: pattern, ...(path !== undefined ? { path } : {}) },
  };
}

function listTool(args: Record<string, unknown>): ToolMapping {
  return { tool: "file_list", args: { path: stringValue(args.path) ?? "." } };
}

function pathValue(args: Record<string, unknown>): string | undefined {
  return stringValue(args.path) ?? stringValue(args.file_path);
}

function otherTool(name: string | undefined, input: unknown): ToolMapping {
  return {
    tool: "other",
    args: {
      ...(name !== undefined ? { name } : { name: "unknown" }),
      ...(isObject(input) ? { args: input } : {}),
    },
  };
}

function isPresent<T>(value: T | undefined): value is T {
  return value !== undefined;
}
