import type {
  CoreValidationMode,
  ParsedTrail,
  ParsedTrailRecord,
  SessionGroup,
  TrailDiagnostic,
} from "../index.js";
import { diagnostic, readString } from "../shared.js";
import { branchReferenceDiagnostics } from "./branches.js";
import { crossGroupDiagnostics } from "./cross-group.js";
import { finalMessageDiagnostics } from "./final-message.js";
import { manifestDiagnostics } from "./manifest.js";
import { parentCycleDiagnostics } from "./parents.js";
import { parseFidelityDiagnostics } from "./parse-fidelity.js";
import { numberDiagnostics, wellFormedStringDiagnostics } from "./scalars.js";
import { segmentDiagnostics } from "./segments.js";
import { sourceRawDiagnostics } from "./source-raw.js";
import { streamDiagnostics } from "./stream.js";
import { timestampDiagnostics, timestampSyntaxDiagnostics } from "./timestamps.js";
import { toolPairingDiagnostics } from "./tool-pairing.js";
import { userQueryDiagnostics } from "./user-query.js";
import { vcsDiagnostics } from "./vcs.js";

export function wholeFileDiagnostics(
  trail: ParsedTrail,
  mode: CoreValidationMode,
): TrailDiagnostic[] {
  const diagnostics: TrailDiagnostic[] = [];
  const ids = new Map<string, ParsedTrailRecord>();
  for (const record of trail.records) {
    const id = readString(record.record, "id");
    if (id === undefined) continue;
    if (ids.has(id)) diagnostics.push(diagnostic(record.line, "/id", "error", "duplicate_id"));
    ids.set(id, record);
  }

  diagnostics.push(...wellFormedStringDiagnostics(trail.records, mode));
  diagnostics.push(...timestampSyntaxDiagnostics(trail.records));
  diagnostics.push(...numberDiagnostics(trail.records));
  diagnostics.push(...manifestDiagnostics(trail));
  diagnostics.push(...segmentDiagnostics(trail));
  diagnostics.push(...crossGroupDiagnostics(trail));

  for (const group of trail.groups) {
    diagnostics.push(...groupDiagnostics(group, ids));
  }

  return diagnostics;
}

function groupDiagnostics(
  group: SessionGroup,
  fileIds: Map<string, ParsedTrailRecord>,
): TrailDiagnostic[] {
  const diagnostics: TrailDiagnostic[] = [];
  const groupIds = new Map<string, ParsedTrailRecord>();
  groupIds.set(readString(group.header.record, "id") ?? "", group.header);

  for (const event of group.events) {
    const id = readString(event.record, "id");
    if (id !== undefined) groupIds.set(id, event);
  }

  for (const event of group.events) {
    const parentId = readString(event.record, "parent_id");
    if (parentId !== undefined && !groupIds.has(parentId)) {
      diagnostics.push(diagnostic(event.line, "/parent_id", "error", "unknown_parent_id"));
    }
  }

  const parentCycleDiagnosticsForGroup = parentCycleDiagnostics(group, groupIds);
  diagnostics.push(...parentCycleDiagnosticsForGroup);
  diagnostics.push(
    ...timestampDiagnostics(group, groupIds, parentCycleDiagnosticsForGroup.length > 0),
  );
  diagnostics.push(...parseFidelityDiagnostics(group));
  diagnostics.push(...vcsDiagnostics(group));
  diagnostics.push(...toolPairingDiagnostics(group));
  diagnostics.push(...branchReferenceDiagnostics(group));
  diagnostics.push(...userQueryDiagnostics(group));
  diagnostics.push(...sourceRawDiagnostics(group));
  diagnostics.push(...streamDiagnostics(group));
  diagnostics.push(...finalMessageDiagnostics(group, fileIds));
  return diagnostics;
}
