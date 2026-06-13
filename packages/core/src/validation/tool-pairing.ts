import type { ParsedTrailRecord, SessionGroup, TrailDiagnostic } from "../index.js";
import {
  diagnostic,
  isCallMatched,
  isJsonObject,
  payloadString,
  readString,
  resultToolName,
  semanticCallId,
} from "../shared.js";

type ToolPairingContext = {
  calls: ParsedTrailRecord[];
  results: ParsedTrailRecord[];
  matchedResultsByCall: Map<string, ParsedTrailRecord[]>;
  explicitResults: Set<ParsedTrailRecord>;
};

export function toolPairingDiagnostics(group: SessionGroup): TrailDiagnostic[] {
  const context = buildToolPairingContext(group);
  const diagnostics = semanticConflictDiagnostics(context, group.header.line);
  matchImplicitResults(context, diagnostics);
  matchAbortedCalls(group, context.matchedResultsByCall);
  diagnostics.push(...unmatchedCallDiagnostics(group, context));
  return diagnostics;
}

function buildToolPairingContext(group: SessionGroup): ToolPairingContext {
  const context = {
    calls: group.events.filter((event) => event.record.type === "tool_call"),
    results: group.events.filter((event) => event.record.type === "tool_result"),
    matchedResultsByCall: new Map<string, ParsedTrailRecord[]>(),
    explicitResults: new Set<ParsedTrailRecord>(),
  };
  matchExplicitResults(context);
  return context;
}

function matchExplicitResults(context: ToolPairingContext): void {
  for (const result of context.results) {
    const forId = payloadString(result.record, "for_id");
    const call =
      forId === undefined
        ? undefined
        : context.calls.find((item) => readString(item.record, "id") === forId);
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
    const call = context.calls.find((event) => readString(event.record, "id") === callId);
    if (call !== undefined) {
      const callTool = payloadString(call.record, "tool");
      const resultTool = resultToolName(matches[0]?.record);
      if (callTool !== undefined && resultTool !== undefined && callTool !== resultTool) {
        diagnostics.push(
          diagnostic(
            matches[0]?.line ?? fallbackLine,
            "/payload",
            "warning",
            "tool_result_semantic_conflict",
          ),
        );
      }
    }
  }
  return diagnostics;
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
      : context.calls.find(
          (call) =>
            semanticCallId(call.record) === resultCallId &&
            !isCallMatched(call, context.matchedResultsByCall),
        );
  return matchCall(result, semanticCall, context.matchedResultsByCall);
}

function matchParentResult(result: ParsedTrailRecord, context: ToolPairingContext): boolean {
  const resultParentId = readString(result.record, "parent_id");
  const parentCall =
    resultParentId === undefined
      ? undefined
      : context.calls.find(
          (call) =>
            readString(call.record, "id") === resultParentId &&
            !isCallMatched(call, context.matchedResultsByCall),
        );
  return matchCall(result, parentCall, context.matchedResultsByCall);
}

function matchSequentialResult(
  result: ParsedTrailRecord,
  context: ToolPairingContext,
  diagnostics: TrailDiagnostic[],
): void {
  const resultParentId = readString(result.record, "parent_id");
  const priorCalls = context.calls.filter(
    (call) =>
      call.line < result.line &&
      !isCallMatched(call, context.matchedResultsByCall) &&
      readString(call.record, "parent_id") === resultParentId,
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
  group: SessionGroup,
  matchedResultsByCall: Map<string, ParsedTrailRecord[]>,
): void {
  for (const abort of group.events.filter((event) => event.record.type === "tool_call_aborted")) {
    const forId = payloadString(abort.record, "for_id");
    if (forId === undefined) continue;
    matchedResultsByCall.set(forId, [abort]);
  }
}

function unmatchedCallDiagnostics(
  group: SessionGroup,
  context: ToolPairingContext,
): TrailDiagnostic[] {
  const diagnostics: TrailDiagnostic[] = [];
  const terminalSuppression = group.events.some((event) => event.record.type === "session_end");
  const terminatedOpenIds = terminatedOpenCallIds(group);
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

function terminatedOpenCallIds(group: SessionGroup): Set<string> {
  return new Set(
    group.events
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
