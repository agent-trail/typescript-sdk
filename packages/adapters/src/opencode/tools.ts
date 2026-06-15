import type { ToolKind } from "@agent-trail/types";
import { numberValue, type Raw, stringValue } from "./source.js";

type MappedTool = { tool: ToolKind; args: Raw };

export function mapTool(toolName: string, args: Raw): MappedTool {
  return (
    fileTool(toolName, args) ??
    shellTool(toolName, args) ??
    searchTool(toolName, args) ??
    listTool(toolName, args) ??
    webFetchTool(toolName, args) ??
    subagentTool(toolName, args) ??
    mcpTool(toolName, args) ??
    otherTool(toolName, args)
  );
}

function fileTool(toolName: string, args: Raw): MappedTool | undefined {
  if (toolName === "read") return readTool(args) ?? otherTool(toolName, args);
  if (toolName === "write") return writeTool(args) ?? otherTool(toolName, args);
  if (toolName === "edit") return editTool(args) ?? otherTool(toolName, args);
  return undefined;
}

function readTool(args: Raw): MappedTool | undefined {
  const path = pathValue(args);
  if (path === undefined) return undefined;
  const offset = numberValue(args.offset);
  const limit = numberValue(args.limit);
  return {
    tool: "file_read",
    args: {
      path,
      ...(offset !== undefined && limit !== undefined ? { range: [offset, offset + limit] } : {}),
    },
  };
}

function writeTool(args: Raw): MappedTool | undefined {
  const path = stringValue(args.filePath) ?? stringValue(args.path);
  const content = stringValue(args.content);
  return path === undefined || content === undefined
    ? undefined
    : { tool: "file_write", args: { path, content } };
}

function editTool(args: Raw): MappedTool | undefined {
  const path = stringValue(args.filePath) ?? stringValue(args.path);
  if (path === undefined) return undefined;
  const oldString = stringValue(args.oldString) ?? stringValue(args.old_string);
  const newString = stringValue(args.newString) ?? stringValue(args.new_string);
  if (oldString === undefined && newString === undefined) return undefined;
  return { tool: "file_edit", args: { path, old: oldString ?? "", new: newString ?? "" } };
}

function shellTool(toolName: string, args: Raw): MappedTool | undefined {
  if (toolName === "bash") {
    return {
      tool: "shell_command",
      args: {
        ...(stringValue(args.command) !== undefined ? { command: stringValue(args.command) } : {}),
        ...(stringValue(args.workdir) !== undefined ? { cwd: stringValue(args.workdir) } : {}),
        ...(numberValue(args.timeout) !== undefined ? { timeout: numberValue(args.timeout) } : {}),
      },
    };
  }
  if (toolName !== "background_output") return undefined;
  const commandId =
    stringValue(args.commandID) ?? stringValue(args.command_id) ?? stringValue(args.id);
  return {
    tool: "shell_output",
    args: { ...(commandId !== undefined ? { command_id: commandId } : {}) },
  };
}

function searchTool(toolName: string, args: Raw): MappedTool | undefined {
  if (toolName !== "grep" && toolName !== "glob") return undefined;
  return {
    tool: "file_search",
    args: {
      query: stringValue(args.pattern) ?? "",
      ...(stringValue(args.path) !== undefined ? { path: stringValue(args.path) } : {}),
      ...(toolName === "grep" && stringValue(args.include) !== undefined
        ? { glob: stringValue(args.include) }
        : {}),
    },
  };
}

function listTool(toolName: string, args: Raw): MappedTool | undefined {
  return toolName === "list"
    ? { tool: "file_list", args: { path: stringValue(args.path) ?? "." } }
    : undefined;
}

function webFetchTool(toolName: string, args: Raw): MappedTool | undefined {
  if (toolName !== "webfetch") return undefined;
  const url = stringValue(args.url)?.trim();
  return url === undefined || url.length === 0
    ? otherTool(toolName, args)
    : { tool: "web_fetch", args: { url } };
}

function subagentTool(toolName: string, args: Raw): MappedTool | undefined {
  if (toolName !== "task") return undefined;
  return {
    tool: "subagent_invoke",
    args: {
      task: stringValue(args.prompt) ?? stringValue(args.description) ?? "",
      ...(stringValue(args.subagent_type) !== undefined
        ? { agent_type: stringValue(args.subagent_type) }
        : {}),
    },
  };
}

function mcpTool(toolName: string, args: Raw): MappedTool | undefined {
  if (!/^[a-z0-9-]+_[a-z0-9][a-z0-9_-]*$/i.test(toolName)) return undefined;
  const [server, ...toolParts] = toolName.split("_");
  return server === undefined
    ? undefined
    : { tool: "mcp_call", args: { server, tool: toolParts.join("-"), args } };
}

function pathValue(args: Raw): string | undefined {
  return stringValue(args.filePath) ?? stringValue(args.file_path) ?? stringValue(args.path);
}

function otherTool(toolName: string, args: Raw): MappedTool {
  return { tool: "other", args: { name: toolName, args } };
}
