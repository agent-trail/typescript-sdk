import type { Entry } from "@agent-trail/types";
import { deriveSynthesizedEntryId } from "./session-uid.js";

export type GitCommitEventData = {
  sha: string;
  tool_call_id: string;
  branch?: string;
  message?: string;
  repo?: string;
};

type ExtractGitCommitEventsInput = {
  command: string;
  output: string;
  toolCallId: string;
  repo?: string | undefined;
};

type SynthesizeVcsCommitEventsOptions = {
  idNamespace: string;
  repo?: string | undefined;
};

const GIT_COMMIT_SUMMARY_PATTERN =
  /^\[(?<ref>.+?)(?:\s+\(root-commit\))?\s+(?<sha>[a-fA-F0-9]{7,64})\]\s?(?<message>.*)$/;
const ENV_ASSIGNMENT_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*=.*/;

type ShellCommandShape = {
  hasUnsafeSeparator: boolean;
  segments: string[][];
};

type ShellParserState = {
  current: string[];
  escaped: boolean;
  hasUnsafeSeparator: boolean;
  quote: "'" | '"' | undefined;
  segments: string[][];
  token: string;
};

function shellCommandShape(command: string): ShellCommandShape {
  const state: ShellParserState = {
    current: [],
    escaped: false,
    hasUnsafeSeparator: false,
    quote: undefined,
    segments: [],
    token: "",
  };
  for (let index = 0; index < command.length; index += 1) {
    index = parseShellCommandChar(state, command, index);
  }
  endShellSegment(state);
  return { hasUnsafeSeparator: state.hasUnsafeSeparator, segments: state.segments };
}

function parseShellCommandChar(state: ShellParserState, command: string, index: number): number {
  const char = command[index];
  if (char === undefined) return index;
  if (consumeEscapedChar(state, char)) return index;
  if (startEscape(state, char)) return index;
  if (consumeQuotedChar(state, char)) return index;
  if (startQuote(state, char)) return index;
  if (isLineBreak(char)) return endLineSegment(state, command, index);
  if (/\s/.test(char)) {
    pushShellToken(state);
    return index;
  }
  if (isShellSeparator(char)) return endSeparatorSegment(state, command, index);
  state.token += char;
  return index;
}

function pushShellToken(state: ShellParserState): void {
  if (state.token.length === 0) return;
  state.current.push(state.token);
  state.token = "";
}

function endShellSegment(state: ShellParserState): void {
  pushShellToken(state);
  if (state.current.length === 0) return;
  state.segments.push(state.current);
  state.current = [];
}

function consumeEscapedChar(state: ShellParserState, char: string): boolean {
  if (!state.escaped) return false;
  state.token += char;
  state.escaped = false;
  return true;
}

function startEscape(state: ShellParserState, char: string): boolean {
  if (char !== "\\") return false;
  state.escaped = true;
  return true;
}

function consumeQuotedChar(state: ShellParserState, char: string): boolean {
  if (state.quote === undefined) return false;
  if (char === state.quote) {
    state.quote = undefined;
  } else {
    state.token += char;
  }
  return true;
}

function startQuote(state: ShellParserState, char: string): boolean {
  if (char !== "'" && char !== '"') return false;
  state.quote = char;
  return true;
}

function isLineBreak(char: string): boolean {
  return char === "\n" || char === "\r";
}

function endLineSegment(state: ShellParserState, command: string, index: number): number {
  endShellSegment(state);
  return command[index] === "\r" && command[index + 1] === "\n" ? index + 1 : index;
}

function isShellSeparator(char: string): boolean {
  return char === ";" || char === "(" || char === ")" || char === "|" || char === "&";
}

function endSeparatorSegment(state: ShellParserState, command: string, index: number): number {
  const char = command[index];
  const next = command[index + 1];
  state.hasUnsafeSeparator ||= unsafeShellSeparator(char, next);
  endShellSegment(state);
  return compoundShellSeparator(char, next) ? index + 1 : index;
}

function compoundShellSeparator(char: string | undefined, next: string | undefined): boolean {
  return (char === "&" && next === "&") || (char === "|" && next === "|");
}

function unsafeShellSeparator(char: string | undefined, next: string | undefined): boolean {
  if (char === "|" || char === "(" || char === ")") return true;
  return char === "&" && !compoundShellSeparator(char, next);
}

function gitSubcommandIndex(tokens: string[], gitIndex: number): number | undefined {
  let index = gitIndex + 1;
  while (index < tokens.length) {
    const token = tokens[index];
    if (token === undefined) return undefined;
    if (gitOptionConsumesValue(token)) {
      index += 2;
      continue;
    }
    if (gitFlagBeforeSubcommand(token)) {
      index += 1;
      continue;
    }
    return index;
  }
  return undefined;
}

function gitOptionConsumesValue(token: string): boolean {
  return ["-C", "-c", "--git-dir", "--work-tree", "--namespace"].includes(token);
}

function gitFlagBeforeSubcommand(token: string): boolean {
  return (
    token === "--no-pager" ||
    token === "--bare" ||
    token.startsWith("-c") ||
    token.startsWith("--git-dir=") ||
    token.startsWith("--work-tree=") ||
    token.startsWith("--namespace=")
  );
}

type GitCommandInfo = {
  subcommand: string;
  args: string[];
};

function gitCommandInfo(segment: string[]): GitCommandInfo | undefined {
  let commandIndex = 0;
  while (ENV_ASSIGNMENT_PATTERN.test(segment[commandIndex] ?? "")) commandIndex += 1;
  if (segment[commandIndex] === "command") commandIndex += 1;
  const executable = segment[commandIndex];
  if (executable !== "git" && executable?.endsWith("/git") !== true) return undefined;
  const subcommandIndex = gitSubcommandIndex(segment, commandIndex);
  if (subcommandIndex === undefined) return undefined;
  const subcommand = segment[subcommandIndex];
  if (subcommand === undefined) return undefined;
  return {
    subcommand,
    args: segment.slice(subcommandIndex + 1),
  };
}

function isSafeWrapperSegment(segment: string[]): boolean {
  let commandIndex = 0;
  while (ENV_ASSIGNMENT_PATTERN.test(segment[commandIndex] ?? "")) commandIndex += 1;
  return segment[commandIndex] === "cd";
}

function hasQuietFlag(args: string[]): boolean {
  return args.some((arg) => {
    if (arg === "--quiet" || arg === "-q") return true;
    return arg.startsWith("-") && !arg.startsWith("--") && arg.slice(1).includes("q");
  });
}

function eligibleGitCommitInvocationCount(command: string): number {
  const shape = shellCommandShape(command);
  if (shape.hasUnsafeSeparator) return 0;
  let count = 0;
  for (const segment of shape.segments) {
    const commitCount = eligibleSegmentCommitCount(segment);
    if (commitCount === undefined) return 0;
    count += commitCount;
  }
  return count;
}

function eligibleSegmentCommitCount(segment: string[]): number | undefined {
  const git = gitCommandInfo(segment);
  if (git === undefined) return isSafeWrapperSegment(segment) ? 0 : undefined;
  if (git.subcommand === "add") return 0;
  if (git.subcommand !== "commit" || hasQuietFlag(git.args)) return undefined;
  return 1;
}

export function extractGitCommitEvents(input: ExtractGitCommitEventsInput): GitCommitEventData[] {
  const invocationCount = eligibleGitCommitInvocationCount(input.command);
  if (invocationCount === 0) return [];
  const commits: GitCommitEventData[] = [];
  for (const line of input.output.split(/\r?\n/)) {
    const match = GIT_COMMIT_SUMMARY_PATTERN.exec(line.trimEnd());
    if (match === null) continue;
    const { ref, sha, message } = match.groups ?? {};
    if (ref === undefined || sha === undefined || message === undefined) continue;
    commits.push({
      sha: sha.toLowerCase(),
      tool_call_id: input.toolCallId,
      branch: ref,
      message,
      ...(input.repo !== undefined ? { repo: input.repo } : {}),
    });
  }
  return commits.length === invocationCount ? commits : [];
}

function objectPayload(entry: Entry): Record<string, unknown> {
  return entry.payload !== null && typeof entry.payload === "object"
    ? (entry.payload as Record<string, unknown>)
    : {};
}

function commandFromToolCall(entry: Entry): string | undefined {
  if (entry.type !== "tool_call") return undefined;
  const payload = objectPayload(entry);
  if (payload.tool !== "shell_command") return undefined;
  const args = payload.args;
  if (args === null || typeof args !== "object") return undefined;
  const command = (args as Record<string, unknown>).command;
  return typeof command === "string" ? command : undefined;
}

function sourceForCommit(result: Entry): Entry["source"] {
  const source = result.source;
  const originalType =
    typeof source?.original_type === "string" ? `${source.original_type}.vcs_commit` : "vcs_commit";
  return {
    ...(source?.agent !== undefined ? { agent: source.agent } : {}),
    original_type: originalType,
    ...(source?.schema_version !== undefined ? { schema_version: source.schema_version } : {}),
    synthesized: true,
  };
}

type SeenCall = Entry | "ambiguous";

type VcsCommitSynthesisState = {
  callsById: Map<string, Entry>;
  callsByNativeId: Map<string, SeenCall>;
  out: Entry[];
  reparentNextChild:
    | {
        parentId: string;
        replacementParentId: string;
      }
    | undefined;
};

export function synthesizeVcsCommitEvents(
  entries: Entry[],
  options: SynthesizeVcsCommitEventsOptions,
): Entry[] {
  const state: VcsCommitSynthesisState = {
    callsById: new Map(),
    callsByNativeId: new Map(),
    out: [],
    reparentNextChild: undefined,
  };
  for (const entry of entries) {
    processVcsCommitEntry(reparentedEntry(state, entry), state, options);
  }
  return state.out;
}

function reparentedEntry(state: VcsCommitSynthesisState, entry: Entry): Entry {
  const pending = state.reparentNextChild;
  state.reparentNextChild = undefined;
  if (pending === undefined || entry.parent_id !== pending.parentId) return entry;
  return { ...entry, parent_id: pending.replacementParentId } as Entry;
}

function processVcsCommitEntry(
  current: Entry,
  state: VcsCommitSynthesisState,
  options: SynthesizeVcsCommitEventsOptions,
): void {
  state.out.push(current);
  if (rememberShellToolCall(state, current)) return;
  const result = successfulShellResult(current);
  if (result === undefined) return;
  const call = matchingShellToolCall(state, result);
  const command = call === undefined ? undefined : commandFromToolCall(call);
  if (call === undefined || command === undefined) return;
  appendCommitEntries(state, current, call, command, result.output, options);
}

function rememberShellToolCall(state: VcsCommitSynthesisState, entry: Entry): boolean {
  if (commandFromToolCall(entry) === undefined) return false;
  state.callsById.set(entry.id, entry);
  const nativeCallId = entry.semantic?.call_id;
  if (nativeCallId !== undefined) {
    state.callsByNativeId.set(
      nativeCallId,
      state.callsByNativeId.has(nativeCallId) ? "ambiguous" : entry,
    );
  }
  return true;
}

function successfulShellResult(
  entry: Entry,
): { forId?: string; nativeCallId?: string; output: string } | undefined {
  if (entry.type !== "tool_result") return undefined;
  const payload = objectPayload(entry);
  if (payload.ok !== true || typeof payload.output !== "string") return undefined;
  return {
    ...(typeof payload.for_id === "string" ? { forId: payload.for_id } : {}),
    ...(entry.semantic?.call_id !== undefined ? { nativeCallId: entry.semantic.call_id } : {}),
    output: payload.output,
  };
}

function matchingShellToolCall(
  state: VcsCommitSynthesisState,
  result: { forId?: string; nativeCallId?: string },
): Entry | undefined {
  const byForId = result.forId === undefined ? undefined : state.callsById.get(result.forId);
  const nativeMatch =
    result.nativeCallId === undefined ? undefined : state.callsByNativeId.get(result.nativeCallId);
  const byNativeId = nativeMatch === "ambiguous" ? undefined : nativeMatch;
  return byForId ?? byNativeId;
}

function appendCommitEntries(
  state: VcsCommitSynthesisState,
  result: Entry,
  call: Entry,
  command: string,
  output: string,
  options: SynthesizeVcsCommitEventsOptions,
): void {
  const commits = extractGitCommitEvents({
    command,
    output,
    toolCallId: call.id,
    repo: options.repo,
  });
  const finalParentId = appendCommitEntryChain(state.out, result, commits, options.idNamespace);
  if (finalParentId !== undefined) {
    state.reparentNextChild = { parentId: result.id, replacementParentId: finalParentId };
  }
}

function appendCommitEntryChain(
  out: Entry[],
  result: Entry,
  commits: GitCommitEventData[],
  idNamespace: string,
): string | undefined {
  let parentId = result.id;
  for (const [index, commit] of commits.entries()) {
    const commitEntry = vcsCommitEntry(result, parentId, commit, index, idNamespace);
    out.push(commitEntry);
    parentId = commitEntry.id;
  }
  return commits.length > 0 ? parentId : undefined;
}

function vcsCommitEntry(
  result: Entry,
  parentId: string,
  commit: GitCommitEventData,
  index: number,
  idNamespace: string,
): Entry {
  const nativeCallId = result.semantic?.call_id;
  return {
    type: "system_event",
    id: deriveSynthesizedEntryId(idNamespace, ["vcs_commit", result.id, commit.sha, String(index)]),
    ts: result.ts,
    payload: { kind: "vcs_commit", data: commit },
    parent_id: parentId,
    ...(nativeCallId !== undefined ? { semantic: { call_id: nativeCallId } } : {}),
    source: sourceForCommit(result),
  } as Entry;
}
