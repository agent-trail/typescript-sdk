import type { Entry } from "@agent-trail/types";

/**
 * @internal
 */
export function linkerCallId(entry: Entry): string | undefined {
  const linker = entry.meta?.linker;
  if (linker === null || typeof linker !== "object") return undefined;
  const callId = (linker as Record<string, unknown>).call_id;
  return typeof callId === "string" ? callId : undefined;
}
