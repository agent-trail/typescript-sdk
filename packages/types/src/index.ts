import type { SemanticMetadata, SourceMetadata, TaskPlanItem } from "./generated.js";

export type * from "./generated.js";
export type {
  AgentTrailV010 as TrailRecord,
  Entry as TrailEntry,
  Header as SessionHeader,
} from "./generated.js";
export type AgentName = NonNullable<SourceMetadata["agent"]>;
export type ToolKind = NonNullable<SemanticMetadata["tool_kind"]>;
export type TaskPlanStatus = TaskPlanItem["status"];
