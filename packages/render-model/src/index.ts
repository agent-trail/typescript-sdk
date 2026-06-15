/**
 * Renderer-agnostic transcript model APIs for Agent Trail viewers.
 *
 * @packageDocumentation
 */

import { buildRenderEvents } from "./events.js";
import { buildTranscriptItems, DEFAULT_FILTERS, filterTranscriptItems } from "./transcript.js";
import type { BuildRenderModelOptions, RenderModel, RenderTrail } from "./types.js";

export {
  buildTranscriptItems,
  DEFAULT_FILTERS,
  FILTERS,
  filterTranscriptItems,
  renderItemAnchor,
  renderItemKey,
  renderItemLabel,
  renderItemPreview,
  toolGroupTimestamp,
} from "./transcript.js";
export type {
  ActiveFilters,
  BuildRenderModelOptions,
  EventFilter,
  RenderEvent,
  RenderEventKind,
  RenderMeta,
  RenderModel,
  RenderModelSummary,
  RenderSessionGroup,
  RenderToolInfo,
  RenderTrail,
  RenderTrailRecord,
  ToolTranscriptItem,
  TrailDiagnostic,
  TranscriptItem,
} from "./types.js";

/** Build a renderer-agnostic model from an already-parsed Agent Trail.
 *
 * @public
 */
export function buildRenderModel(
  trail: RenderTrail,
  options: BuildRenderModelOptions = {},
): RenderModel {
  const events = buildRenderEvents(trail);
  const allTranscriptItems = buildTranscriptItems(events);
  const filters = options.filters ?? DEFAULT_FILTERS;
  return {
    events,
    allTranscriptItems,
    transcriptItems: filterTranscriptItems(allTranscriptItems, filters),
    summary: {
      records: trail.records.length,
      sessions: trail.groups.length,
      warnings:
        options.diagnostics?.filter((diagnostic) => diagnostic.severity === "warning").length ?? 0,
    },
  };
}
