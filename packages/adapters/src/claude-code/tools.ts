import { canonicalizeIdentityString } from "../session-uid.js";
import { isObject, jsonObjectValue, maybeNumber, stringValue } from "./source.js";

type ToolMapping = {
  tool: string;
  args: object;
};

type ClaudeToolMapper = (
  name: string | undefined,
  args: Record<string, unknown>,
) => ToolMapping | undefined;

// Mirrors schema.json#/$defs/sessionUid; keep in sync with schema id rules.
const AGENT_TRAIL_ID_RE =
  /^(?:[0-9a-hjkmnp-tv-zA-HJKMNP-TV-Z]{26}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[0-9a-fA-F]{32})$/;

const TOOL_MAPPERS: ClaudeToolMapper[] = [
  shellCommandTool,
  fileReadTool,
  fileWriteTool,
  fileEditTool,
  multiEditTool,
  fileListTool,
  notebookEditTool,
  grepTool,
  globTool,
  webFetchTool,
  webSearchTool,
  toolSearchTool,
  subagentTool,
];

export function toolKindAndArgs(name: string | undefined, input: unknown): ToolMapping {
  const args = jsonObjectValue(input) ?? {};
  for (const mapper of TOOL_MAPPERS) {
    const mapped = mapper(name, args);
    if (mapped !== undefined) return mapped;
  }
  return otherTool(name, input);
}

function shellCommandTool(
  name: string | undefined,
  args: Record<string, unknown>,
): ToolMapping | undefined {
  if (name !== "Bash") return undefined;
  const command = stringValue(args.command);
  if (command === undefined) return undefined;
  return {
    tool: "shell_command",
    args: withOptionalFields(
      { command },
      {
        cwd: stringValue(args.cwd),
        timeout: maybeNumber(args.timeout),
      },
    ),
  };
}

function fileReadTool(
  name: string | undefined,
  args: Record<string, unknown>,
): ToolMapping | undefined {
  if (name !== "Read") return undefined;
  const path = pathArg(args);
  if (path === undefined) return undefined;
  const range = readRange(args);
  return { tool: "file_read", args: range === undefined ? { path } : { path, range } };
}

function fileWriteTool(
  name: string | undefined,
  args: Record<string, unknown>,
): ToolMapping | undefined {
  if (name !== "Write") return undefined;
  const path = pathArg(args);
  const content = stringValue(args.content);
  return path !== undefined && content !== undefined
    ? { tool: "file_write", args: { path, content } }
    : undefined;
}

function fileEditTool(
  name: string | undefined,
  args: Record<string, unknown>,
): ToolMapping | undefined {
  if (name !== "Edit") return undefined;
  const edit = editMappingArgs(args);
  return edit === undefined ? undefined : { tool: "file_edit", args: edit };
}

function multiEditTool(
  name: string | undefined,
  args: Record<string, unknown>,
): ToolMapping | undefined {
  if (name !== "MultiEdit") return undefined;
  const single = singleMultiEdit(args);
  return single === undefined ? undefined : { tool: "file_edit", args: single };
}

function fileListTool(
  name: string | undefined,
  args: Record<string, unknown>,
): ToolMapping | undefined {
  if (name !== "LS") return undefined;
  return { tool: "file_list", args: { path: pathArg(args) ?? "." } };
}

function notebookEditTool(
  name: string | undefined,
  args: Record<string, unknown>,
): ToolMapping | undefined {
  if (name !== "NotebookEdit") return undefined;
  const path = stringValue(args.notebook_path) ?? pathArg(args);
  if (path === undefined) return undefined;
  return {
    tool: "notebook_edit",
    args: withOptionalFields(
      { path },
      {
        cell_id: stringValue(args.cell_id),
        content: stringValue(args.new_source),
      },
    ),
  };
}

function grepTool(
  name: string | undefined,
  args: Record<string, unknown>,
): ToolMapping | undefined {
  if (name !== "Grep") return undefined;
  const query = stringValue(args.pattern) ?? stringValue(args.query);
  if (query === undefined) return undefined;
  return {
    tool: "file_search",
    args: withOptionalFields(
      { query },
      {
        path: stringValue(args.path),
        glob: stringValue(args.glob),
      },
    ),
  };
}

function globTool(
  name: string | undefined,
  args: Record<string, unknown>,
): ToolMapping | undefined {
  if (name !== "Glob") return undefined;
  const pattern = stringValue(args.pattern);
  return pattern === undefined
    ? undefined
    : { tool: "file_search", args: { query: pattern, glob: pattern } };
}

function webFetchTool(
  name: string | undefined,
  args: Record<string, unknown>,
): ToolMapping | undefined {
  if (name !== "WebFetch") return undefined;
  const url = stringValue(args.url);
  return url === undefined ? undefined : { tool: "web_fetch", args: { url } };
}

function webSearchTool(
  name: string | undefined,
  args: Record<string, unknown>,
): ToolMapping | undefined {
  if (name !== "WebSearch") return undefined;
  const query = stringValue(args.query);
  return query === undefined ? undefined : { tool: "web_search", args: { query } };
}

function toolSearchTool(
  name: string | undefined,
  args: Record<string, unknown>,
): ToolMapping | undefined {
  if (name !== "ToolSearch") return undefined;
  const query = stringValue(args.query) ?? stringValue(args.q);
  if (query === undefined) return undefined;
  return {
    tool: "tool_search",
    args: withOptionalFields({ query }, { limit: maybeNumber(args.limit) }),
  };
}

function subagentTool(
  name: string | undefined,
  args: Record<string, unknown>,
): ToolMapping | undefined {
  if (name !== "Task" && name !== "Agent") return undefined;
  const task = stringValue(args.prompt) ?? stringValue(args.description) ?? stringValue(args.name);
  if (task === undefined) return undefined;
  return {
    tool: "subagent_invoke",
    args: withOptionalFields(
      { task },
      {
        agent_type: stringValue(args.subagent_type),
        session_id: agentTrailId(args.session_id),
      },
    ),
  };
}

function editMappingArgs(args: Record<string, unknown>): object | undefined {
  const path = pathArg(args);
  const oldString = stringValue(args.old_string);
  const newString = stringValue(args.new_string);
  if (path === undefined || (oldString === undefined && newString === undefined)) return undefined;
  return withOptionalFields(
    {
      path,
      old: oldString ?? "",
      new: newString ?? "",
    },
    {
      replace_all: typeof args.replace_all === "boolean" ? args.replace_all : undefined,
    },
  );
}

function singleMultiEdit(args: Record<string, unknown>): object | undefined {
  const topPath = pathArg(args);
  const edits = Array.isArray(args.edits) ? args.edits : [];
  const hunksByPath = collectEditHunks(edits, topPath);
  if (hunksByPath.size !== 1) return undefined;
  const [path, hunks] = Array.from(hunksByPath.entries())[0] ?? [];
  if (path === undefined || hunks === undefined || hunks.length !== 1) return undefined;
  const hunk = hunks[0];
  return hunk === undefined ? undefined : { path, old: hunk.oldText, new: hunk.newText };
}

function collectEditHunks(
  edits: unknown[],
  topPath: string | undefined,
): Map<string, Array<{ oldText: string; newText: string }>> {
  const byPath = new Map<string, Array<{ oldText: string; newText: string }>>();
  for (const edit of edits) {
    const hunk = editHunk(edit, topPath);
    if (hunk === undefined) continue;
    const hunks = byPath.get(hunk.path) ?? [];
    hunks.push({ oldText: hunk.oldText, newText: hunk.newText });
    byPath.set(hunk.path, hunks);
  }
  return byPath;
}

function editHunk(
  edit: unknown,
  topPath: string | undefined,
): { path: string; oldText: string; newText: string } | undefined {
  if (!isObject(edit)) return undefined;
  const path = editPath(edit, topPath);
  const text = editText(edit);
  return path !== undefined && text !== undefined
    ? { path, oldText: text.oldText, newText: text.newText }
    : undefined;
}

function editPath(edit: Record<string, unknown>, topPath: string | undefined): string | undefined {
  return stringValue(edit.file_path) ?? stringValue(edit.path) ?? topPath;
}

function editText(edit: Record<string, unknown>): { oldText: string; newText: string } | undefined {
  const oldText = stringValue(edit.old_string) ?? stringValue(edit.oldString);
  const newText = stringValue(edit.new_string) ?? stringValue(edit.newString);
  return oldText !== undefined || newText !== undefined
    ? { oldText: oldText ?? "", newText: newText ?? "" }
    : undefined;
}

function readRange(args: Record<string, unknown>): [number, number] | undefined {
  const offset = maybeNumber(args.offset);
  const limit = maybeNumber(args.limit);
  return offset !== undefined && limit !== undefined ? [offset, offset + limit] : undefined;
}

function pathArg(args: Record<string, unknown>): string | undefined {
  return stringValue(args.file_path) ?? stringValue(args.path);
}

function agentTrailId(value: unknown): string | undefined {
  const id = stringValue(value);
  return id !== undefined && AGENT_TRAIL_ID_RE.test(id)
    ? canonicalizeIdentityString(id)
    : undefined;
}

function withOptionalFields(
  required: Record<string, unknown>,
  optional: Record<string, unknown>,
): object {
  const out = { ...required };
  for (const [key, value] of Object.entries(optional)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function otherTool(name: string | undefined, input: unknown): ToolMapping {
  return {
    tool: "other",
    args: {
      name: name ?? "unknown",
      ...(isObject(input) ? { args: input } : {}),
    },
  };
}
