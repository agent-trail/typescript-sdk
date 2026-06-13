import type { CoreValidationMode, ParsedTrailRecord, TrailDiagnostic } from "../index.js";
import { diagnostic, findValues, hasUnpairedSurrogate } from "../shared.js";

const secretPattern =
  /(authorization:\s*bearer\s+[A-Za-z0-9._~+/=-]+|^bearer\s+[A-Za-z0-9._~+/=-]+$|api[_-]?key\s*[=:]\s*[A-Za-z0-9._~+/=-]+|token\s*[=:]\s*[A-Za-z0-9._~+/=-]+)/i;
const credentialKeyPattern = /(?:^|\/)(?:api[_-]?key|authorization|password|secret|token)$/i;
const redactedPattern = /^(?:<redacted>|\[redacted\]|\*\*\*)$/i;

export function wellFormedStringDiagnostics(
  records: ParsedTrailRecord[],
  mode: CoreValidationMode,
): TrailDiagnostic[] {
  return records.flatMap((record) =>
    findValues(record.record, "").flatMap(({ path, value }) => {
      if (typeof value === "string" && hasUnpairedSurrogate(value)) {
        return [
          diagnostic(
            record.line,
            path,
            mode === "strict" ? "error" : "warning",
            "ill_formed_string",
          ),
        ];
      }
      return [];
    }),
  );
}

export function numberDiagnostics(records: ParsedTrailRecord[]): TrailDiagnostic[] {
  return records.flatMap((record) =>
    findValues(record.record, "").flatMap(({ path, value }) => {
      if (typeof value === "number" && Number.isInteger(value) && !Number.isSafeInteger(value)) {
        return [diagnostic(record.line, path, "warning", "non_interoperable_number")];
      }
      return [];
    }),
  );
}

export function secretDiagnostics(
  value: unknown,
  line: number,
  basePath: string,
  code: string,
): TrailDiagnostic[] {
  return findValues(value, basePath).flatMap(({ path, value: leaf }) => {
    if (typeof leaf === "string" && isUnredactedSecret(path, leaf)) {
      return [diagnostic(line, path, "warning", code)];
    }
    return [];
  });
}

function isUnredactedSecret(path: string, value: string): boolean {
  if (redactedPattern.test(value)) return false;
  return secretPattern.test(value) || credentialKeyPattern.test(path);
}
