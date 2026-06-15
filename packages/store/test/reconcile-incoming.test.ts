import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type CatalogDb, initializeCatalog, upsertTrailObject } from "@agent-trail/catalog";
import { parseTrailJsonl, stampContentHashes } from "@agent-trail/core";
import { BunCatalogDb } from "../../catalog/test/helpers.ts";
import { objectPath, reconcileIncomingSegment, registerTrail } from "../src/index.ts";

let storeRoot: string;
let scratch: string;
let rawDb: Database;
let catalogDb: CatalogDb;

function reconcileTest(name: string, run: () => Promise<void>): void {
  test.serial(name, async () => {
    storeRoot = mkdtempSync(join(tmpdir(), "trail-store-reconcile-"));
    scratch = mkdtempSync(join(tmpdir(), "trail-store-input-"));
    rawDb = new Database(":memory:");
    catalogDb = new BunCatalogDb(rawDb);
    try {
      await run();
    } finally {
      rawDb.close();
      rmSync(storeRoot, { recursive: true, force: true });
      rmSync(scratch, { recursive: true, force: true });
    }
  });
}

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

function incomingSegmentJsonl(
  headerId: string,
  sessionUid: string,
  prevContentHash: string | undefined,
  text: string,
): string {
  return jsonl([
    {
      type: "session",
      schema_version: "0.1.0",
      id: headerId,
      session_uid: sessionUid,
      segment: { seq: 2, prev_content_hash: prevContentHash },
      ts: "2026-05-17T14:05:00.000Z",
      agent: { name: "codex" },
    },
    {
      type: "agent_message",
      id: randomUUID(),
      ts: "2026-05-17T14:05:01.000Z",
      payload: { text },
    },
  ]);
}

reconcileTest("reconcileIncomingSegment merges matching prior segments", async () => {
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
      agent: { name: "codex" },
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
  await registerTrail(firstPath, { storeRoot, catalogDb });

  const incoming = incomingSegmentJsonl(headerId, sessionUid, first.hash, "two");

  const result = await reconcileIncomingSegment(storeRoot, incoming, catalogDb);

  expect(result.kind).toBe("merged");
  if (result.kind === "merged") {
    expect(result.sessionUid).toBe(sessionUid);
    expect(result.segmentCount).toBe(2);
    expect(result.canonical).toContain('"text":"one"');
    expect(result.canonical).toContain('"text":"two"');
  }
});

reconcileTest("reconcileIncomingSegment passes through trails without session_uid", async () => {
  const incoming = jsonl([
    {
      type: "session",
      schema_version: "0.1.0",
      id: randomUUID(),
      ts: "2026-05-17T14:05:00.000Z",
      agent: { name: "codex" },
    },
  ]);

  await expect(reconcileIncomingSegment(storeRoot, incoming, catalogDb)).resolves.toEqual({
    kind: "passthrough",
    reason: "no_session_uid",
  });
});

reconcileTest("reconcileIncomingSegment passes through invalid incoming bytes", async () => {
  await expect(reconcileIncomingSegment(storeRoot, "{bad\n", catalogDb)).resolves.toEqual({
    kind: "passthrough",
    reason: "invalid_incoming",
  });
});

reconcileTest("reconcileIncomingSegment passes through when no priors match", async () => {
  await initializeCatalog(catalogDb);
  const incoming = incomingSegmentJsonl(randomUUID(), randomUUID(), undefined, "alone");

  await expect(reconcileIncomingSegment(storeRoot, incoming, catalogDb)).resolves.toEqual({
    kind: "passthrough",
  });
});

reconcileTest(
  "reconcileIncomingSegment surfaces catalog errors as store_error passthrough",
  async () => {
    const failingCatalog: CatalogDb = {
      exec() {
        throw new Error("catalog unavailable");
      },
      get() {
        return undefined;
      },
      all() {
        return [];
      },
    };

    const incoming = incomingSegmentJsonl(randomUUID(), randomUUID(), undefined, "text");

    await expect(reconcileIncomingSegment(storeRoot, incoming, failingCatalog)).resolves.toEqual({
      kind: "passthrough",
      reason: "store_error",
    });
  },
);

reconcileTest(
  "reconcileIncomingSegment reports corrupt_prior when matching prior object is unreadable",
  async () => {
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
        agent: { name: "codex" },
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
    const registered = await registerTrail(firstPath, { storeRoot, catalogDb });
    await unlink(registered.objectPath as string);

    const incoming = incomingSegmentJsonl(headerId, sessionUid, first.hash, "two");

    await expect(reconcileIncomingSegment(storeRoot, incoming, catalogDb)).resolves.toEqual({
      kind: "passthrough",
      reason: "corrupt_prior",
    });
  },
);

reconcileTest(
  "reconcileIncomingSegment ignores catalog object paths outside the store root",
  async () => {
    const outsideRoot = mkdtempSync(join(tmpdir(), "trail-store-outside-"));
    try {
      const sessionUid = randomUUID();
      const headerId = randomUUID();
      const outsidePrior = await stamped([
        {
          type: "session",
          schema_version: "0.1.0",
          id: headerId,
          session_uid: sessionUid,
          segment: { seq: 1 },
          ts: "2026-05-17T14:00:00.000Z",
          agent: { name: "codex" },
        },
        {
          type: "user_message",
          id: randomUUID(),
          ts: "2026-05-17T14:00:01.000Z",
          payload: { text: "outside prior" },
        },
      ]);
      const outsidePath = join(outsideRoot, "outside.trail.jsonl");
      await writeFile(outsidePath, outsidePrior.text, "utf8");
      await initializeCatalog(catalogDb);
      await upsertTrailObject(catalogDb, {
        content_hash: outsidePrior.hash,
        kind: "session",
        object_path: outsidePath,
        source_path: null,
        session_uid: sessionUid,
        registered_at: "2026-05-17T14:01:00.000Z",
      });

      const incoming = incomingSegmentJsonl(headerId, sessionUid, outsidePrior.hash, "incoming");

      await expect(reconcileIncomingSegment(storeRoot, incoming, catalogDb)).resolves.toEqual({
        kind: "passthrough",
        reason: "corrupt_prior",
      });
    } finally {
      rmSync(outsideRoot, { recursive: true, force: true });
    }
  },
);

reconcileTest(
  "reconcileIncomingSegment ignores the incoming segment as its own prior",
  async () => {
    const sessionUid = randomUUID();
    const headerId = randomUUID();
    const incoming = await stamped([
      {
        type: "session",
        schema_version: "0.1.0",
        id: headerId,
        session_uid: sessionUid,
        segment: { seq: 1 },
        ts: "2026-05-17T14:05:00.000Z",
        agent: { name: "codex" },
      },
      {
        type: "agent_message",
        id: randomUUID(),
        ts: "2026-05-17T14:05:01.000Z",
        payload: { text: "incoming" },
      },
    ]);
    const incomingPath = join(scratch, "incoming.trail.jsonl");
    await writeFile(incomingPath, incoming.text, "utf8");
    await registerTrail(incomingPath, { storeRoot, catalogDb });

    await expect(reconcileIncomingSegment(storeRoot, incoming.text, catalogDb)).resolves.toEqual({
      kind: "passthrough",
    });
  },
);

reconcileTest(
  "reconcileIncomingSegment treats symlinked store objects as corrupt priors",
  async () => {
    const outsideRoot = mkdtempSync(join(tmpdir(), "trail-store-outside-"));
    try {
      const sessionUid = randomUUID();
      const headerId = randomUUID();
      const outsidePrior = await stamped([
        {
          type: "session",
          schema_version: "0.1.0",
          id: headerId,
          session_uid: sessionUid,
          segment: { seq: 1 },
          ts: "2026-05-17T14:00:00.000Z",
          agent: { name: "codex" },
        },
        {
          type: "user_message",
          id: randomUUID(),
          ts: "2026-05-17T14:00:01.000Z",
          payload: { text: "outside prior" },
        },
      ]);
      const outsidePath = join(outsideRoot, "outside.trail.jsonl");
      const linkedObjectPath = objectPath(storeRoot, outsidePrior.hash);
      await writeFile(outsidePath, outsidePrior.text, "utf8");
      await mkdir(dirname(linkedObjectPath), { recursive: true });
      await symlink(outsidePath, linkedObjectPath);
      await initializeCatalog(catalogDb);
      await upsertTrailObject(catalogDb, {
        content_hash: outsidePrior.hash,
        kind: "session",
        object_path: linkedObjectPath,
        source_path: null,
        session_uid: sessionUid,
        registered_at: "2026-05-17T14:01:00.000Z",
      });

      const incoming = incomingSegmentJsonl(headerId, sessionUid, outsidePrior.hash, "incoming");

      await expect(reconcileIncomingSegment(storeRoot, incoming, catalogDb)).resolves.toEqual({
        kind: "passthrough",
        reason: "corrupt_prior",
      });
    } finally {
      rmSync(outsideRoot, { recursive: true, force: true });
    }
  },
);

reconcileTest(
  "reconcileIncomingSegment treats invalid catalog hashes as corrupt priors",
  async () => {
    const sessionUid = randomUUID();
    const incoming = incomingSegmentJsonl(randomUUID(), sessionUid, undefined, "incoming");
    await initializeCatalog(catalogDb);
    await catalogDb.exec(
      `INSERT INTO trail_objects (
      content_hash,
      kind,
      object_path,
      source_path,
      session_uid,
      registered_at
    ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        "../escape",
        "session",
        "/tmp/escape.trail.jsonl",
        null,
        sessionUid,
        "2026-05-17T14:01:00.000Z",
      ],
    );

    await expect(reconcileIncomingSegment(storeRoot, incoming, catalogDb)).resolves.toEqual({
      kind: "passthrough",
      reason: "corrupt_prior",
    });
  },
);

reconcileTest("reconcileIncomingSegment returns warnings from broken segment chains", async () => {
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
      agent: { name: "codex" },
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
  await registerTrail(firstPath, { storeRoot, catalogDb });

  const incoming = incomingSegmentJsonl(headerId, sessionUid, "b".repeat(64), "two");

  const result = await reconcileIncomingSegment(storeRoot, incoming, catalogDb);

  expect(result).toMatchObject({
    kind: "merged",
    warnings: ["segment_chain_break"],
  });
});

reconcileTest(
  "reconcileIncomingSegment merges a prior segment stored in a multi-session object",
  async () => {
    const sessionUid = randomUUID();
    const otherSessionUid = randomUUID();
    const headerId = randomUUID();
    const first = stampContentHashes(
      await parseTrailJsonl(
        jsonl([
          {
            type: "trail",
            schema_version: "0.1.0",
            id: randomUUID(),
            ts: "2026-05-17T14:00:00.000Z",
            producer: "agent-trail-test",
          },
          {
            type: "session",
            schema_version: "0.1.0",
            id: headerId,
            session_uid: sessionUid,
            segment: { seq: 1 },
            ts: "2026-05-17T14:00:00.000Z",
            agent: { name: "codex" },
          },
          {
            type: "user_message",
            id: randomUUID(),
            ts: "2026-05-17T14:00:01.000Z",
            payload: { text: "target prior" },
          },
          {
            type: "session",
            schema_version: "0.1.0",
            id: randomUUID(),
            session_uid: otherSessionUid,
            ts: "2026-05-17T14:02:00.000Z",
            agent: { name: "codex" },
          },
          {
            type: "user_message",
            id: randomUUID(),
            ts: "2026-05-17T14:02:01.000Z",
            payload: { text: "unrelated prior" },
          },
        ]),
      ),
    );
    const firstPath = join(scratch, "multi.trail.jsonl");
    await writeFile(firstPath, first.jsonl, "utf8");
    await registerTrail(firstPath, { storeRoot, catalogDb });

    const incoming = incomingSegmentJsonl(
      headerId,
      sessionUid,
      first.hashes.sessionHashes[0]?.hash,
      "target incoming",
    );

    const result = await reconcileIncomingSegment(storeRoot, incoming, catalogDb);

    expect(result.kind).toBe("merged");
    if (result.kind === "merged") {
      expect(result.sessionUid).toBe(sessionUid);
      expect(result.segmentCount).toBe(2);
      expect(result.canonical).toContain("target prior");
      expect(result.canonical).toContain("target incoming");
      expect(result.canonical).not.toContain("unrelated prior");
    }
  },
);
