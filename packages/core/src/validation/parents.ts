import type { TrailDiagnostic } from "../index.js";
import { diagnostic } from "../shared.js";
import type { SessionGraph } from "./session-graph/index.js";

export function parentCycleDiagnostics(graph: SessionGraph): TrailDiagnostic[] {
  const diagnostics: TrailDiagnostic[] = [];
  const emitted = new Set<string>();
  for (const [startId] of graph.parentById) {
    appendCycleDiagnostics(findCycle(startId, graph.parentById), graph, emitted, diagnostics);
  }
  return diagnostics;
}

function findCycle(startId: string, parentById: ReadonlyMap<string, string>): string[] {
  const path: string[] = [];
  const indexById = new Map<string, number>();
  let cursor: string | undefined = startId;
  while (cursor !== undefined) {
    const cycleStart = indexById.get(cursor);
    if (cycleStart !== undefined) return path.slice(cycleStart);
    indexById.set(cursor, path.length);
    path.push(cursor);
    cursor = parentById.get(cursor);
  }
  return [];
}

function appendCycleDiagnostics(
  cycleIds: string[],
  graph: SessionGraph,
  emitted: Set<string>,
  diagnostics: TrailDiagnostic[],
): void {
  for (const cycleId of cycleIds) {
    if (emitted.has(cycleId)) continue;
    const line = graph.recordById(cycleId)?.line;
    if (line !== undefined) {
      diagnostics.push(diagnostic(line, "/parent_id", "error", "parent_cycle"));
    }
    emitted.add(cycleId);
  }
}
