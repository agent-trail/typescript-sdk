import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveRedactionConfig } from "../src/index.ts";

test("resolveRedactionConfig loads project packs and ignores project weakening settings", async () => {
  const root = mkdtempSync(join(tmpdir(), "trail-redact-"));
  try {
    await mkdir(join(root, ".trail", "redactors"), { recursive: true });
    await writeFile(
      join(root, ".trail", "settings.json"),
      JSON.stringify({
        redaction: {
          allowedSecrets: ["keep-me"],
          pii: { emailAllowlist: ["leak@example.com"] },
        },
      }),
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

    expect(config.allowedSecrets).toEqual([]);
    expect(config.pii?.emailAllowlist).toBeUndefined();
    expect(config.packs).toHaveLength(1);
    expect(config.packs[0]?.patterns[0]).toMatchObject({
      id: "custom_token",
      placeholder: "[CUSTOM_TOKEN]",
    });
    expect(config.warnings).toEqual(
      expect.arrayContaining([
        "project redaction settings cannot add allowedSecrets; ignored",
        "project redaction settings cannot add pii.emailAllowlist; ignored",
      ]),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolveRedactionConfig skips unsafe packs and symlinks with warnings", async () => {
  const root = mkdtempSync(join(tmpdir(), "trail-redact-"));
  try {
    const redactors = join(root, ".trail", "redactors");
    await mkdir(redactors, { recursive: true });
    await writeFile(
      join(redactors, "unsafe.yaml"),
      [
        "name: unsafe",
        "version: 1",
        "rules:",
        "  - id: unsafe_rule",
        "    description: Unsafe",
        "    regex: (a+)+",
        "    placeholder: '[UNSAFE]'",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      join(redactors, "reserved.yaml"),
      [
        "name: reserved",
        "version: 1",
        "rules:",
        "  - id: reserved_rule",
        "    description: Reserved placeholder",
        "    regex: token-[A-Za-z0-9]+",
        "    placeholder: '__AGENT_TRAIL_ALLOWED_SECRET_0__'",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      join(redactors, "bad-sample.yaml"),
      [
        "name: bad-sample",
        "version: 1",
        "rules:",
        "  - id: bad_sample_rule",
        "    description: Bad sample",
        "    regex: token-[A-Za-z0-9]+",
        "    placeholder: '[TOKEN]'",
        "    samples:",
        "      - input: token-abc",
        "        redacted: false",
      ].join("\n"),
      "utf8",
    );
    await writeFile(join(root, "target.yaml"), "name: linked\nversion: 1\nrules: []\n", "utf8");
    await symlink(join(root, "target.yaml"), join(redactors, "linked.yaml"));
    await writeFile(join(redactors, "oversized.yaml"), "x".repeat(1024 * 1024 + 1), "utf8");

    const config = await resolveRedactionConfig({ projectRoot: root, env: { HOME: "" } });

    expect(config.packs).toEqual([]);
    expect(config.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("regex has nested unbounded quantifiers"),
        expect.stringContaining("placeholder uses reserved allowed-secret token namespace"),
        expect.stringContaining("sample failed"),
        expect.stringContaining("skipped symlink"),
        expect.stringContaining("too large"),
      ]),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolveRedactionConfig gives user-global packs precedence over project duplicate names", async () => {
  const root = mkdtempSync(join(tmpdir(), "trail-redact-project-"));
  const home = mkdtempSync(join(tmpdir(), "trail-redact-home-"));
  try {
    await mkdir(join(root, ".trail", "redactors"), { recursive: true });
    await mkdir(join(home, ".config", "trail", "redactors"), { recursive: true });
    await mkdir(join(home, ".config", "trail"), { recursive: true });
    await writeFile(
      join(root, ".trail", "settings.json"),
      JSON.stringify({ redaction: { allowedSecrets: ["project-allowed"] } }),
      "utf8",
    );
    await writeFile(
      join(home, ".config", "trail", "settings.json"),
      JSON.stringify({ redaction: { allowedSecrets: ["global-allowed"] } }),
      "utf8",
    );
    const projectPack = [
      "name: shared",
      "version: 1",
      "rules:",
      "  - id: project_rule",
      "    description: Project",
      "    regex: project-[A-Za-z0-9]+",
      "    placeholder: '[PROJECT]'",
    ].join("\n");
    const globalPack = [
      "name: shared",
      "version: 1",
      "rules:",
      "  - id: global_rule",
      "    description: Global",
      "    regex: global-[A-Za-z0-9]+",
      "    placeholder: '[GLOBAL]'",
    ].join("\n");
    await writeFile(join(root, ".trail", "redactors", "shared.yaml"), projectPack, "utf8");
    await writeFile(join(home, ".config", "trail", "redactors", "shared.yaml"), globalPack, "utf8");

    const config = await resolveRedactionConfig({ projectRoot: root, env: { HOME: home } });

    expect(config.allowedSecrets).toEqual(["global-allowed"]);
    expect(config.packs).toHaveLength(1);
    expect(config.packs[0]).toMatchObject({ name: "shared", source: "user_global" });
    expect(config.packs[0]?.patterns[0]?.id).toBe("global_rule");
    expect(config.warnings).toContainEqual(expect.stringContaining("duplicate name skipped"));
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("resolveRedactionConfig ignores project attempts to weaken PII detectors", async () => {
  const root = mkdtempSync(join(tmpdir(), "trail-redact-project-"));
  const home = mkdtempSync(join(tmpdir(), "trail-redact-home-"));
  try {
    await mkdir(join(root, ".trail"), { recursive: true });
    await mkdir(join(home, ".config", "trail"), { recursive: true });
    await writeFile(
      join(root, ".trail", "settings.json"),
      JSON.stringify({
        redaction: {
          allowedSecrets: ["project-secret"],
          pii: {
            email: false,
            phone: false,
            emailAllowlist: ["leak@example.com"],
          },
        },
      }),
      "utf8",
    );
    await writeFile(
      join(home, ".config", "trail", "settings.json"),
      JSON.stringify({ redaction: { pii: { name: false } } }),
      "utf8",
    );

    const config = await resolveRedactionConfig({ projectRoot: root, env: { HOME: home } });

    expect(config.pii).toEqual({ name: false });
    expect(config.allowedSecrets).toEqual([]);
    expect(config.warnings).toEqual(
      expect.arrayContaining([
        "project redaction settings cannot add allowedSecrets; ignored",
        "project redaction settings cannot add pii.emailAllowlist; ignored",
        "project redaction settings cannot disable pii.email; ignored",
        "project redaction settings cannot disable pii.phone; ignored",
      ]),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("resolveRedactionConfig ignores project pack allowlists", async () => {
  const root = mkdtempSync(join(tmpdir(), "trail-redact-project-"));
  const home = mkdtempSync(join(tmpdir(), "trail-redact-home-"));
  try {
    await mkdir(join(root, ".trail", "redactors"), { recursive: true });
    await mkdir(join(home, ".config", "trail", "redactors"), { recursive: true });
    await writeFile(
      join(root, ".trail", "redactors", "project.yaml"),
      [
        "name: project",
        "version: 1",
        "allowlist:",
        "  - project-secret",
        "rules:",
        "  - id: project_rule",
        "    description: Project",
        "    regex: project-[A-Za-z0-9]+",
        "    placeholder: '[PROJECT]'",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      join(home, ".config", "trail", "redactors", "global.yaml"),
      [
        "name: global",
        "version: 1",
        "allowlist:",
        "  - global-secret",
        "rules:",
        "  - id: global_rule",
        "    description: Global",
        "    regex: global-[A-Za-z0-9]+",
        "    placeholder: '[GLOBAL]'",
      ].join("\n"),
      "utf8",
    );

    const config = await resolveRedactionConfig({ projectRoot: root, env: { HOME: home } });

    expect(config.allowedSecrets).toEqual(["global-secret"]);
    expect(config.packs.find((pack) => pack.source === "project")?.allowlist).toEqual([]);
    expect(config.warnings).toContainEqual(
      expect.stringContaining("project redaction pack cannot add allowlist entries"),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("resolveRedactionConfig rejects symlinked settings", async () => {
  const root = mkdtempSync(join(tmpdir(), "trail-redact-"));
  try {
    await mkdir(join(root, ".trail"), { recursive: true });
    await writeFile(join(root, "settings-target.json"), "{}", "utf8");
    await symlink(join(root, "settings-target.json"), join(root, ".trail", "settings.json"));

    await expect(resolveRedactionConfig({ projectRoot: root, env: { HOME: "" } })).rejects.toThrow(
      "refuses symlink",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
