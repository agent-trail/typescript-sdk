import type {
  CoreValidationMode,
  ParsedTrail,
  TrailDiagnostic,
  TrailJsonlInput,
  ValidateTrailOptions,
  ValidationResult,
} from "../index.js";
import { parseTrailJsonl } from "../parse.js";
import { uniqueDiagnostics } from "../shared.js";
import { wholeFileDiagnostics } from "./file.js";
import { hashDiagnostics } from "./hash.js";
import { layoutDiagnostics } from "./layout.js";
import { schemaDiagnostics } from "./schema.js";

export async function validateTrailJsonl(
  input: TrailJsonlInput,
  options: ValidateTrailOptions = {},
): Promise<ValidationResult> {
  const mode = options.mode ?? "strict";
  const trail = await parseTrailJsonl(input);
  const diagnostics = validateParsedTrail(trail, mode);
  const ok =
    mode === "strict"
      ? !diagnostics.some((diagnostic) => diagnostic.severity === "error")
      : diagnostics.length === 0;

  return { ok, trail, diagnostics };
}

function validateParsedTrail(trail: ParsedTrail, mode: CoreValidationMode): TrailDiagnostic[] {
  return uniqueDiagnostics([
    ...schemaDiagnostics(trail, mode),
    ...layoutDiagnostics(trail, mode),
    ...wholeFileDiagnostics(trail, mode),
    ...hashDiagnostics(trail, mode),
  ]).sort(
    (left, right) =>
      left.line - right.line ||
      left.path.localeCompare(right.path) ||
      left.code.localeCompare(right.code),
  );
}
