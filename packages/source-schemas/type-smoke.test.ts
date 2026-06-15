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

test("schema and metadata subpaths import through the public export map", () => {
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

test("source-schemas has no root runtime export", async () => {
  const rootSpecifier = "@agent-trail/source-schemas";

  await expect(import(rootSpecifier)).rejects.toThrow();
});
