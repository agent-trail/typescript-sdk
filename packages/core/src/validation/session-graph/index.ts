import type { ParsedTrailRecord, SessionGroup } from "../../index.js";
import { readString } from "../../shared.js";

export type SessionGraph = {
  recordById(id: string): ParsedTrailRecord | undefined;
  parentRecord(event: ParsedTrailRecord): ParsedTrailRecord | undefined;
  hasPriorId(id: string, before: ParsedTrailRecord): boolean;
  firstTerminalEvent(): ParsedTrailRecord | undefined;
  parentById: ReadonlyMap<string, string>;
  recordsById: ReadonlyMap<string, ParsedTrailRecord>;
};

export function buildSessionGraph(group: SessionGroup): SessionGraph {
  const records = [group.header, ...group.events];
  const recordsById = recordsByIdMap(records);
  const parentById = parentLinks(group.events);
  const priorIdsByLine = priorIds(records);
  const firstTerminal = group.events.find(isTerminalEvent);

  return {
    recordsById,
    parentById,
    recordById: (id) => recordsById.get(id),
    parentRecord: (event) => {
      const parentId = readString(event.record, "parent_id");
      return parentId === undefined ? undefined : recordsById.get(parentId);
    },
    hasPriorId: (id, before) => priorIdsByLine.get(before.line)?.has(id) === true,
    firstTerminalEvent: () => firstTerminal,
  };
}

function recordsByIdMap(records: ParsedTrailRecord[]): Map<string, ParsedTrailRecord> {
  const byId = new Map<string, ParsedTrailRecord>();
  for (const record of records) {
    const id = readString(record.record, "id");
    if (id !== undefined && !byId.has(id)) byId.set(id, record);
  }
  return byId;
}

function parentLinks(events: ParsedTrailRecord[]): Map<string, string> {
  const parentById = new Map<string, string>();
  for (const event of events) {
    const id = readString(event.record, "id");
    const parentId = readString(event.record, "parent_id");
    if (id !== undefined && parentId !== undefined) parentById.set(id, parentId);
  }
  return parentById;
}

function priorIds(records: ParsedTrailRecord[]): Map<number, Set<string>> {
  const out = new Map<number, Set<string>>();
  const seen = new Set<string>();
  for (const record of [...records].sort((left, right) => left.line - right.line)) {
    out.set(record.line, new Set(seen));
    const id = readString(record.record, "id");
    if (id !== undefined) seen.add(id);
  }
  return out;
}

function isTerminalEvent(event: ParsedTrailRecord): boolean {
  return event.record.type === "session_end" || event.record.type === "session_terminated";
}
