import { expect, test } from "bun:test";
import { buildSessionGraph } from "../validation/session-graph.ts";
import { agentMessage, baseHeader, sessionTerminated, trail, userMessage } from "./helpers";

test("session graph exposes ids, parents, prior ids, and terminal state", async () => {
  const parsed = await trail([
    baseHeader,
    userMessage("01HEVTA0000000000000000001", "one"),
    agentMessage("01HEVTA0000000000000000002", "two", "01HEVTA0000000000000000001"),
    sessionTerminated("01HEVTA0000000000000000003", "user_abort"),
  ]);
  const group = parsed.groups[0];
  if (group === undefined) throw new Error("expected group");

  const graph = buildSessionGraph(group);
  const child = group.events[1];
  if (child === undefined) throw new Error("expected child");

  expect(graph.recordById("01HEVTA0000000000000000001")).toBe(group.events[0]);
  expect(graph.parentRecord(child)).toBe(group.events[0]);
  expect(graph.hasPriorId("01HSESS0000000000000000001", child)).toBe(true);
  expect(graph.hasPriorId("01HEVTA0000000000000000002", group.events[0] ?? child)).toBe(false);
  expect(graph.firstTerminalEvent()).toBe(group.events[2]);
});
