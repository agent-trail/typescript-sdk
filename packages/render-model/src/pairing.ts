import type { RenderEvent } from "./types.js";

type EventGraph = {
  childrenByParent: Map<string, number>;
  eventsById: Map<string, RenderEvent>;
};

type ToolCallLink = {
  branchScope: string;
  id: string;
  isSubagentInvoke: boolean;
  matched: boolean;
  parentId?: string;
  semanticCallId?: string;
};

type ToolCompletionLink = {
  branchScope: string;
  callCursor: number;
  eventIndex: number;
  explicitId?: string;
  matched: boolean;
  parentId?: string;
  semanticCallId?: string;
  supportsExplicitId: boolean;
  supportsFallback: boolean;
};

type PairingBucket = {
  calls: ToolCallLink[];
  callsById: Map<string, ToolCallLink>;
  completions: ToolCompletionLink[];
};

/** @internal */
export function pairToolLifecycleEvents(events: readonly RenderEvent[]): Map<number, string> {
  const pairings = new Map<number, string>();
  forEachSessionRange(events, (start, end) => {
    const bucket = buildPairingBucket(events, start, end);
    linkExplicitCompletions(bucket, pairings);
    linkSemanticCompletions(bucket, pairings);
    linkParentCompletions(bucket, pairings);
    linkSequentialCompletions(bucket, pairings);
  });
  return pairings;
}

function forEachSessionRange(
  events: readonly RenderEvent[],
  callback: (start: number, end: number) => void,
): void {
  for (let start = 0; start < events.length; ) {
    const sessionIndex = events[start]?.sessionIndex;
    let end = start + 1;
    while (end < events.length && events[end]?.sessionIndex === sessionIndex) end += 1;
    callback(start, end);
    start = end;
  }
}

function buildPairingBucket(
  events: readonly RenderEvent[],
  start: number,
  end: number,
): PairingBucket {
  const graph = graphFor(events, start, end);
  const bucket: PairingBucket = { calls: [], callsById: new Map(), completions: [] };

  for (let index = start; index < end; index += 1) {
    const event = events[index];
    if (event === undefined) continue;
    if (event.kind === "tool_call") addCall(bucket, graph, event);
    if (event.kind === "tool_result" || event.kind === "tool_aborted") {
      addCompletion(bucket, graph, event, index);
    }
  }

  return bucket;
}

function graphFor(events: readonly RenderEvent[], start: number, end: number): EventGraph {
  const graph: EventGraph = { childrenByParent: new Map(), eventsById: new Map() };
  for (let index = start; index < end; index += 1) {
    const event = events[index];
    if (event === undefined) continue;
    if (event.id !== null) graph.eventsById.set(event.id, event);
    if (event.parentId !== undefined) {
      graph.childrenByParent.set(
        event.parentId,
        (graph.childrenByParent.get(event.parentId) ?? 0) + 1,
      );
    }
  }
  return graph;
}

function addCall(bucket: PairingBucket, graph: EventGraph, event: RenderEvent): void {
  if (event.id === null) return;
  const call: ToolCallLink = {
    branchScope: branchScope(event, graph),
    id: event.id,
    isSubagentInvoke: event.tool?.name === "subagent_invoke",
    matched: false,
    ...optionalParentId(event.parentId),
    ...optionalSemanticCallId(event.tool?.semanticCallId),
  };
  bucket.calls.push(call);
  bucket.callsById.set(call.id, call);
}

function addCompletion(
  bucket: PairingBucket,
  graph: EventGraph,
  event: RenderEvent,
  eventIndex: number,
): void {
  bucket.completions.push({
    branchScope: branchScope(event, graph),
    callCursor: bucket.calls.length,
    eventIndex,
    matched: false,
    supportsExplicitId: event.kind === "tool_result" || event.tool?.scope === "tool_call",
    supportsFallback: event.kind === "tool_result",
    ...optionalExplicitId(event.tool?.forId),
    ...optionalParentId(event.parentId),
    ...optionalSemanticCallId(
      event.kind === "tool_result" ? event.tool?.semanticCallId : undefined,
    ),
  });
}

function linkExplicitCompletions(bucket: PairingBucket, pairings: Map<number, string>): void {
  for (const completion of bucket.completions) {
    if (!completion.supportsExplicitId || completion.explicitId === undefined) continue;
    const call = bucket.callsById.get(completion.explicitId);
    if (call !== undefined && !call.matched) link(call, completion, pairings);
  }
}

function linkSemanticCompletions(bucket: PairingBucket, pairings: Map<number, string>): void {
  const semanticQueues = semanticQueuesFor(bucket.calls);
  for (const completion of bucket.completions) {
    if (!canUseSemanticFallback(completion)) continue;
    const call = semanticQueues.get(completion.semanticCallId)?.shift();
    if (call !== undefined) link(call, completion, pairings);
  }
}

function semanticQueuesFor(calls: readonly ToolCallLink[]): Map<string, ToolCallLink[]> {
  const queues = new Map<string, ToolCallLink[]>();
  for (const call of calls) {
    if (call.matched || call.semanticCallId === undefined) continue;
    const queue = queues.get(call.semanticCallId);
    if (queue === undefined) queues.set(call.semanticCallId, [call]);
    else queue.push(call);
  }
  return queues;
}

function canUseSemanticFallback(
  completion: ToolCompletionLink,
): completion is ToolCompletionLink & { semanticCallId: string } {
  return (
    !completion.matched && completion.supportsFallback && completion.semanticCallId !== undefined
  );
}

function linkParentCompletions(bucket: PairingBucket, pairings: Map<number, string>): void {
  for (const completion of bucket.completions) {
    if (!canUseParentFallback(completion)) continue;
    const call = unmatchedCallById(bucket, completion.parentId);
    if (call !== undefined) link(call, completion, pairings);
  }
}

function canUseParentFallback(
  completion: ToolCompletionLink,
): completion is ToolCompletionLink & { parentId: string } {
  return !completion.matched && completion.supportsFallback && completion.parentId !== undefined;
}

function unmatchedCallById(bucket: PairingBucket, callId: string): ToolCallLink | undefined {
  const call = bucket.callsById.get(callId);
  return call === undefined || call.matched || call.isSubagentInvoke ? undefined : call;
}

function linkSequentialCompletions(bucket: PairingBucket, pairings: Map<number, string>): void {
  for (const completion of bucket.completions) {
    if (completion.matched || !completion.supportsFallback) continue;
    const call = nearestSequentialCall(bucket.calls, completion);
    if (call !== undefined) link(call, completion, pairings);
  }
}

function nearestSequentialCall(
  calls: readonly ToolCallLink[],
  completion: ToolCompletionLink,
): ToolCallLink | undefined {
  for (let index = completion.callCursor - 1; index >= 0; index -= 1) {
    const call = calls[index];
    if (call === undefined || call.matched) continue;
    if (samePairingScope(call, completion)) return call;
  }
  return undefined;
}

function link(
  call: ToolCallLink,
  completion: ToolCompletionLink,
  pairings: Map<number, string>,
): void {
  call.matched = true;
  completion.matched = true;
  pairings.set(completion.eventIndex, call.id);
}

function samePairingScope(
  call: { branchScope: string; parentId?: string },
  completion: { branchScope: string; parentId?: string },
): boolean {
  return (
    call.branchScope === completion.branchScope ||
    (call.parentId !== undefined && call.parentId === completion.parentId)
  );
}

function branchScope(event: RenderEvent, graph: EventGraph): string {
  let child = event;
  const visited = new Set<string>();

  while (canWalkToParent(child, visited)) {
    const parentId = child.parentId;
    visited.add(parentId);
    const parent = graph.eventsById.get(parentId);
    if (parent === undefined) break;

    const scope = boundaryScope(child, parent, parentId, graph);
    if (scope !== undefined) return scope;
    child = parent;
  }

  return "root";
}

function canWalkToParent(
  event: RenderEvent,
  visited: ReadonlySet<string>,
): event is RenderEvent & { parentId: string } {
  return event.parentId !== undefined && !visited.has(event.parentId);
}

function boundaryScope(
  child: RenderEvent,
  parent: RenderEvent,
  parentId: string,
  graph: EventGraph,
): string | undefined {
  if ((graph.childrenByParent.get(parentId) ?? 0) > 1) {
    return child.id === null ? `branch:${parentId}` : `branch:${parentId}:${child.id}`;
  }
  return parent.kind === "tool_call" && parent.tool?.name === "subagent_invoke"
    ? `subagent:${parentId}`
    : undefined;
}

function optionalExplicitId(explicitId: string | undefined): { explicitId?: string } {
  return explicitId === undefined ? {} : { explicitId };
}

function optionalParentId(parentId: string | undefined): { parentId?: string } {
  return parentId === undefined ? {} : { parentId };
}

function optionalSemanticCallId(semanticCallId: string | undefined): { semanticCallId?: string } {
  return semanticCallId === undefined ? {} : { semanticCallId };
}
