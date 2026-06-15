import { coerceInt as maybeNumber } from "@agent-trail/adapter-kit";
import {
  fileListTool,
  fileReadTool,
  fileSearchTool,
  fileWriteTool,
  otherTool,
  patchFiles,
  replacementEditTool,
  shellCommandTool,
  stringArrayValue,
} from "../shared/tool-normalizer.js";
import { isObject, jsonObjectValue, stringValue } from "./source.js";

// Pi's built-in tools (pi-mono `coding-agent/src/core/tools/`): bash, read, write, edit,
// grep, find, ls. Mapped to canonical kinds (spec §11). MCP-extension tools real Pi
// sessions also carry fall through to the `other` escape hatch (spec §11.7).
export function toolKindAndArgs(
  name: string | undefined,
  input: unknown,
): {
  tool: string;
  args: object;
} {
  const args = jsonObjectValue(input) ?? {};
  switch (name) {
    case "read": {
      const mapped = fileReadTool(args, ["path", "file_path"]);
      if (mapped !== undefined) return mapped;
      break;
    }
    case "write": {
      const mapped = fileWriteTool(args, ["path", "file_path"]);
      if (mapped !== undefined) return mapped;
      break;
    }
    case "edit": {
      // Pi `edit` arguments empirically come in four shapes:
      //   single-replace:  { path, oldText, newText }
      //   multi-replace:   { multi: [{ path, oldText, newText }, ...] }   (path is per-entry)
      //   edits-array:     { path, edits: [{ oldText, newText }, ...] }   (current pi-mono schema)
      //   apply_patch:     { patch: "*** Begin Patch\n*** Update File: ...\n..." }
      // One-hunk replacement shapes map to spec §11.1 `file_edit` replacement
      // args. Multi-hunk/no-line-context shapes fall through to `other` so we
      // do not fabricate diff hunk headers. Real patch text still maps to
      // `file_edit`/`file_patch`.
      const topPath = stringValue(args.path) ?? stringValue(args.file_path);
      const editsArray = Array.isArray(args.edits) ? args.edits : undefined;
      if (editsArray !== undefined && topPath !== undefined) {
        const hunks: Array<{ oldText: string; newText: string }> = [];
        for (const e of editsArray) {
          if (!isObject(e)) continue;
          const oldText = stringValue(e.oldText) ?? stringValue(e.old_text);
          const newText = stringValue(e.newText) ?? stringValue(e.new_text);
          if (oldText !== undefined || newText !== undefined) {
            hunks.push({ oldText: oldText ?? "", newText: newText ?? "" });
          }
        }
        if (hunks.length > 0) {
          if (hunks.length === 1) {
            const [hunk] = hunks;
            if (hunk === undefined) break;
            return replacementEditTool({
              path: topPath,
              oldText: hunk.oldText,
              newText: hunk.newText,
            }) as { tool: string; args: object };
          }
          break;
        }
        break;
      }
      const multi = Array.isArray(args.multi) ? args.multi : undefined;
      if (multi !== undefined && multi.length > 0) {
        const editsByPath = new Map<string, Array<{ oldText: string; newText: string }>>();
        let bad = false;
        for (const e of multi) {
          if (!isObject(e)) {
            bad = true;
            break;
          }
          const p = stringValue(e.path) ?? topPath;
          if (p === undefined) {
            bad = true;
            break;
          }
          const oldText = stringValue(e.oldText) ?? stringValue(e.old_text);
          const newText = stringValue(e.newText) ?? stringValue(e.new_text);
          if (oldText === undefined && newText === undefined) continue;
          const arr = editsByPath.get(p) ?? [];
          arr.push({ oldText: oldText ?? "", newText: newText ?? "" });
          editsByPath.set(p, arr);
        }
        if (!bad && editsByPath.size > 1) break;
        if (!bad && editsByPath.size === 1) {
          const [path, hunks] = [...editsByPath.entries()][0] as [
            string,
            Array<{ oldText: string; newText: string }>,
          ];
          if (hunks.length > 0) {
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
      const patch = stringValue(args.patch);
      if (patch !== undefined) {
        const files = patchFiles(patch);
        if (files.length > 1) return { tool: "file_patch", args: { files, atomic: true } };
        if (files.length === 1) {
          const file = files[0];
          if (file !== undefined) return { tool: "file_edit", args: file };
        }
        break;
      }
      if (topPath !== undefined) {
        const oldText = stringValue(args.oldText) ?? stringValue(args.oldString);
        const newText = stringValue(args.newText) ?? stringValue(args.newString);
        const mapped = replacementEditTool({ path: topPath, oldText, newText });
        if (mapped !== undefined) return mapped;
      }
      break;
    }
    case "bash": {
      // Defensive arg shapes (real Pi sessions): `{command: "..."}`, `{cmd: "..."}`, and
      // `{command: ["bash", "-lc", "..."]}` (argv-style). Quote argv entries with shell-special
      // chars so the canonical `args.command` string round-trips through a POSIX shell.
      const commandArray = stringArrayValue(args.command);
      const mapped = shellCommandTool({
        command: stringValue(args.command) ?? stringValue(args.cmd) ?? commandArray,
        cwd: stringValue(args.cwd),
        timeout: maybeNumber(args.timeout),
      });
      if (mapped !== undefined) return mapped;
      break;
    }
    case "grep": {
      const mapped = fileSearchTool({
        query: stringValue(args.pattern),
        path: stringValue(args.path),
        glob: stringValue(args.glob),
      });
      if (mapped !== undefined) return mapped;
      break;
    }
    case "find": {
      const mapped = fileSearchTool({
        query: stringValue(args.pattern),
        path: stringValue(args.path),
      });
      if (mapped !== undefined) return mapped;
      break;
    }
    case "ls": {
      return fileListTool(stringValue(args.path));
    }
  }
  return otherTool(name, input);
}
