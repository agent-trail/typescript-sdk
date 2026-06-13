import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  computeContentHashes,
  parseTrailJsonl,
  type TrailDiagnostic,
  validateTrailJsonl,
} from "../../packages/core/src/index.ts";

type ExpectedDiagnostic = {
  line: number;
  path?: string;
  severity?: "error" | "warning";
  code?: string;
};

type FixtureExpectation = {
  path: string;
  strict: { valid: boolean; diagnostics: ExpectedDiagnostic[] };
  tolerant: { clean: boolean; diagnostics: ExpectedDiagnostic[] };
  expected?: {
    session_hashes?: string[];
    file_hash?: string;
  };
};

const fixturesRoot = path.join(process.cwd(), "packages/schema/fixtures/validation");
const manifest = JSON.parse(readFileSync(path.join(fixturesRoot, "manifest.json"), "utf8")) as {
  fixtures: FixtureExpectation[];
};

function loadFixture(fixturePath: string): string {
  return readFileSync(path.join(fixturesRoot, fixturePath), "utf8");
}

function portableDiagnostics(diagnostics: TrailDiagnostic[]): ExpectedDiagnostic[] {
  return diagnostics
    .filter((diagnostic) => diagnostic.code !== "schema")
    .map((diagnostic) => ({
      line: diagnostic.line,
      path: diagnostic.path,
      severity: diagnostic.severity,
      code: diagnostic.code,
    }));
}

function expectedPortableDiagnostics(diagnostics: ExpectedDiagnostic[]): ExpectedDiagnostic[] {
  return diagnostics
    .filter(
      (
        diagnostic,
      ): diagnostic is ExpectedDiagnostic & {
        severity: "error" | "warning";
        code: string;
      } => diagnostic.code !== undefined && diagnostic.severity !== undefined,
    )
    .map((diagnostic) => ({
      line: diagnostic.line,
      path: diagnostic.path ?? "",
      severity: diagnostic.severity,
      code: diagnostic.code,
    }));
}

test("matches validation fixture manifest verdicts and portable diagnostics", async () => {
  for (const fixture of manifest.fixtures) {
    const text = loadFixture(fixture.path);
    const strict = await validateTrailJsonl(text, { mode: "strict" });
    const tolerant = await validateTrailJsonl(text, { mode: "tolerant" });

    expect(strict.ok, `${fixture.path} strict verdict`).toBe(fixture.strict.valid);
    expect(tolerant.ok, `${fixture.path} tolerant cleanliness`).toBe(fixture.tolerant.clean);
    expect(portableDiagnostics(strict.diagnostics), `${fixture.path} strict diagnostics`).toEqual(
      expectedPortableDiagnostics(fixture.strict.diagnostics),
    );
    expect(
      portableDiagnostics(tolerant.diagnostics),
      `${fixture.path} tolerant diagnostics`,
    ).toEqual(expectedPortableDiagnostics(fixture.tolerant.diagnostics));
  }
});

test("matches hash-vector oracle values", async () => {
  for (const fixture of manifest.fixtures.filter((item) => item.expected !== undefined)) {
    const trail = await parseTrailJsonl(loadFixture(fixture.path));
    const hashes = computeContentHashes(trail);

    expect(
      hashes.sessionHashes.map((hash) => hash.hash),
      `${fixture.path} session hashes`,
    ).toEqual(fixture.expected?.session_hashes ?? []);
    expect(hashes.fileHash, `${fixture.path} file hash`).toBe(fixture.expected?.file_hash);
  }
});
