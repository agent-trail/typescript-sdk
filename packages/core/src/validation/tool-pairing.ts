import type { ParsedTrailRecord, TrailDiagnostic } from "../index.js";
import {
  diagnostic,
  isCallMatched,
  isJsonObject,
  payloadString,
  readString,
  resultToolName,
  semanticCallId,
} from "../shared.js";
import type { GroupValidationContext } from "./context.js";

type ToolPairingContext = {
  calls: ParsedTrailRecord[];
  results: ParsedTrailRecord[];
  callsById: Map<string, ParsedTrailRecord[]>;
  callsBySemanticId: Map<string, ParsedTrailRecord[]>;
  callsByParentId: Map<string | undefined, ParsedTrailRecord[]>;
  matchedResultsByCall: Map<string, ParsedTrailRecord[]>;
  explicitResults: Set<ParsedTrailRecord>;
};

export function toolPairingDiagnostics(groupContext: GroupValidationContext): TrailDiagnostic[] {
  const context = buildToolPairingContext(groupContext);
  const diagnostics = semanticConflictDiagnostics(context, groupContext.group.header.line);
  matchImplicitResults(context, diagnostics);
  matchAbortedCalls(groupContext, context.matchedResultsByCall);
  diagnostics.push(...unmatchedCallDiagnostics(groupContext, context));
  return diagnostics;
}

function buildToolPairingContext(groupContext: GroupValidationContext): ToolPairingContext {
  const calls = groupContext.group.events.filter((event) => event.record.type === "tool_call");
  const context = {
    calls,
    results: groupContext.group.events.filter((event) => event.record.type === "tool_result"),
    callsById: new Map<string, ParsedTrailRecord[]>(),
    callsBySemanticId: new Map<string, ParsedTrailRecord[]>(),
    callsByParentId: new Map<string | undefined, ParsedTrailRecord[]>(),
    matchedResultsByCall: new Map<string, ParsedTrailRecord[]>(),
    explicitResults: new Set<ParsedTrailRecord>(),
  };
  for (const call of calls) indexCall(context, call);
  matchExplicitResults(context);
  return context;
}

function indexCall(context: ToolPairingContext, call: ParsedTrailRecord): void {
  const id = readString(call.record, "id");
  if (id !== undefined) addToIndex(context.callsById, id, call);
  const semanticId = semanticCallId(call.record);
  if (semanticId !== undefined) addToIndex(context.callsBySemanticId, semanticId, call);
  addToIndex(context.callsByParentId, readString(call.record, "parent_id"), call);
}

function addToIndex<K>(index: Map<K, ParsedTrailRecord[]>, key: K, call: ParsedTrailRecord): void {
  const calls = index.get(key) ?? [];
  calls.push(call);
  index.set(key, calls);
}

function matchExplicitResults(context: ToolPairingContext): void {
  for (const result of context.results) {
    const forId = payloadString(result.record, "for_id");
    const call = forId === undefined ? undefined : context.callsById.get(forId)?.[0];
    if (forId !== undefined && call !== undefined) {
      const matches = context.matchedResultsByCall.get(forId) ?? [];
      matches.push(result);
      context.matchedResultsByCall.set(forId, matches);
      context.explicitResults.add(result);
    }
  }
}

function semanticConflictDiagnostics(
  context: ToolPairingContext,
  fallbackLine: number,
): TrailDiagnostic[] {
  const diagnostics: TrailDiagnostic[] = [];
  for (const [callId, matches] of context.matchedResultsByCall) {
    const conflict = semanticConflictDiagnostic(context, callId, matches, fallbackLine);
    if (conflict !== undefined) diagnostics.push(conflict);
  }
  return diagnostics;
}

function semanticConflictDiagnostic(
  context: ToolPairingContext,
  callId: string,
  matches: ParsedTrailRecord[],
  fallbackLine: number,
): TrailDiagnostic | undefined {
  const call = context.callsById.get(callId)?.[0];
  const callTool = call === undefined ? undefined : payloadString(call.record, "tool");
  const resultTool = resultToolName(matches[0]?.record);
  if (callTool === undefined || resultTool === undefined || callTool === resultTool) {
    return undefined;
  }
  return diagnostic(
    matches[0]?.line ?? fallbackLine,
    "/payload",
    "warning",
    "tool_result_semantic_conflict",
  );
}

function matchImplicitResults(context: ToolPairingContext, diagnostics: TrailDiagnostic[]): void {
  for (const result of context.results.filter((item) => !context.explicitResults.has(item))) {
    if (matchSemanticResult(result, context)) continue;
    if (matchParentResult(result, context)) continue;
    matchSequentialResult(result, context, diagnostics);
  }
}

function matchSemanticResult(result: ParsedTrailRecord, context: ToolPairingContext): boolean {
  const resultCallId = semanticCallId(result.record);
  const semanticCall =
    resultCallId === undefined
      ? undefined
      : firstUnmatched(context.callsBySemanticId.get(resultCallId), context);
  return matchCall(result, semanticCall, context.matchedResultsByCall);
}

function matchParentResult(result: ParsedTrailRecord, context: ToolPairingContext): boolean {
  const resultParentId = readString(result.record, "parent_id");
  const parentCall =
    resultParentId === undefined
      ? undefined
      : firstUnmatched(context.callsById.get(resultParentId), context);
  return matchCall(result, parentCall, context.matchedResultsByCall);
}

function firstUnmatched(
  calls: ParsedTrailRecord[] | undefined,
  context: ToolPairingContext,
): ParsedTrailRecord | undefined {
  return calls?.find((call) => !isCallMatched(call, context.matchedResultsByCall));
}

function matchSequentialResult(
  result: ParsedTrailRecord,
  context: ToolPairingContext,
  diagnostics: TrailDiagnostic[],
): void {
  const resultParentId = readString(result.record, "parent_id");
  const priorCalls = (context.callsByParentId.get(resultParentId) ?? []).filter(
    (call) => call.line < result.line && !isCallMatched(call, context.matchedResultsByCall),
  );
  if (priorCalls.length > 1) {
    diagnostics.push(
      diagnostic(result.line, "/payload", "warning", "ambiguous_sequential_pairing"),
    );
  }
  matchCall(result, priorCalls.at(-1), context.matchedResultsByCall);
}

function matchCall(
  result: ParsedTrailRecord,
  call: ParsedTrailRecord | undefined,
  matchedResultsByCall: Map<string, ParsedTrailRecord[]>,
): boolean {
  const id = call === undefined ? undefined : readString(call.record, "id");
  if (id === undefined) return false;
  matchedResultsByCall.set(id, [result]);
  return true;
}

function matchAbortedCalls(
  groupContext: GroupValidationContext,
  matchedResultsByCall: Map<string, ParsedTrailRecord[]>,
): void {
  for (const abort of groupContext.group.events.filter(
    (event) => event.record.type === "tool_call_aborted",
  )) {
    const forId = payloadString(abort.record, "for_id");
    if (forId === undefined) continue;
    matchedResultsByCall.set(forId, [abort]);
  }
}

function unmatchedCallDiagnostics(
  groupContext: GroupValidationContext,
  context: ToolPairingContext,
): TrailDiagnostic[] {
  const diagnostics: TrailDiagnostic[] = [];
  const terminalSuppression = groupContext.group.events.some(
    (event) => event.record.type === "session_end",
  );
  const terminatedOpenIds = terminatedOpenCallIds(groupContext);
  for (const call of context.calls) {
    const id = readString(call.record, "id");
    if (
      id === undefined ||
      terminalSuppression ||
      terminatedOpenIds.has(id) ||
      isCallMatched(call, context.matchedResultsByCall)
    )
      continue;
    diagnostics.push(diagnostic(call.line, "/id", "warning", "unmatched_tool_call_at_eof"));
  }

  return diagnostics;
}

function terminatedOpenCallIds(groupContext: GroupValidationContext): Set<string> {
  return new Set(
    groupContext.group.events
      .filter(
        (event) =>
          event.record.type === "session_terminated" &&
          isJsonObject(event.record.payload) &&
          Array.isArray(event.record.payload.open_call_ids),
      )
      .flatMap((event) => (event.record.payload as { open_call_ids: unknown[] }).open_call_ids)
      .filter((value): value is string => typeof value === "string"),
  );
}
