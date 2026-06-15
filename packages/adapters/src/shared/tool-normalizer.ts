import type { ToolKind } from "@agent-trail/types";

export type NormalizedToolCall = {
  tool: ToolKind;
  args: Record<string, unknown>;
};

export type NormalizeToolCallInput = {
  name: string;
  args?: Record<string, unknown> | undefined;
};

export function normalizeToolCall(input: NormalizeToolCallInput): NormalizedToolCall {
  const args = input.args ?? {};
  const name = input.name.toLowerCase();

  return (
    shellTool(name, args) ??
    fileReadTool(name, args) ??
    fileWriteTool(name, args) ??
    fileEditTool(name, args) ??
    filePatchTool(name, args) ??
    fileSearchTool(name, args) ??
    mcpTool(input.name, args) ??
    other(input.name, args)
  );
}

function shellTool(name: string, args: Record<string, unknown>): NormalizedToolCall | undefined {
  if (name !== "bash" && name !== "shell" && name !== "shell_command") return undefined;
  const command = stringValue(args.command) ?? stringValue(args.cmd);
  return command === undefined ? undefined : { tool: "shell_command", args: { command } };
}

function fileReadTool(name: string, args: Record<string, unknown>): NormalizedToolCall | undefined {
  if (name === "read" || name === "file_read") {
    const path = pathValue(args);
    if (path !== undefined) return { tool: "file_read", args: { path } };
  }
  return undefined;
}

function fileWriteTool(
  name: string,
  args: Record<string, unknown>,
): NormalizedToolCall | undefined {
  if (name === "write" || name === "file_write") {
    const path = pathValue(args);
    const content = stringValue(args.content);
    if (path !== undefined && content !== undefined) {
      return { tool: "file_write", args: { path, content } };
    }
  }
  return undefined;
}

function fileEditTool(name: string, args: Record<string, unknown>): NormalizedToolCall | undefined {
  if (name === "edit" || name === "file_edit") {
    const edit = editArgs(args);
    if (edit !== undefined) return { tool: "file_edit", args: edit };
  }
  return undefined;
}

function filePatchTool(
  name: string,
  args: Record<string, unknown>,
): NormalizedToolCall | undefined {
  if (name === "apply_patch" || name === "patch" || name === "file_patch") {
    const patch = stringValue(args.patch) ?? stringValue(args.input);
    if (patch !== undefined) return { tool: "file_patch", args: { patch } };
  }
  return undefined;
}

function fileSearchTool(
  name: string,
  args: Record<string, unknown>,
): NormalizedToolCall | undefined {
  if (name === "grep" || name === "search" || name === "file_search") {
    const query = stringValue(args.pattern) ?? stringValue(args.query);
    if (query !== undefined) {
      const path = pathValue(args);
      const glob = stringValue(args.glob);
      return {
        tool: "file_search",
        args: {
          query,
          ...(path !== undefined ? { path } : {}),
          ...(glob !== undefined ? { glob } : {}),
        },
      };
    }
  }
  return undefined;
}

function mcpTool(name: string, args: Record<string, unknown>): NormalizedToolCall | undefined {
  const mcp = /^mcp__(?<server>[^_]+)__(?<tool>.+)$/.exec(name);
  if (mcp?.groups?.server === undefined || mcp.groups.tool === undefined) return undefined;
  return {
    tool: "mcp_call",
    args: { server: mcp.groups.server, name: mcp.groups.tool, args },
  };
}

function editArgs(args: Record<string, unknown>): Record<string, unknown> | undefined {
  const path = pathValue(args);
  const oldValue =
    stringValue(args.old) ?? stringValue(args.oldString) ?? stringValue(args.old_string);
  const newValue =
    stringValue(args.new) ?? stringValue(args.newString) ?? stringValue(args.new_string);
  if (path === undefined || oldValue === undefined || newValue === undefined) return undefined;
  return { path, old: oldValue, new: newValue };
}

function pathValue(args: Record<string, unknown>): string | undefined {
  return stringValue(args.path) ?? stringValue(args.filePath) ?? stringValue(args.file_path);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function other(name: string, args: Record<string, unknown>): NormalizedToolCall {
  return { tool: "other", args: { name, args } };
}
