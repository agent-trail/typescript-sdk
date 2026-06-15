import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildTranscriptItems,
  DEFAULT_FILTERS,
  filterTranscriptItems,
  type RenderEvent,
} from "@agent-trail/render-model";

type OldTranscriptModule = {
  buildTranscriptItemsForViewer: (
    events: RenderEvent[],
    activeFilters: typeof DEFAULT_FILTERS,
  ) => unknown[];
};

type OracleCase = {
  name: string;
  events: RenderEvent[];
};

const oldRepo = process.env.OLD_AGENT_TRAIL_REPO;

if (oldRepo === undefined || oldRepo.length === 0) {
  console.log("render-model oracle: skipped; set OLD_AGENT_TRAIL_REPO to old monorepo path");
  process.exit(0);
}

const oldModulePath = path.join(oldRepo, "apps/website/src/components/viewer-transcript-model.ts");

if (!existsSync(oldModulePath)) {
  console.error(`render-model oracle: missing old viewer model at ${oldModulePath}`);
  process.exit(1);
}

const oldModule = (await import(pathToFileURL(oldModulePath).href)) as OldTranscriptModule;

for (const oracleCase of oracleCases()) {
  const oldItems = oldModule.buildTranscriptItemsForViewer(oracleCase.events, DEFAULT_FILTERS);
  const newItems = filterTranscriptItems(buildTranscriptItems(oracleCase.events), DEFAULT_FILTERS);
  if (JSON.stringify(oldItems) !== JSON.stringify(newItems)) {
    console.error(`render-model oracle: divergence in ${oracleCase.name}`);
    console.error("old:");
    console.error(JSON.stringify(oldItems, null, 2));
    console.error("new:");
    console.error(JSON.stringify(newItems, null, 2));
    process.exit(1);
  }
}

console.log("render-model oracle: ok");

function oracleCases(): OracleCase[] {
  return [
    {
      name: "explicit grouped tools",
      events: [
        toolCallEvent(2, "01HEVTA0000000000000000001", "file_search"),
        toolResultEvent(3, "01HEVTA0000000000000000002", "01HEVTA0000000000000000001"),
        toolCallEvent(4, "01HEVTA0000000000000000003", "file_read"),
        toolResultEvent(5, "01HEVTA0000000000000000004", "01HEVTA0000000000000000003"),
      ],
    },
    {
      name: "semantic fallback",
      events: [
        toolCallEvent(2, "01HEVTA0000000000000000001", "file_search", {
          semanticCallId: "call-1",
        }),
        toolResultEvent(3, "01HEVTA0000000000000000002", undefined, {
          semanticCallId: "call-1",
        }),
      ],
    },
    {
      name: "subagent branch separation",
      events: [
        toolCallEvent(2, "01HEVTA0000000000000000001", "subagent_invoke"),
        toolCallEvent(3, "01HEVTA0000000000000000002", "file_read"),
        toolResultEvent(4, "01HEVTA0000000000000000003", undefined, {
          parentId: "01HEVTA0000000000000000001",
        }),
      ],
    },
  ];
}

function toolCallEvent(
  line: number,
  id: string,
  toolName: string,
  options: {
    parentId?: string;
    semanticCallId?: string;
    sessionIndex?: number;
  } = {},
): RenderEvent {
  return {
    body: toolName,
    id,
    kind: "tool_call",
    line,
    meta: [],
    ...optionalParentId(options.parentId),
    sessionIndex: options.sessionIndex ?? 0,
    ts: "2026-05-17T14:00:07.000Z",
    title: `Tool call: ${toolName}`,
    tool: { name: toolName, ...optionalSemanticCallId(options.semanticCallId) },
    type: "tool_call",
  };
}

function toolResultEvent(
  line: number,
  id: string,
  forId?: string,
  options: {
    parentId?: string;
    semanticCallId?: string;
    sessionIndex?: number;
  } = {},
): RenderEvent {
  return {
    body: "result",
    id,
    kind: "tool_result",
    line,
    meta: [],
    ...optionalParentId(options.parentId),
    sessionIndex: options.sessionIndex ?? 0,
    status: "ok",
    ts: "2026-05-17T14:00:08.000Z",
    title: "Tool result: ok",
    tool: { ...optionalForId(forId), ...optionalSemanticCallId(options.semanticCallId) },
    type: "tool_result",
  };
}

function optionalParentId(parentId: string | undefined): { parentId?: string } {
  return parentId === undefined ? {} : { parentId };
}

function optionalForId(forId: string | undefined): { forId?: string } {
  return forId === undefined ? {} : { forId };
}

function optionalSemanticCallId(semanticCallId: string | undefined): { semanticCallId?: string } {
  return semanticCallId === undefined ? {} : { semanticCallId };
}
