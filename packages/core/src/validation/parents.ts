import type { ParsedTrailRecord, SessionGroup, TrailDiagnostic } from "../index.js";
import { diagnostic, readString } from "../shared.js";

export function parentCycleDiagnostics(
  group: SessionGroup,
  groupIds: Map<string, ParsedTrailRecord>,
): TrailDiagnostic[] {
  const parentById = new Map<string, string>();
  for (const event of group.events) {
    const id = readString(event.record, "id");
    const parentId = readString(event.record, "parent_id");
    if (id !== undefined && parentId !== undefined) parentById.set(id, parentId);
  }

  for (const [id] of parentById) {
    const seen = new Set<string>();
    let cursor: string | undefined = id;
    while (cursor !== undefined) {
      if (seen.has(cursor)) {
        return [...seen].flatMap((seenId) => {
          const line = groupIds.get(seenId)?.line;
          return line === undefined
            ? []
            : [diagnostic(line, "/parent_id", "error", "parent_cycle")];
        });
      }
      seen.add(cursor);
      cursor = parentById.get(cursor);
    }
  }
  return [];
}
