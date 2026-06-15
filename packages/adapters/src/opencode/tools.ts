import type { ToolKind } from "@agent-trail/types";
import {
  fileListTool,
  fileReadTool,
  fileSearchTool,
  fileWriteTool,
  otherTool,
  replacementEditTool,
  shellCommandTool,
  subagentInvokeTool,
} from "../shared/tool-normalizer.js";
import { numberValue, type Raw, stringValue } from "./source.js";

export function mapTool(toolName: string, args: Raw): { tool: ToolKind; args: Raw } {
  switch (toolName) {
    case "read": {
      return asOpenCodeTool(
        fileReadTool(args, ["filePath", "file_path", "path"]) ?? otherTool(toolName, args),
      );
    }
    case "write": {
      return asOpenCodeTool(fileWriteTool(args, ["filePath", "path"]) ?? otherTool(toolName, args));
    }
    case "edit": {
      const path = stringValue(args.filePath) ?? stringValue(args.path);
      const oldString = stringValue(args.oldString) ?? stringValue(args.old_string);
      const newString = stringValue(args.newString) ?? stringValue(args.new_string);
      return asOpenCodeTool(
        replacementEditTool({ path, oldText: oldString, newText: newString }) ??
          otherTool(toolName, args),
      );
    }
    case "bash": {
      return asOpenCodeTool(
        shellCommandTool({
          command: stringValue(args.command) ?? "",
          cwd: stringValue(args.workdir),
          timeout: numberValue(args.timeout),
        }),
      );
    }
    case "background_output": {
      const commandId =
        stringValue(args.commandID) ?? stringValue(args.command_id) ?? stringValue(args.id);
      return {
        tool: "shell_output",
        args: { ...(commandId !== undefined ? { command_id: commandId } : {}) },
      };
    }
    case "grep":
      return asOpenCodeTool(
        fileSearchTool({
          query: stringValue(args.pattern) ?? "",
          path: stringValue(args.path),
          glob: stringValue(args.include),
        }),
      );
    case "glob": {
      return asOpenCodeTool(
        fileSearchTool({ query: stringValue(args.pattern) ?? "", path: stringValue(args.path) }),
      );
    }
    case "list": {
      return asOpenCodeTool(fileListTool(stringValue(args.path)));
    }
    case "webfetch": {
      const url = stringValue(args.url)?.trim();
      if (url === undefined || url.length === 0) {
        return { tool: "other", args: { name: "webfetch", args } };
      }
      return {
        tool: "web_fetch",
        args: { url },
      };
    }
    case "task": {
      return asOpenCodeTool(
        subagentInvokeTool({
          task: stringValue(args.prompt) ?? stringValue(args.description) ?? "",
          agentType: stringValue(args.subagent_type),
        }),
      );
    }
    default:
      if (/^[a-z0-9-]+_[a-z0-9][a-z0-9_-]*$/i.test(toolName)) {
        const [server, ...toolParts] = toolName.split("_");
        if (server === undefined) return asOpenCodeTool(otherTool(toolName, args));
        return {
          tool: "mcp_call",
          args: { server, tool: toolParts.join("-"), args },
        };
      }
      return asOpenCodeTool(otherTool(toolName, args));
  }
}

function asOpenCodeTool(tool: { tool: string; args: Record<string, unknown> } | undefined): {
  tool: ToolKind;
  args: Raw;
} {
  return (tool ?? otherTool(undefined, {})) as { tool: ToolKind; args: Raw };
}
