import type { AgentName, Entry, SemanticMetadata, SourceMetadata } from "@agent-trail/types";
import type { RawRecord, SourceReader } from "./readers/types.js";

/**
 * Transient cross-reference hints a pure mapping attaches to an emitted draft.
 * The reconciler consumes these in pass 2 and strips `meta.linker` before final
 * output — the trail `meta` field has no `linker` slot.
 */
export interface LinkerHints {
  /** Source-native call id used to pair tool calls and results. */
  call_id?: string;
}

/** Draft `meta` with the transient `linker` slot. Other keys are free-form. */
export type MetaWithLinker = { linker?: LinkerHints } & Record<string, unknown>;

/**
 * What a pure mapping (or override) emits in pass 1. The engine assigns `id`
 * and `ts`; the reconciler assigns `parent_id` (unless the draft sets it
 * explicitly). `payload`/`semantic`/`source` mirror the final `Entry`.
 */
export interface TrailEntryDraft {
  /** Final trail entry type. */
  type: Entry["type"];
  /** Final entry payload body. */
  payload?: Record<string, unknown> | undefined;
  /** Semantic metadata for identity, pairing, and tool classification. */
  semantic?: SemanticMetadata | undefined;
  /** Source metadata preserved on the emitted entry. */
  source?: SourceMetadata | undefined;
  /** Explicit parent id, or `null` to force a root entry. */
  parent_id?: string | null | undefined;
  /** Free-form metadata plus transient linker hints. */
  meta?: MetaWithLinker | undefined;
}

/**
 * Deep-partial structural matcher bound to the source record type `T`. Keys
 * present in the pattern must deep-equal the record; nested objects recurse.
 * e.g. `{ type: "response_item", payload: { type: "message" } }`. For the
 * default `RawRecord` this collapses to an open `{ [k: string]?: unknown }`.
 */
export type MatchPattern<T extends Record<string, unknown> = Record<string, unknown>> = {
  [K in keyof T]?: MatchPatternValue<T[K]>;
};

/** Value matcher for one property in a deep-partial `MatchPattern`. */
export type MatchPatternValue<V> = V extends Record<string, unknown> ? MatchPattern<V> : V;

/** Pure mapping from matching source records to trail entry drafts. */
export interface MappingDef<T extends RawRecord = RawRecord> {
  /** Pattern that selects records handled by this mapping. */
  match: MatchPattern<T>;
  /** Emit zero or more entry drafts for a matching record. */
  emit: (record: T) => TrailEntryDraft[];
}

/** Context passed to stateful override mappings. */
export interface OverrideCtx<S> {
  /** Back-look over raw records already seen this parse (most recent last). */
  window: { recent(n: number): RawRecord[] };
  /** Mutable adapter-defined state for this parse. */
  state: S;
  /** Emit a synthetic draft outside the matched record's own output. */
  emit(draft: TrailEntryDraft): void;
}

/** Stateful mapping hook that can observe prior records and adapter state. */
export interface OverrideDef<T extends RawRecord = RawRecord, S = unknown> {
  /** Pattern that selects records handled by this override. */
  match: MatchPattern<T>;
  /** Emit zero or more entry drafts using override context. */
  emit: (record: T, ctx: OverrideCtx<S>) => TrailEntryDraft[];
}

/** Context passed to a custom reconciler rule. */
export interface ReconcilerRuleCtx {
  /** Adapter name for the source being reconciled. */
  agent: AgentName;
  /** Raw source records for rules that need source context. */
  records?: RawRecord[];
}

/** Custom reconciler transform for mapped trail entries. */
export type ReconcilerRule = (entries: Entry[], ctx: ReconcilerRuleCtx) => Entry[];

/** Built-in and custom reconciliation passes to run after pure mapping. */
export interface ReconcilerConfig {
  /** Pair tool result entries to preceding tool calls. */
  toolLinking?: boolean;
  /** Resolve parent chains across source records. */
  parentChain?: boolean;
  /** Reconcile cumulative token counters. */
  cumulativeTokens?: boolean;
  /** Enable branch reconciliation. */
  branchReconciliation?: boolean;
  /** Custom reconciliation rules run after configured built-in passes. */
  custom?: ReconcilerRule[];
}

/** Declarative adapter definition consumed by `defineAdapter`. */
export interface AdapterDef<S = unknown> {
  /** Emitted Agent Trail agent name. */
  agent: AgentName;
  /**
   * Source-schema registry key for `selectSchemaVersion` / `validateSourceRecord`,
   * when it differs from the emitted `agent`. Defaults to `agent`. Needed when the
   * upstream schema is registered under a short name (e.g. Codex: emitted agent
   * `"codex"`, schema key `"codex"`).
   */
  schemaAgent?: string | undefined;
  /** UUID namespace for synthesized entry ids (spec §9.5). */
  idNamespace: string;
  /** Vendor namespace for quarantine `system_event` kinds (kebab-case). */
  quarantineNamespace: string;
  /** Source-format versions understood by this adapter. */
  sourceFormatVersions: string[];
  /** Reader that loads raw source records. */
  reader: SourceReader;
  /** Extract the ISO-8601 entry timestamp from a source record. */
  tsFrom: (record: RawRecord) => string;
  /** Pure mappings run for every source record. */
  mappings: MappingDef<RawRecord>[];
  /** Optional stateful overrides. */
  overrides?: OverrideDef<RawRecord, S>[] | undefined;
  /** Initial adapter-defined state for each parse. */
  initialState?: (() => S) | undefined;
  /** Reconciliation passes to run after mapping. */
  reconciler: ReconcilerConfig;
}

/** Options passed to an adapter parse invocation. */
export interface ParseOptions {
  /** Stable per-session id used to seed synthesized entry ids. */
  sessionUid: string;
}
