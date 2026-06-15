export { defineMapping } from "./mapping/define-mapping.js";
export {
  canonicalizeIdentityString,
  deriveSessionUid,
  deriveSynthesizedEntryId,
} from "./mapping/ids.js";
export { type Adapter, defineAdapter } from "./pipeline/define-adapter.js";
export { commandFrom, filePathFrom } from "./primitives/args.js";
export { coerceInt } from "./primitives/coerce.js";
export { isObject, jsonObjectValue, stringValue } from "./primitives/guards.js";
export { quoteShellArg } from "./primitives/shell.js";
export { type AgentMessageUsage, mapAgentMessageUsage, pick } from "./primitives/usage.js";
export {
  chainReaders,
  type MergeByTimestampOptions,
  mergeByTimestamp,
} from "./readers/compose.js";
export { JsonlReader, type JsonlReaderOptions } from "./readers/jsonl-reader.js";
// SqliteReader is driver-agnostic. Under Bun, import the driver from the
// `@agent-trail/adapter-kit/bun-sqlite` subpath (`bunSqliteDriver`); Node
// consumers inject a `better-sqlite3` wrapper matching the `SqliteDriver` shape.
export {
  type SqliteConnection,
  type SqliteDriver,
  type SqlitePreparedStatement,
  SqliteReader,
  type SqliteReaderOptions,
} from "./readers/sqlite-reader.js";
export type { RawRecord, SourcePointer, SourceReader, SourceSnapshot } from "./readers/types.js";
export { selectSchemaVersion } from "./source-schemas/select.js";
export { validateSourceRecord } from "./source-schemas/validate.js";
export type {
  AdapterDef,
  LinkerHints,
  MappingDef,
  MatchPattern,
  OverrideCtx,
  OverrideDef,
  ParseOptions,
  ReconcilerConfig,
  ReconcilerRule,
  ReconcilerRuleCtx,
  TrailEntryDraft,
} from "./types.js";
