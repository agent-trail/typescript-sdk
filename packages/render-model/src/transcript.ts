import type {
  ActiveFilters,
  EventFilter,
  RenderEvent,
  ToolTranscriptItem,
  TranscriptItem,
} from "./types.js";
import { truncatePreview } from "./values.js";

type UngroupedTranscriptItem = Exclude<TranscriptItem, { kind: "tool_group" }>;
type TranscriptBuildItem = UngroupedTranscriptItem | { kind: "separator" };

type ToolCallCandidate = {
  branchScope: string;
  id: string;
  matched: boolean;
  parentId?: string;
  semanticCallId?: string;
};

type ToolResultCandidate = {
  branchScope: string;
  callIndex: number;
  canExplicitMatch: boolean;
  canFallback: boolean;
  eventIndex: number;
  forId?: string;
  matched: boolean;
  parentId?: string;
  semanticCallId?: string;
};

type PairingRange = {
  calls: ToolCallCandidate[];
  callById: Map<string, ToolCallCandidate>;
  results: ToolResultCandidate[];
};

type TranscriptState = {
  pairedCallIdByEventIndex: Map<number, string>;
  currentRunCallItems: Map<string, ToolTranscriptItem>;
  items: TranscriptBuildItem[];
};

/** Filter metadata for viewer controls.
 *
 * @public
 */
export const FILTERS: { filter: EventFilter; label: string; shortLabel: string }[] = [
  { filter: "user", label: "User messages", shortLabel: "U" },
  { filter: "agent", label: "Agent response messages", shortLabel: "A" },
  { filter: "thinking", label: "Agent thinking messages", shortLabel: "Th" },
  { filter: "tool", label: "Tool calls", shortLabel: "T" },
];

/** Default transcript filters.
 *
 * @public
 */
export const DEFAULT_FILTERS: ActiveFilters = {
  agent: true,
  thinking: true,
  tool: true,
  user: true,
};

/** Build unfiltered transcript items from render events.
 *
 * @public
 */
export function buildTranscriptItems(events: RenderEvent[]): TranscriptItem[] {
  const state: TranscriptState = {
    currentRunCallItems: new Map(),
    items: [],
    pairedCallIdByEventIndex: pairToolLifecycleEvents(events),
  };

  for (let eventIndex = 0; eventIndex < events.length; eventIndex += 1) {
    appendTranscriptEvent(state, events, eventIndex);
  }
  return groupConsecutiveToolItems(state.items);
}

/** Apply transcript filters to already-built transcript items.
 *
 * @public
 */
export function filterTranscriptItems(
  items: readonly TranscriptItem[],
  activeFilters: ActiveFilters,
): TranscriptItem[] {
  return items.filter((item) => {
    if (item.kind === "tool" || item.kind === "tool_group") return activeFilters.tool;
    return activeFilters[filterForEvent(item.event)];
  });
}

function appendTranscriptEvent(
  state: TranscriptState,
  events: readonly RenderEvent[],
  eventIndex: number,
): void {
  const event = events[eventIndex];
  if (event === undefined) return;
  appendSessionSeparatorIfNeeded(state, events, eventIndex, event);

  const item = transcriptBuildItemForEvent(state, event, eventIndex);
  if (item === undefined) return;
  if (item.kind === "separator") clearCurrentToolRun(state);
  state.items.push(item);
}

function appendSessionSeparatorIfNeeded(
  state: TranscriptState,
  events: readonly RenderEvent[],
  eventIndex: number,
  event: RenderEvent,
): void {
  if (events[eventIndex - 1]?.sessionIndex === event.sessionIndex) return;
  clearCurrentToolRun(state);
  state.items.push({ kind: "separator" });
}

function transcriptBuildItemForEvent(
  state: TranscriptState,
  event: RenderEvent,
  eventIndex: number,
): TranscriptBuildItem | undefined {
  if (event.kind === "user") return clearAndReturn(state, { kind: "user", event });
  if (event.kind === "agent") return clearAndReturn(state, { kind: "agent", event });
  if (event.kind === "tool_call") return toolCallItem(state, event);
  if (event.kind === "tool_result") return toolResultItem(state, event, eventIndex);
  if (event.kind === "tool_aborted") return toolAbortItem(state, event, eventIndex);
  return { kind: "separator" };
}

function clearAndReturn<T extends TranscriptBuildItem>(state: TranscriptState, item: T): T {
  clearCurrentToolRun(state);
  return item;
}

function toolCallItem(state: TranscriptState, event: RenderEvent): ToolTranscriptItem {
  const item: ToolTranscriptItem = { kind: "tool", call: event };
  if (event.id !== null) state.currentRunCallItems.set(event.id, item);
  return item;
}

function toolResultItem(
  state: TranscriptState,
  event: RenderEvent,
  eventIndex: number,
): ToolTranscriptItem | undefined {
  const callItem = currentCallItemForEvent(state, eventIndex);
  if (callItem !== undefined && callItem.result === undefined) {
    callItem.result = event;
    return undefined;
  }
  return { kind: "tool", result: event };
}

function toolAbortItem(
  state: TranscriptState,
  event: RenderEvent,
  eventIndex: number,
): ToolTranscriptItem | undefined {
  const callItem = currentCallItemForEvent(state, eventIndex);
  if (callItem !== undefined && callItem.abort === undefined) {
    callItem.abort = event;
    return undefined;
  }
  return { kind: "tool", abort: event };
}

function currentCallItemForEvent(
  state: TranscriptState,
  eventIndex: number,
): ToolTranscriptItem | undefined {
  const pairedCallId = state.pairedCallIdByEventIndex.get(eventIndex);
  return pairedCallId === undefined ? undefined : state.currentRunCallItems.get(pairedCallId);
}

function clearCurrentToolRun(state: TranscriptState): void {
  state.currentRunCallItems.clear();
}

function pairToolLifecycleEvents(events: readonly RenderEvent[]): Map<number, string> {
  const pairedCallIdByEventIndex = new Map<number, string>();
  for (const [start, end] of sessionRanges(events)) {
    pairToolLifecycleEventsInRange(events, start, end, pairedCallIdByEventIndex);
  }
  return pairedCallIdByEventIndex;
}

function sessionRanges(events: readonly RenderEvent[]): [number, number][] {
  const ranges: [number, number][] = [];
  let sessionStart = 0;
  while (sessionStart < events.length) {
    const sessionIndex = events[sessionStart]?.sessionIndex;
    let sessionEnd = sessionStart + 1;
    while (sessionEnd < events.length && events[sessionEnd]?.sessionIndex === sessionIndex) {
      sessionEnd += 1;
    }
    ranges.push([sessionStart, sessionEnd]);
    sessionStart = sessionEnd;
  }
  return ranges;
}

function pairToolLifecycleEventsInRange(
  events: readonly RenderEvent[],
  start: number,
  end: number,
  pairedCallIdByEventIndex: Map<number, string>,
): void {
  const range = collectPairingRange(events, start, end);
  applyExplicitMatches(range, pairedCallIdByEventIndex);
  applySemanticMatches(range, pairedCallIdByEventIndex);
  applySequentialMatches(range, pairedCallIdByEventIndex);
}

function collectPairingRange(
  events: readonly RenderEvent[],
  start: number,
  end: number,
): PairingRange {
  const graph = eventGraphForRange(events, start, end);
  const range: PairingRange = { callById: new Map(), calls: [], results: [] };
  for (let eventIndex = start; eventIndex < end; eventIndex += 1) {
    const event = events[eventIndex];
    if (event === undefined) continue;
    collectPairingEvent(range, event, eventIndex, graph);
  }
  return range;
}

function eventGraphForRange(
  events: readonly RenderEvent[],
  start: number,
  end: number,
): {
  childCounts: Map<string, number>;
  eventById: Map<string, RenderEvent>;
} {
  const eventById = new Map<string, RenderEvent>();
  const childCounts = new Map<string, number>();
  for (let eventIndex = start; eventIndex < end; eventIndex += 1) {
    const event = events[eventIndex];
    if (event === undefined) continue;
    if (event.id !== null) eventById.set(event.id, event);
    if (event.parentId !== undefined) {
      childCounts.set(event.parentId, (childCounts.get(event.parentId) ?? 0) + 1);
    }
  }
  return { childCounts, eventById };
}

function collectPairingEvent(
  range: PairingRange,
  event: RenderEvent,
  eventIndex: number,
  graph: {
    childCounts: Map<string, number>;
    eventById: Map<string, RenderEvent>;
  },
): void {
  if (event.kind === "tool_call") {
    collectToolCall(range, event, graph);
    return;
  }
  if (event.kind === "tool_result" || event.kind === "tool_aborted") {
    collectToolResult(range, event, eventIndex, graph);
  }
}

function collectToolCall(
  range: PairingRange,
  event: RenderEvent,
  graph: {
    childCounts: Map<string, number>;
    eventById: Map<string, RenderEvent>;
  },
): void {
  if (event.id === null) return;
  const call = {
    branchScope: branchScopeFor(event, graph.eventById, graph.childCounts),
    id: event.id,
    matched: false,
    ...optionalParentIdForPair(event.parentId),
    ...optionalSemanticCallIdForPair(event.tool?.semanticCallId),
  };
  range.calls.push(call);
  range.callById.set(call.id, call);
}

function collectToolResult(
  range: PairingRange,
  event: RenderEvent,
  eventIndex: number,
  graph: {
    childCounts: Map<string, number>;
    eventById: Map<string, RenderEvent>;
  },
): void {
  range.results.push({
    branchScope: branchScopeFor(event, graph.eventById, graph.childCounts),
    callIndex: range.calls.length,
    canExplicitMatch: event.kind === "tool_result" || event.tool?.scope === "tool_call",
    canFallback: event.kind === "tool_result",
    eventIndex,
    matched: false,
    ...optionalForIdForPair(event.tool?.forId),
    ...optionalParentIdForPair(event.parentId),
    ...optionalSemanticCallIdForPair(
      event.kind === "tool_result" ? event.tool?.semanticCallId : undefined,
    ),
  });
}

function applyExplicitMatches(
  range: PairingRange,
  pairedCallIdByEventIndex: Map<number, string>,
): void {
  for (const result of range.results) {
    if (!result.canExplicitMatch || result.forId === undefined) continue;
    const call = range.callById.get(result.forId);
    if (call === undefined) continue;
    markMatched(call, result, pairedCallIdByEventIndex);
  }
}

function applySemanticMatches(
  range: PairingRange,
  pairedCallIdByEventIndex: Map<number, string>,
): void {
  const callsBySemanticCallId = unmatchedCallsBySemanticCallId(range.calls);
  for (const result of range.results) {
    if (result.matched || !result.canFallback || result.semanticCallId === undefined) continue;
    const call = callsBySemanticCallId.get(result.semanticCallId)?.shift();
    if (call !== undefined) markMatched(call, result, pairedCallIdByEventIndex);
  }
}

function unmatchedCallsBySemanticCallId(
  calls: readonly ToolCallCandidate[],
): Map<string, ToolCallCandidate[]> {
  const callsBySemanticCallId = new Map<string, ToolCallCandidate[]>();
  for (const call of calls) {
    if (call.matched || call.semanticCallId === undefined) continue;
    const bucket = callsBySemanticCallId.get(call.semanticCallId);
    if (bucket === undefined) {
      callsBySemanticCallId.set(call.semanticCallId, [call]);
    } else {
      bucket.push(call);
    }
  }
  return callsBySemanticCallId;
}

function applySequentialMatches(
  range: PairingRange,
  pairedCallIdByEventIndex: Map<number, string>,
): void {
  for (const result of range.results) {
    if (result.matched || !result.canFallback) continue;
    const call = closestSequentialCandidate(range.calls, result);
    if (call !== undefined) markMatched(call, result, pairedCallIdByEventIndex);
  }
}

function closestSequentialCandidate(
  calls: readonly ToolCallCandidate[],
  result: ToolResultCandidate,
): ToolCallCandidate | undefined {
  for (let index = result.callIndex - 1; index >= 0; index -= 1) {
    const call = calls[index];
    if (call === undefined || call.matched) continue;
    if (isSequentialCandidate(call, result)) return call;
  }
  return undefined;
}

function markMatched(
  call: ToolCallCandidate,
  result: ToolResultCandidate,
  pairedCallIdByEventIndex: Map<number, string>,
): void {
  result.matched = true;
  pairedCallIdByEventIndex.set(result.eventIndex, call.id);
  if (!call.matched) call.matched = true;
}

function optionalForIdForPair(forId: string | undefined): { forId?: string } {
  return forId === undefined ? {} : { forId };
}

function optionalParentIdForPair(parentId: string | undefined): { parentId?: string } {
  return parentId === undefined ? {} : { parentId };
}

function optionalSemanticCallIdForPair(semanticCallId: string | undefined): {
  semanticCallId?: string;
} {
  return semanticCallId === undefined ? {} : { semanticCallId };
}

function isSequentialCandidate(
  call: { branchScope: string; parentId?: string },
  result: { branchScope: string; parentId?: string },
): boolean {
  return (
    call.branchScope === result.branchScope ||
    (call.parentId !== undefined && call.parentId === result.parentId)
  );
}

function branchScopeFor(
  event: RenderEvent,
  eventById: Map<string, RenderEvent>,
  childCounts: Map<string, number>,
): string {
  let current = event;
  const seen = new Set<string>();

  while (true) {
    const parentId = current.parentId;
    if (parentId === undefined || seen.has(parentId)) return "root";
    seen.add(parentId);

    const parent = eventById.get(parentId);
    if (parent === undefined) return "root";
    if ((childCounts.get(parentId) ?? 0) > 1) {
      return current.id === null ? `branch:${parentId}` : `branch:${parentId}:${current.id}`;
    }
    if (isSubagentInvoke(parent)) return `subagent:${parentId}`;

    current = parent;
  }
}

function isSubagentInvoke(event: RenderEvent): boolean {
  return event.kind === "tool_call" && event.tool?.name === "subagent_invoke";
}

function groupConsecutiveToolItems(items: TranscriptBuildItem[]): TranscriptItem[] {
  const grouped: TranscriptItem[] = [];
  let pendingTools: ToolTranscriptItem[] = [];

  const flushTools = () => {
    const firstTool = pendingTools[0];
    if (pendingTools.length === 1 && firstTool !== undefined) {
      grouped.push(firstTool);
    } else if (pendingTools.length > 1) {
      grouped.push({ kind: "tool_group", items: pendingTools });
    }
    pendingTools = [];
  };

  for (const item of items) {
    if (item.kind === "tool") {
      pendingTools.push(item);
      continue;
    }
    flushTools();
    if (item.kind !== "separator") grouped.push(item);
  }
  flushTools();
  return grouped;
}

/** Stable anchor fragment for a transcript item.
 *
 * @public
 */
export function renderItemAnchor(item: TranscriptItem): string {
  if (item.kind === "tool_group") {
    const firstItem = item.items[0];
    return firstItem === undefined ? "event-unknown" : renderItemAnchor(firstItem);
  }
  const event = item.kind === "tool" ? (item.call ?? item.result ?? item.abort) : item.event;
  return `event-${event?.line ?? "unknown"}`;
}

/** Stable key for rendering a transcript item list.
 *
 * @public
 */
export function renderItemKey(item: TranscriptItem, index: number): string {
  if (item.kind === "tool_group")
    return `tool_group:${renderItemAnchor(item)}:${item.items.length}`;
  const event = item.kind === "tool" ? (item.call ?? item.result ?? item.abort) : item.event;
  return `${item.kind}:${event?.line ?? index}:${event?.id ?? index}`;
}

/** Compact label for a transcript item.
 *
 * @public
 */
export function renderItemLabel(item: TranscriptItem): string {
  if (item.kind === "tool_group") return "Tools";
  if (item.kind === "tool") return "Tool";
  if (item.kind === "agent" && isThinkingEvent(item.event)) return "Think";
  return item.kind;
}

/** Compact preview text for a transcript item.
 *
 * @public
 */
export function renderItemPreview(item: TranscriptItem): string {
  if (item.kind === "tool_group") return `${item.items.length} grouped tool calls...`;
  if (item.kind === "tool") {
    const primary = item.call ?? item.result ?? item.abort;
    return truncatePreview(`${primary?.title ?? "Tool event"} ${primary?.body ?? ""}`);
  }
  return truncatePreview(item.event.body ?? item.event.title);
}

/** Timestamp for a grouped tool item, using its first child event.
 *
 * @public
 */
export function toolGroupTimestamp(
  item: Extract<TranscriptItem, { kind: "tool_group" }>,
): string | null {
  const firstItem = item.items[0];
  return firstItem === undefined
    ? null
    : ((firstItem.call ?? firstItem.result ?? firstItem.abort)?.ts ?? null);
}

function filterForEvent(event: RenderEvent): EventFilter {
  if (event.kind === "tool_aborted" || event.kind === "tool_call" || event.kind === "tool_result") {
    return "tool";
  }
  if (event.kind === "agent" && isThinkingEvent(event)) return "thinking";
  if (event.kind === "agent") return "agent";
  if (event.kind === "user") return "user";
  return "agent";
}

function isThinkingEvent(event: RenderEvent): boolean {
  return event.type === "agent_thinking";
}
