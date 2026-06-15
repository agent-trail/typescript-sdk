import { expect, test } from "bun:test";
import codexSchema, { type CodexV0_128Record } from "@agent-trail/source-schemas/codex/v0.128";
import type { ClaudeCodeV1Record } from "./claude-code/v1.d.ts";
import type { OpenCodeV1Record } from "./opencode/v1.d.ts";
import type { PiV1Record } from "./pi/v1.d.ts";

test("generated source types discriminate on the record type field", () => {
  const codex: CodexV0_128Record = { type: "session_meta", payload: { id: "x" } };
  const pi: PiV1Record = { type: "session" };
  const cc: ClaudeCodeV1Record = { type: "user", version: "1.0.0" };
  const opencode: OpenCodeV1Record = { type: "part", part_type: "tool" };

  expect(codex.type).toBe("session_meta");
  expect(codexSchema).toHaveProperty("title", "CodexV0_128Record");
  expect(pi.type).toBe("session");
  expect(cc.type).toBe("user");
  expect(opencode.type).toBe("part");
});
