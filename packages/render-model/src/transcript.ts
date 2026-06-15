import { pairToolLifecycleEvents } from "./pairing.js";
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

type TranscriptState = {
  pairedCallIdByEventIndex: Map<number, string>;
  currentRunCallItems: Map<string, ToolTranscriptItem>;
  items: TranscriptBuildItem[];
};

/** Filter metadata for viewer controls.
 *
 * @public
 */
export const FILTERS: readonly Readonly<{
  filter: EventFilter;
  label: string;
  shortLabel: string;
}>[] = Object.freeze([
  Object.freeze({ filter: "user", label: "User messages", shortLabel: "U" }),
  Object.freeze({ filter: "agent", label: "Agent response messages", shortLabel: "A" }),
  Object.freeze({ filter: "thinking", label: "Agent thinking messages", shortLabel: "Th" }),
  Object.freeze({ filter: "tool", label: "Tool calls", shortLabel: "T" }),
]);

/** Default transcript filters.
 *
 * @public
 */
export const DEFAULT_FILTERS: ActiveFilters = Object.freeze({
  agent: true,
  thinking: true,
  tool: true,
  user: true,
});

/** Build unfiltered transcript items from render events.
 *
 * Summaries, notices, and fallback events remain available in `RenderModel.events`
 * but are intentionally omitted from transcript items.
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
