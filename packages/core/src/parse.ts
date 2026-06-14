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

/**
 * @internal
 */
export async function parseTrailJsonl(input: TrailJsonlInput): Promise<ParsedTrail> {
  const records: ParsedTrailRecord[] = [];
  const pushLine = lineParser(records);

  if (typeof input === "string") {
    pushLine.pushText(input);
  } else {
    await parseInput(input, pushLine);
  }
  pushLine.finish();

  return buildParsedTrail(records);
}

async function parseInput(
  input: AsyncIterable<string | Uint8Array>,
  pushLine: ReturnType<typeof lineParser>,
): Promise<void> {
  const pushBytes = byteLineParser(pushLine);
  const state = { discardInvalidLineRemainder: false };
  for await (const chunk of input) {
    pushInputChunk(chunk, pushLine, pushBytes, state);
  }
  pushBytes.finish();
}

type InputParserState = { discardInvalidLineRemainder: boolean };
type PushBytes = ReturnType<typeof byteLineParser>;
type PushLine = ReturnType<typeof lineParser>;

function pushInputChunk(
  chunk: string | Uint8Array,
  pushLine: PushLine,
  pushBytes: PushBytes,
  state: InputParserState,
): void {
  if (typeof chunk === "string") {
    pushStringChunk(chunk, pushLine, pushBytes, state);
  } else {
    pushByteChunk(chunk, pushLine, pushBytes, state);
  }
}

function pushStringChunk(
  chunk: string,
  pushLine: PushLine,
  pushBytes: PushBytes,
  state: InputParserState,
): void {
  state.discardInvalidLineRemainder = pushBytes.finish() || state.discardInvalidLineRemainder;
  const text: string | undefined = state.discardInvalidLineRemainder
    ? textAfterDiscardedInvalidLine(chunk, pushLine)
    : chunk;
  state.discardInvalidLineRemainder = text === undefined;
  if (text !== undefined) pushLine.pushText(text);
}

function pushByteChunk(
  chunk: Uint8Array,
  pushLine: PushLine,
  pushBytes: PushBytes,
  state: InputParserState,
): void {
  if (!state.discardInvalidLineRemainder) {
    pushBytes.push(chunk);
    return;
  }
  const remainder = bytesAfterDiscardedInvalidLine(chunk, pushLine);
  state.discardInvalidLineRemainder = remainder === undefined;
  if (remainder !== undefined && remainder.length > 0) pushBytes.push(remainder);
}

function textAfterDiscardedInvalidLine(text: string, pushLine: PushLine): string | undefined {
  const newlineIndex = text.indexOf("\n");
  if (newlineIndex === -1) return undefined;
  pushLine.consumeLine();
  return text.slice(newlineIndex + 1);
}

function bytesAfterDiscardedInvalidLine(
  bytes: Uint8Array,
  pushLine: PushLine,
): Uint8Array | undefined {
  const newlineIndex = bytes.indexOf(0x0a);
  if (newlineIndex === -1) return undefined;
  pushLine.consumeLine();
  return bytes.slice(newlineIndex + 1);
}

function byteLineParser(pushLine: ReturnType<typeof lineParser>) {
  let pending: number[] = [];
  const pushPending = (consumeLine: boolean): boolean => {
    if (pending.length === 0) return false;
    try {
      const decoder = new TextDecoder("utf-8", { fatal: true });
      pushLine.pushText(decoder.decode(new Uint8Array(pending)));
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      if (consumeLine) pushLine.pushInvalidLine("invalid_utf8");
      else pushLine.pushParseError("invalid_utf8");
      return !consumeLine;
    } finally {
      pending = [];
    }
    return false;
  };

  return {
    push(bytes: Uint8Array) {
      for (const byte of bytes) {
        pending.push(byte);
        if (byte === 0x0a) pushPending(true);
      }
    },
    finish() {
      return pushPending(false);
    },
  };
}

function lineParser(records: ParsedTrailRecord[]) {
  let pending = "";
  let lineNumber = 1;
  return {
    pushText(text: string) {
      pending += text;
      let newlineIndex = pending.indexOf("\n");
      while (newlineIndex !== -1) {
        pushParsedLine(
          records,
          stripTrailingCarriageReturn(pending.slice(0, newlineIndex)),
          lineNumber,
        );
        pending = pending.slice(newlineIndex + 1);
        lineNumber += 1;
        newlineIndex = pending.indexOf("\n");
      }
    },
    pushParseError(code: string) {
      records.push({ line: lineNumber, record: { type: "x-parse-error", code } });
      pending = "";
    },
    pushInvalidLine(code: string) {
      records.push({ line: lineNumber, record: { type: "x-parse-error", code } });
      pending = "";
      lineNumber += 1;
    },
    consumeLine() {
      pending = "";
      lineNumber += 1;
    },
    finish() {
      if (pending.length === 0) return;
      pushParsedLine(records, stripTrailingCarriageReturn(pending), lineNumber);
    },
  };
}

function pushParsedLine(records: ParsedTrailRecord[], raw: string, line: number): void {
  if (raw.trim().length === 0) {
    records.push({ line, record: { type: "x-parse-error", code: "empty_line", raw } });
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    records.push({ line, record: { type: "x-parse-error", code: "invalid_json", raw } });
    return;
  }

  const record = isJsonObject(parsed)
    ? (parsed as TrailRecordLike)
    : ({ type: "x-parse-error", code: "non_object", value: parsed } as UnknownTrailRecord);
  records.push({ line, record });
}

function stripTrailingCarriageReturn(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

/**
 * @internal
 */
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
