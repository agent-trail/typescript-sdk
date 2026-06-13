import type { Entry, Header, TrailEnvelope } from "@agent-trail/types";
import type {
  ParsedTrail,
  ParsedTrailRecord,
  SessionGroup,
  TrailJsonlInput,
  TrailRecordLike,
  UnknownTrailRecord,
} from "./index.js";
import { isJsonObject } from "./shared.js";

export async function parseTrailJsonl(input: TrailJsonlInput): Promise<ParsedTrail> {
  const text = typeof input === "string" ? input : await collectInput(input);
  const records: ParsedTrailRecord[] = [];

  const lines = text.split(/\n/);
  if (lines.at(-1) === "") lines.pop();

  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    if (line.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      records.push({ line: lineNumber, record: { type: "x-parse-error", raw: line } });
      continue;
    }

    const record = isJsonObject(parsed)
      ? (parsed as TrailRecordLike)
      : ({ type: "x-parse-error", value: parsed } as UnknownTrailRecord);
    const parsedRecord = { line: lineNumber, record };
    records.push(parsedRecord);
  }

  return buildParsedTrail(records);
}

async function collectInput(input: AsyncIterable<string | Uint8Array>): Promise<string> {
  const textDecoder = new TextDecoder("utf-8", { fatal: false });
  let text = "";
  for await (const chunk of input) {
    text += typeof chunk === "string" ? chunk : textDecoder.decode(chunk, { stream: true });
  }
  text += textDecoder.decode();
  return text;
}

export function buildParsedTrail(records: ParsedTrailRecord[]): ParsedTrail {
  const groups: SessionGroup[] = [];
  let envelope: ParsedTrailRecord<TrailEnvelope> | undefined;
  let currentGroup: SessionGroup | undefined;
  for (const parsedRecord of records) {
    if (parsedRecord.record.type === "trail" && parsedRecord.line === 1) {
      envelope = parsedRecord as ParsedTrailRecord<TrailEnvelope>;
      continue;
    }
    if (parsedRecord.record.type === "session") {
      currentGroup = {
        header: parsedRecord as ParsedTrailRecord<Header | UnknownTrailRecord>,
        events: [],
      };
      groups.push(currentGroup);
      continue;
    }
    currentGroup?.events.push(parsedRecord as ParsedTrailRecord<Entry | UnknownTrailRecord>);
  }
  return envelope === undefined ? { records, groups } : { records, envelope, groups };
}
