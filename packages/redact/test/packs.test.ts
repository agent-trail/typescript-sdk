import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveRedactionConfig } from "../src/index.ts";

test("resolveRedactionConfig loads project packs and settings", async () => {
  const root = mkdtempSync(join(tmpdir(), "trail-redact-"));
  try {
    await mkdir(join(root, ".trail", "redactors"), { recursive: true });
    await writeFile(
      join(root, ".trail", "settings.json"),
      JSON.stringify({ redaction: { allowedSecrets: ["keep-me"] } }),
      "utf8",
    );
    await writeFile(
      join(root, ".trail", "redactors", "project.yaml"),
      [
        "name: project",
        "version: 1",
        "rules:",
        "  - id: custom_token",
        "    description: Custom token",
        "    regex: token-[A-Za-z0-9]+",
        "    placeholder: '[CUSTOM_TOKEN]'",
      ].join("\n"),
      "utf8",
    );

    const config = await resolveRedactionConfig({
      projectRoot: root,
      env: { HOME: "" },
    });

    expect(config.allowedSecrets).toEqual(["keep-me"]);
    expect(config.packs).toHaveLength(1);
    expect(config.packs[0]?.patterns[0]).toMatchObject({
      id: "custom_token",
      placeholder: "[CUSTOM_TOKEN]",
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
