// Match the canonical apply_patch envelope marker. Patches look like:
//   *** Begin Patch
//   *** Update File: <path>
//   @@ ...
//   *** End Patch
// Three verbs cover create / modify / delete: Update, Add, Delete.
const PATCH_FILE_MARKER = /^\*\*\* (Update|Add|Delete) File: (.+)$/gm;
type PatchAction = "Update" | "Add" | "Delete";

/**
 * @internal
 */
export type PatchFile = {
  path: string;
  diff: string;
};

function endPatchIndex(input: string, start: number): number {
  const tail = input.slice(start);
  const match = tail.match(/^\*\*\* End Patch\b/m);
  return match?.index === undefined ? -1 : start + match.index;
}

function countPrefixedLines(lines: string[], prefix: string): number {
  return lines.filter((line) => line.startsWith(prefix)).length;
}

function normalizePatchBody(action: PatchAction, body: string): string {
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

function patchAction(value: string | undefined): PatchAction | undefined {
  return value === "Update" || value === "Add" || value === "Delete" ? value : undefined;
}

function patchFileFromMatch(
  match: RegExpMatchArray,
): { action: PatchAction; path: string } | undefined {
  const action = patchAction(match[1]);
  const path = match[2]?.trim();
  if (action === undefined || path === undefined || path.length === 0) return undefined;
  return { action, path };
}

function patchBody(input: string, matches: RegExpMatchArray[], index: number): string {
  const match = matches[index] as RegExpMatchArray;
  const matchIndex = match.index;
  if (matchIndex === undefined) return "";
  const start = matchIndex + match[0].length;
  const end = matches[index + 1]?.index ?? endPatchIndex(input, start);
  return input.slice(start, end === -1 ? undefined : end).trim();
}

function patchMoveTarget(body: string, fallbackPath: string): string {
  const moveTo = body.match(/^\*\*\* Move to: (.+)$/m)?.[1]?.trim();
  return moveTo && moveTo.length > 0 ? moveTo : fallbackPath;
}

function patchDiff(action: PatchAction, path: string, newPath: string, body: string): string {
  const oldHeader = action === "Add" ? "/dev/null" : `a/${path}`;
  const newHeader = action === "Delete" ? "/dev/null" : `b/${newPath}`;
  const diffBody = normalizePatchBody(action, body);
  return [`--- ${oldHeader}`, `+++ ${newHeader}`, diffBody]
    .filter((part) => part.length > 0)
    .join("\n");
}

/**
 * @internal
 */
export function patchFiles(input: string): PatchFile[] {
  const matches = [...input.matchAll(PATCH_FILE_MARKER)];
  const files: PatchFile[] = [];
  for (const [index, match] of matches.entries()) {
    const parsed = patchFileFromMatch(match);
    if (parsed === undefined) continue;
    const body = patchBody(input, matches, index);
    const newPath = patchMoveTarget(body, parsed.path);
    files.push({
      path: newPath,
      diff: patchDiff(parsed.action, parsed.path, newPath, body),
    });
  }
  return files;
}
