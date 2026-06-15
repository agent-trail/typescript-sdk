import { expect, test } from "bun:test";
import claudeCodeMeta from "@agent-trail/source-schemas/claude-code/meta";
import claudeCodeSchema, {
  type ClaudeCodeV1Record,
} from "@agent-trail/source-schemas/claude-code/v1";
import codexMeta from "@agent-trail/source-schemas/codex/meta";
import codexV0_128Schema, {
  type CodexV0_128Record,
} from "@agent-trail/source-schemas/codex/v0.128";
import codexV0_135Schema, {
  type CodexV0_135Record,
} from "@agent-trail/source-schemas/codex/v0.135";
import opencodeMeta from "@agent-trail/source-schemas/opencode/meta";
import opencodeSchema, { type OpenCodeV1Record } from "@agent-trail/source-schemas/opencode/v1";
import piMeta from "@agent-trail/source-schemas/pi/meta";
import piSchema, { type PiV1Record } from "@agent-trail/source-schemas/pi/v1";
import packageJson from "./package.json" with { type: "json" };

test("generated source types discriminate on the record type field", () => {
  const codex: CodexV0_128Record = { type: "session_meta", payload: { id: "x" } };
  const currentCodex: CodexV0_135Record = { type: "session_meta", payload: { id: "x" } };
  const pi: PiV1Record = { type: "session" };
  const cc: ClaudeCodeV1Record = { type: "user", version: "1.0.0" };
  const opencode: OpenCodeV1Record = { type: "part", part_type: "tool" };

  expect(codex.type).toBe("session_meta");
  expect(currentCodex.type).toBe("session_meta");
  expect(pi.type).toBe("session");
  expect(cc.type).toBe("user");
  expect(opencode.type).toBe("part");
});

test("schema and metadata subpaths import as generated JSON modules", () => {
  expect(claudeCodeSchema).toHaveProperty("title", "ClaudeCodeV1Record");
  expect(codexV0_128Schema).toHaveProperty("title", "CodexV0_128Record");
  expect(codexV0_135Schema).toHaveProperty("title", "CodexV0_135Record");
  expect(opencodeSchema).toHaveProperty("title", "OpenCodeV1Record");
  expect(piSchema).toHaveProperty("title", "PiV1Record");

  expect(claudeCodeMeta).toHaveProperty("agent", "claude-code");
  expect(codexMeta).toHaveProperty("agent", "codex");
  expect(opencodeMeta).toHaveProperty("agent", "opencode");
  expect(piMeta).toHaveProperty("agent", "pi");
});

test("package export map exposes only schema assets, metadata, and package metadata", () => {
  expect(packageJson.exports).toEqual({
    "./codex/v0.128": {
      types: "./codex/v0.128.d.ts",
      default: "./codex/v0.128.json",
    },
    "./codex/v0.135": {
      types: "./codex/v0.135.d.ts",
      default: "./codex/v0.135.json",
    },
    "./codex/meta": {
      default: "./codex/meta.json",
    },
    "./pi/v1": {
      types: "./pi/v1.d.ts",
      default: "./pi/v1.json",
    },
    "./pi/meta": {
      default: "./pi/meta.json",
    },
    "./claude-code/v1": {
      types: "./claude-code/v1.d.ts",
      default: "./claude-code/v1.json",
    },
    "./claude-code/meta": {
      default: "./claude-code/meta.json",
    },
    "./opencode/v1": {
      types: "./opencode/v1.d.ts",
      default: "./opencode/v1.json",
    },
    "./opencode/meta": {
      default: "./opencode/meta.json",
    },
    "./package.json": "./package.json",
  });
});
