import type {
  CoreValidationMode,
  ParsedTrail,
  ParsedTrailRecord,
  SessionGroup,
  TrailDiagnostic,
} from "../index.js";
import { diagnostic, readString } from "../shared.js";
import { parentCycleDiagnostics } from "./parents.js";
import { buildSessionGraph, type SessionGraph } from "./session-graph.js";

export type ValidationContext = {
  trail: ParsedTrail;
  mode: CoreValidationMode;
  fileIds: ReadonlyMap<string, ParsedTrailRecord>;
  duplicateIdDiagnostics: TrailDiagnostic[];
  groups: GroupValidationContext[];
};

export type GroupValidationContext = {
  group: SessionGroup;
  graph: SessionGraph;
  fileIds: ReadonlyMap<string, ParsedTrailRecord>;
  parentCycleDiagnostics: TrailDiagnostic[];
  hasParentCycles: boolean;
};

export function buildValidationContext(
  trail: ParsedTrail,
  mode: CoreValidationMode,
): ValidationContext {
  const { fileIds, duplicateIdDiagnostics } = buildFileIdIndex(trail.records);
  return {
    trail,
    mode,
    fileIds,
    duplicateIdDiagnostics,
    groups: trail.groups.map((group) => buildGroupContext(group, fileIds)),
  };
}

function buildFileIdIndex(records: ParsedTrailRecord[]): {
  fileIds: Map<string, ParsedTrailRecord>;
  duplicateIdDiagnostics: TrailDiagnostic[];
} {
  const fileIds = new Map<string, ParsedTrailRecord>();
  const duplicateIdDiagnostics: TrailDiagnostic[] = [];
  for (const record of records) {
    const id = readString(record.record, "id");
    if (id === undefined) continue;
    if (fileIds.has(id)) {
      duplicateIdDiagnostics.push(diagnostic(record.line, "/id", "error", "duplicate_id"));
      continue;
    }
    fileIds.set(id, record);
  }
  return { fileIds, duplicateIdDiagnostics };
}

function buildGroupContext(
  group: SessionGroup,
  fileIds: ReadonlyMap<string, ParsedTrailRecord>,
): GroupValidationContext {
  const graph = buildSessionGraph(group);
  const cycles = parentCycleDiagnostics(graph);
  return {
    group,
    graph,
    fileIds,
    parentCycleDiagnostics: cycles,
    hasParentCycles: cycles.length > 0,
  };
}
