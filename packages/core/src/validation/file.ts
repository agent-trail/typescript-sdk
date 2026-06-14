import type { TrailDiagnostic } from "../index.js";
import { diagnostic, readString } from "../shared.js";
import { branchReferenceDiagnostics } from "./branches.js";
import type { GroupValidationContext, ValidationContext } from "./context.js";
import { crossGroupDiagnostics } from "./cross-group.js";
import { finalMessageDiagnostics } from "./final-message.js";
import { manifestDiagnostics } from "./manifest.js";
import { parseFidelityDiagnostics } from "./parse-fidelity.js";
import { numberDiagnostics, wellFormedStringDiagnostics } from "./scalars.js";
import { segmentDiagnostics } from "./segments.js";
import { sourceRawDiagnostics } from "./source-raw.js";
import { streamDiagnostics } from "./stream.js";
import { timestampDiagnostics, timestampSyntaxDiagnostics } from "./timestamps.js";
import { toolPairingDiagnostics } from "./tool-pairing.js";
import { userQueryDiagnostics } from "./user-query.js";
import { vcsDiagnostics } from "./vcs.js";

export function wholeFileDiagnostics(context: ValidationContext): TrailDiagnostic[] {
  const diagnostics: TrailDiagnostic[] = [];
  diagnostics.push(...context.duplicateIdDiagnostics);
  diagnostics.push(...wellFormedStringDiagnostics(context));
  diagnostics.push(...timestampSyntaxDiagnostics(context));
  diagnostics.push(...numberDiagnostics(context));
  diagnostics.push(...manifestDiagnostics(context));
  diagnostics.push(...segmentDiagnostics(context));
  diagnostics.push(...crossGroupDiagnostics(context));

  for (const group of context.groups) {
    diagnostics.push(...groupDiagnostics(group));
  }

  return diagnostics;
}

function groupDiagnostics(context: GroupValidationContext): TrailDiagnostic[] {
  const diagnostics: TrailDiagnostic[] = [];

  for (const event of context.group.events) {
    const parentId = readString(event.record, "parent_id");
    if (parentId !== undefined && context.graph.recordById(parentId) === undefined) {
      diagnostics.push(diagnostic(event.line, "/parent_id", "error", "unknown_parent_id"));
    }
  }

  diagnostics.push(...context.parentCycleDiagnostics);
  diagnostics.push(...timestampDiagnostics(context));
  diagnostics.push(...parseFidelityDiagnostics(context));
  diagnostics.push(...vcsDiagnostics(context));
  diagnostics.push(...toolPairingDiagnostics(context));
  diagnostics.push(...branchReferenceDiagnostics(context));
  diagnostics.push(...userQueryDiagnostics(context));
  diagnostics.push(...sourceRawDiagnostics(context));
  diagnostics.push(...streamDiagnostics(context));
  diagnostics.push(...finalMessageDiagnostics(context));
  return diagnostics;
}
