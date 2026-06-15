import { canonicalizeIdentityString } from "../session-uid.js";
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
import { isObject, jsonObjectValue, maybeNumber, stringValue } from "./source.js";

// Mirrors schema.json#/$defs/sessionUid; keep in sync with schema id rules.
const AGENT_TRAIL_ID_RE =
  /^(?:[0-9a-hjkmnp-tv-zA-HJKMNP-TV-Z]{26}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[0-9a-fA-F]{32})$/;

function agentTrailId(value: unknown): string | undefined {
  const id = stringValue(value);
  return id !== undefined && AGENT_TRAIL_ID_RE.test(id)
    ? canonicalizeIdentityString(id)
    : undefined;
}

export function toolKindAndArgs(
  name: string | undefined,
  input: unknown,
): {
  tool: string;
  args: object;
} {
  const args = jsonObjectValue(input) ?? {};
  switch (name) {
    case "Bash": {
      const mapped = shellCommandTool({
        command: stringValue(args.command),
        cwd: stringValue(args.cwd),
        timeout: maybeNumber(args.timeout),
      });
      if (mapped !== undefined) return mapped;
      break;
    }
    case "Read": {
      const mapped = fileReadTool(args, ["file_path", "path"]);
      if (mapped !== undefined) return mapped;
      break;
    }
    case "Write": {
      const mapped = fileWriteTool(args, ["file_path", "path"]);
      if (mapped !== undefined) return mapped;
      break;
    }
    case "Edit": {
      const path = stringValue(args.file_path) ?? stringValue(args.path);
      const oldString = stringValue(args.old_string);
      const newString = stringValue(args.new_string);
      if (path !== undefined && (oldString !== undefined || newString !== undefined)) {
        const replaceAll = typeof args.replace_all === "boolean" ? args.replace_all : undefined;
        const extra = replaceAll !== undefined ? { replace_all: replaceAll } : undefined;
        return replacementEditTool({
          path,
          oldText: oldString,
          newText: newString,
          ...(extra !== undefined ? { extra } : {}),
        }) as { tool: string; args: object };
      }
      break;
    }
    case "MultiEdit": {
      const topPath = stringValue(args.file_path) ?? stringValue(args.path);
      const edits = Array.isArray(args.edits) ? args.edits : [];
      const byPath = new Map<string, Array<{ oldText: string; newText: string }>>();
      for (const edit of edits) {
        if (!isObject(edit)) continue;
        const path = stringValue(edit.file_path) ?? stringValue(edit.path) ?? topPath;
        if (path === undefined) continue;
        const oldText = stringValue(edit.old_string) ?? stringValue(edit.oldString);
        const newText = stringValue(edit.new_string) ?? stringValue(edit.newString);
        if (oldText === undefined && newText === undefined) continue;
        const hunks = byPath.get(path) ?? [];
        hunks.push({ oldText: oldText ?? "", newText: newText ?? "" });
        byPath.set(path, hunks);
      }
      if (byPath.size === 1) {
        for (const [path, hunks] of byPath.entries()) {
          if (hunks.length === 1) {
            const [hunk] = hunks;
            if (hunk === undefined) break;
            return replacementEditTool({
              path,
              oldText: hunk.oldText,
              newText: hunk.newText,
            }) as { tool: string; args: object };
          }
          break;
        }
      }
      break;
    }
    case "LS": {
      return fileListTool(stringValue(args.path) ?? stringValue(args.file_path));
    }
    case "NotebookEdit": {
      const path =
        stringValue(args.notebook_path) ?? stringValue(args.file_path) ?? stringValue(args.path);
      if (path !== undefined) {
        return {
          tool: "notebook_edit",
          args: {
            path,
            ...(stringValue(args.cell_id) !== undefined
              ? { cell_id: stringValue(args.cell_id) }
              : {}),
            ...(stringValue(args.new_source) !== undefined
              ? { content: stringValue(args.new_source) }
              : {}),
          },
        };
      }
      break;
    }
    case "Grep": {
      const query = stringValue(args.pattern) ?? stringValue(args.query);
      const mapped = fileSearchTool({
        query,
        path: stringValue(args.path),
        glob: stringValue(args.glob),
      });
      if (mapped !== undefined) return mapped;
      break;
    }
    case "Glob": {
      const pattern = stringValue(args.pattern);
      const mapped = fileSearchTool({ query: pattern, glob: pattern });
      if (mapped !== undefined) return mapped;
      break;
    }
    case "WebFetch": {
      const url = stringValue(args.url);
      if (url !== undefined) return { tool: "web_fetch", args: { url } };
      break;
    }
    case "WebSearch": {
      const query = stringValue(args.query);
      if (query !== undefined) return { tool: "web_search", args: { query } };
      break;
    }
    case "ToolSearch": {
      const query = stringValue(args.query) ?? stringValue(args.q);
      if (query !== undefined) {
        return {
          tool: "tool_search",
          args: {
            query,
            ...(maybeNumber(args.limit) !== undefined ? { limit: maybeNumber(args.limit) } : {}),
          },
        };
      }
      break;
    }
    case "Task":
    case "Agent": {
      const task =
        stringValue(args.prompt) ?? stringValue(args.description) ?? stringValue(args.name);
      if (task !== undefined) {
        const sessionId = agentTrailId(args.session_id);
        const mapped = subagentInvokeTool({
          task,
          agentType: stringValue(args.subagent_type),
          sessionId,
        });
        if (mapped !== undefined) return mapped;
      }
      break;
    }
  }
  return otherTool(name, input);
}
