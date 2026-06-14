import { afterEach, beforeEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseTrailJsonl, stampContentHashes } from "@agent-trail/core";
import { reconcileIncomingSegment, registerTrail } from "../src/index.ts";

let storeRoot: string;
let scratch: string;

beforeEach(() => {
  storeRoot = mkdtempSync(join(tmpdir(), "trail-store-reconcile-"));
  scratch = mkdtempSync(join(tmpdir(), "trail-store-input-"));
});

afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
});

function jsonl(records: unknown[]): string {
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

async function stamped(records: unknown[]): Promise<{ hash: string; text: string }> {
  const stampedTrail = stampContentHashes(await parseTrailJsonl(jsonl(records)));
  return {
    hash: stampedTrail.hashes.sessionHashes[0]?.hash as string,
    text: stampedTrail.jsonl,
  };
}

test("reconcileIncomingSegment merges matching prior segments", async () => {
  const sessionUid = randomUUID();
  const headerId = randomUUID();
  const first = await stamped([
    {
      type: "session",
      schema_version: "0.1.0",
      id: headerId,
      session_uid: sessionUid,
      segment: { seq: 1 },
      ts: "2026-05-17T14:00:00.000Z",
      agent: { name: "codex-cli" },
    },
    {
      type: "user_message",
      id: randomUUID(),
      ts: "2026-05-17T14:00:01.000Z",
      payload: { text: "one" },
    },
  ]);
  const firstPath = join(scratch, "first.trail.jsonl");
  await writeFile(firstPath, first.text, "utf8");
  await registerTrail(firstPath, { storeRoot });

  const incoming = jsonl([
    {
      type: "session",
      schema_version: "0.1.0",
      id: headerId,
      session_uid: sessionUid,
      segment: { seq: 2, prev_content_hash: first.hash },
      ts: "2026-05-17T14:05:00.000Z",
      agent: { name: "codex-cli" },
    },
    {
      type: "agent_message",
      id: randomUUID(),
      ts: "2026-05-17T14:05:01.000Z",
      payload: { text: "two" },
    },
  ]);

  const result = await reconcileIncomingSegment(storeRoot, incoming);

  expect(result.kind).toBe("merged");
  if (result.kind === "merged") {
    expect(result.sessionUid).toBe(sessionUid);
    expect(result.segmentCount).toBe(2);
    expect(result.canonical).toContain('"text":"one"');
    expect(result.canonical).toContain('"text":"two"');
  }
});
