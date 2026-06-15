import { expect, test } from "bun:test";
import { systemEventKind, systemEventText } from "./envelope-mappers.js";

test("system envelope lookup tables ignore Object prototype keys", () => {
  const envelope = { type: "constructor", subtype: "constructor" };

  expect(systemEventText(envelope)).toBe("System event");
  expect(systemEventKind(envelope)).toBe("x-claudecode/constructor");
});
