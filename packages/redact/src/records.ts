import { type ParsedTrail, parseTrailJsonl, serializeTrailJsonl } from "@agent-trail/core";

export type RedactionRecord = {
  line: number;
  raw: string;
  value: Record<string, unknown>;
};

export function recordsFromTrail(trail: ParsedTrail): RedactionRecord[] {
  return trail.records.map(({ line, record }) => ({
    line,
    raw: JSON.stringify(record),
    value: structuredClone(record) as Record<string, unknown>,
  }));
}

export async function trailFromRecords(records: RedactionRecord[]): Promise<ParsedTrail> {
  return parseTrailJsonl(jsonlFromRecords(records));
}

export function jsonlFromRecords(records: RedactionRecord[]): string {
  return `${records.map((record) => JSON.stringify(record.value)).join("\n")}\n`;
}

export function canonicalJsonlFromRecords(records: RedactionRecord[]): Promise<string> {
  return trailFromRecords(records).then(serializeTrailJsonl);
}

export type RedactionGroup = {
  header: RedactionRecord;
  events: RedactionRecord[];
  index: number;
};

export function splitRedactionRecords(records: RedactionRecord[]): {
  envelope: RedactionRecord | undefined;
  groups: RedactionGroup[];
} {
  let envelope: RedactionRecord | undefined;
  const groups: RedactionGroup[] = [];
  let current: RedactionGroup | undefined;
  for (const record of records) {
    if (record.value.type === "trail" && record.line === 1) {
      envelope = record;
      continue;
    }
    if (record.value.type === "session") {
      current = { header: record, events: [], index: groups.length };
      groups.push(current);
      continue;
    }
    current?.events.push(record);
  }
  return { envelope, groups };
}
