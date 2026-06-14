import type { ParsedTrailRecord, SessionGroup, TrailDiagnostic } from "../index.js";
import { diagnostic, readString } from "../shared.js";

export function parentCycleDiagnostics(
  group: SessionGroup,
  groupIds: Map<string, ParsedTrailRecord>,
): TrailDiagnostic[] {
  const parentById = parentLinks(group);
  const diagnostics: TrailDiagnostic[] = [];
  const emitted = new Set<string>();
  for (const [startId] of parentById) {
    appendCycleDiagnostics(findCycle(startId, parentById), groupIds, emitted, diagnostics);
  }
  return diagnostics;
}

function parentLinks(group: SessionGroup): Map<string, string> {
  const parentById = new Map<string, string>();
  for (const event of group.events) {
    const id = readString(event.record, "id");
    const parentId = readString(event.record, "parent_id");
    if (id !== undefined && parentId !== undefined) parentById.set(id, parentId);
  }
  return parentById;
}

function findCycle(startId: string, parentById: Map<string, string>): string[] {
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
  groupIds: Map<string, ParsedTrailRecord>,
  emitted: Set<string>,
  diagnostics: TrailDiagnostic[],
): void {
  for (const cycleId of cycleIds) {
    if (emitted.has(cycleId)) continue;
    const line = groupIds.get(cycleId)?.line;
    if (line !== undefined) {
      diagnostics.push(diagnostic(line, "/parent_id", "error", "parent_cycle"));
    }
    emitted.add(cycleId);
  }
}
