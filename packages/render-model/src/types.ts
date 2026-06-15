/** Parsed trail record shape consumed by the render model.
 *
 * @public
 */
export type RenderTrailRecord = {
  line: number;
  record: object;
};

/** Parsed session group shape consumed by the render model.
 *
 * @public
 */
export type RenderSessionGroup = {
  events: RenderTrailRecord[];
};

/** Parsed trail shape consumed by the render model.
 *
 * Compatible with `@agent-trail/core` `ParsedTrail`.
 *
 * @public
 */
export type RenderTrail = {
  records: RenderTrailRecord[];
  groups: RenderSessionGroup[];
};

/** Portable diagnostic shape used for warning counts.
 *
 * Compatible with `@agent-trail/core` `TrailDiagnostic`.
 *
 * @public
 */
export type TrailDiagnostic = {
  line: number;
  path: string;
  severity: "error" | "warning";
  code: string;
  message: string;
};

/** Event category understood by shared transcript renderers.
 *
 * @public
 */
export type RenderEventKind =
  | "agent"
  | "fallback"
  | "notice"
  | "summary"
  | "tool_aborted"
  | "tool_call"
  | "tool_result"
  | "user";

/** Metadata row displayed beside a render event.
 *
 * @public
 */
export type RenderMeta = {
  label: string;
  value: string;
};

/** Tool lifecycle metadata used for grouping calls, results, and aborts.
 *
 * @public
 */
export type RenderToolInfo = {
  forId?: string;
  name?: string;
  scope?: string;
  semanticCallId?: string;
};

/** Display-neutral event derived from one Agent Trail record.
 *
 * @public
 */
export type RenderEvent = {
  id: string | null;
  line: number;
  parentId?: string;
  ts: string | null;
  type: string;
  kind: RenderEventKind;
  title: string;
  body: string | null;
  meta: RenderMeta[];
  rawJson?: string;
  sessionIndex: number;
  status?: "error" | "ok" | "unknown";
  tool?: RenderToolInfo;
};

/** Transcript filter category.
 *
 * @public
 */
export type EventFilter = "agent" | "thinking" | "tool" | "user";

/** Enabled transcript filters keyed by category.
 *
 * @public
 */
export type ActiveFilters = Readonly<Record<EventFilter, boolean>>;

/** One transcript item in the shared render model.
 *
 * @public
 */
export type TranscriptItem =
  | { kind: "agent"; event: RenderEvent }
  | ToolTranscriptItem
  | { kind: "tool_group"; items: ToolTranscriptItem[] }
  | { kind: "user"; event: RenderEvent };

/** Tool transcript item containing any matched lifecycle events.
 *
 * @public
 */
export type ToolTranscriptItem = {
  abort?: RenderEvent;
  call?: RenderEvent;
  kind: "tool";
  result?: RenderEvent;
};

/** Options for building a render model.
 *
 * @public
 */
export type BuildRenderModelOptions = {
  diagnostics?: readonly TrailDiagnostic[];
  filters?: ActiveFilters;
};

/** Summary counts for a rendered trail.
 *
 * @public
 */
export type RenderModelSummary = {
  records: number;
  sessions: number;
  warnings: number;
};

/** Shared render model consumed by web and TUI viewers.
 *
 * @public
 */
export type RenderModel = {
  /** Full display-neutral event stream, including summaries, notices, and fallback records. */
  events: RenderEvent[];
  /** Unfiltered transcript stream containing only user, agent/thinking, and tool items. */
  allTranscriptItems: TranscriptItem[];
  /** Filtered transcript stream containing only user, agent/thinking, and tool items. */
  transcriptItems: TranscriptItem[];
  /** Aggregate counts for the parsed trail and supplied diagnostics. */
  summary: RenderModelSummary;
};
