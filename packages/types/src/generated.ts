/* This file is generated from @agent-trail/schema. Run `bun run generate:types` to update it. */

/**
 * Validates a single Agent Trail JSONL record: trail envelope, session header, or event entry. File layout rules such as envelope position and multi-session grouping are enforced by whole-file validation; per-event payload shapes are enforced via the events subschemas.
 */
export type AgentTrailV010 = TrailEnvelope | Header | Entry;
/**
 * SHA-256 hash as lowercase hex (64 chars)
 */
export type Sha256Hex = string;
/**
 * Version control context for the trail file.
 */
export type Vcs = (
  | {
      revision?: string;
      [k: string]: unknown | undefined;
    }
  | {
      /**
       * Version control revision at session capture, or null for an unborn head.
       */
      revision?: null;
      /**
       * Active branch name required when revision is null.
       */
      branch: string;
      [k: string]: unknown | undefined;
    }
) & {
  /**
   * Version control system kind or vendor-namespaced extension.
   */
  type: ("git" | "jj" | "hg" | "svn") | string;
  /**
   * Version control revision at session capture, or null for an unborn head.
   */
  revision: string | null;
  /**
   * Canonical remote URL for the working tree. Adapters MUST normalize before emission: strip embedded credentials, strip trailing .git for git URLs, and normalize SSH/HTTPS variants to a single canonical form (https://host/path).
   */
  remote_url?: string;
  /**
   * Active branch / bookmark / topic name the session is running on. For git, the short branch name (e.g., `feature/x`). Detached-HEAD sessions MAY omit this field.
   */
  branch?: string;
  /**
   * Commit hash at session start (lowercase hex, 7-64 chars). For git this is typically the same value as `revision`; the field exists as an explicit, version-control-neutral alias and survives across VCS migrations.
   */
  head_commit?: string;
  worktree?: Worktree;
};
/**
 * Session header. The first session header is required at line 1, or at line 2 when a trail envelope occupies line 1. Multi-session files (spec §9.6) carry additional session headers later in the file; each opens a new (header, events*) group. Not part of the event graph.
 */
export type Header = {
  [k: string]: unknown | undefined;
} & {
  /**
   * Session header discriminator.
   */
  type: "session";
  /**
   * Agent Trail schema version for the session header.
   */
  schema_version: "0.1.0";
  /**
   * Globally unique identifier for this session header.
   */
  id: string;
  /**
   * Human-readable session name.
   */
  name?: string;
  /**
   * Human-readable session description.
   */
  description?: string;
  /**
   * User-visible tags associated with the session.
   */
  tags?: string[];
  /**
   * Globally-unique source-session identifier. Stable across all segments of one source session (spec §9.5). Reconcilers group segments by session_uid. Optional in v0.1 single-segment trails; writers SHOULD emit it for forward-compat. Required (and enforced by the header allOf if/then) when segment.seq > 1. ULID is recommended (lexicographic tie-breaker); UUID accepted.
   */
  session_uid?: string;
  segment?: Segment;
  /**
   * Content hash for the finalized session group, or pending marker while open.
   */
  content_hash?: Sha256Hex | "<pending>";
  /**
   * Writer timestamp for the session header.
   */
  ts: string;
  /**
   * Live-capture marker. Present means writer is actively appending or last appended in streaming mode. Absent means non-streaming or unaware writer.
   */
  stream?: {
    /**
     * Current live-capture state for the session stream.
     */
    state: "open" | "closed";
    /**
     * Writer timestamp when live capture started.
     */
    started_at?: string;
  };
  /**
   * Agent runtime that produced the session.
   */
  agent: {
    /**
     * Human-readable session name.
     */
    name:
      | (
          | "claude-code"
          | "pi"
          | "openclaw"
          | "codex"
          | "cursor"
          | "opencode"
          | "aider"
          | "amp"
          | "cline"
          | "crush"
          | "kimi-code"
          | "qwen-code"
          | "factory"
          | "vibe"
          | "copilot-cli"
          | "copilot-chat"
          | "chatgpt"
          | "clawdbot"
        )
      | string;
    /**
     * Agent runtime version when reported.
     */
    version?: string;
    /**
     * Default model configured for the agent at session start.
     */
    model_default?: string;
  };
  /**
   * Working directory where the session ran.
   */
  cwd?: string;
  vcs?: Vcs1;
  /**
   * Parent session artifact this session was forked from.
   */
  fork_from?: {
    /**
     * Identifier of the parent session.
     */
    session_id: string;
    /**
     * SHA-256 hash as lowercase hex (64 chars)
     */
    content_hash?: string;
    /**
     * Entry identifier in the parent session that spawned this session.
     */
    entry_id?: string;
  };
  /**
   * Prior content hash this redacted session derives from.
   */
  redacted_from?: {
    /**
     * SHA-256 hash as lowercase hex (64 chars)
     */
    content_hash: string;
  };
  parse_fidelity?: ParseFidelity;
  /**
   * Source file metadata for imported session input.
   */
  source?: {
    /**
     * Source agent name reported for imported session input.
     */
    agent?:
      | (
          | "claude-code"
          | "pi"
          | "openclaw"
          | "codex"
          | "cursor"
          | "opencode"
          | "aider"
          | "amp"
          | "cline"
          | "crush"
          | "kimi-code"
          | "qwen-code"
          | "factory"
          | "vibe"
          | "copilot-cli"
          | "copilot-chat"
          | "chatgpt"
          | "clawdbot"
        )
      | string;
    /**
     * Source file path for imported session input.
     */
    path?: string;
    /**
     * Source format version for imported session input.
     */
    format_version?: string;
  };
  /**
   * Free-form vendor extensions. Recommended keys use the x-<vendor>/<name> extension grammar (spec §8.3).
   */
  meta?: {
    [k: string]: unknown | undefined;
  };
};
/**
 * Multi-segment marker for this session group.
 */
export type Segment =
  | {
      /**
       * Segment sequence number within a source session.
       */
      seq: 1;
    }
  | {
      /**
       * Segment sequence number within a source session.
       */
      seq: number;
      /**
       * Content hash of the previous segment, or null when unavailable.
       */
      prev_content_hash: Sha256Hex | null;
    };
/**
 * Version control context for the session.
 */
export type Vcs1 = (
  | {
      revision?: string;
      [k: string]: unknown | undefined;
    }
  | {
      /**
       * Version control revision at session capture, or null for an unborn head.
       */
      revision?: null;
      /**
       * Active branch name required when revision is null.
       */
      branch: string;
      [k: string]: unknown | undefined;
    }
) & {
  /**
   * Version control system kind or vendor-namespaced extension.
   */
  type: ("git" | "jj" | "hg" | "svn") | string;
  /**
   * Version control revision at session capture, or null for an unborn head.
   */
  revision: string | null;
  /**
   * Canonical remote URL for the working tree. Adapters MUST normalize before emission: strip embedded credentials, strip trailing .git for git URLs, and normalize SSH/HTTPS variants to a single canonical form (https://host/path).
   */
  remote_url?: string;
  /**
   * Active branch / bookmark / topic name the session is running on. For git, the short branch name (e.g., `feature/x`). Detached-HEAD sessions MAY omit this field.
   */
  branch?: string;
  /**
   * Commit hash at session start (lowercase hex, 7-64 chars). For git this is typically the same value as `revision`; the field exists as an explicit, version-control-neutral alias and survives across VCS migrations.
   */
  head_commit?: string;
  worktree?: Worktree;
};
export type Entry = EntryBase &
  (
    | UserMessage
    | AgentMessage
    | TaskPlanUpdate
    | ToolCall
    | ToolResult
    | ToolCallAborted
    | UserQuery
    | UserQueryResponse
    | SessionSummary
    | SystemEvent
    | AgentThinking
    | UserInterrupt
    | ContextCompact
    | BranchPoint
    | BranchSummary
    | ModelChange
    | ModeChange
    | ThinkingLevelChange
    | SessionTerminated
    | SessionEnd
    | CommandInvoke
    | CapabilityChange
    | SessionMetadataUpdate
  );
/**
 * An image or file carried by a message or tool result, by reference. v0.1.0 uri schemes are references only (https:, local file:, content-addressed sha256:); inline data: payloads are deferred.
 */
export type Attachment = Attachment1 & {
  /**
   * Attachment kind carried by the message or tool result.
   */
  kind: "image" | "file" | "other";
  /**
   * Media type reported for the attachment.
   */
  media_type?: string;
  /**
   * Reference URI for attachment content.
   */
  uri?: string;
  /**
   * Display or source name for the attachment.
   */
  name?: string;
};
export type Attachment1 =
  | {
      uri: unknown;
      [k: string]: unknown | undefined;
    }
  | {
      name: unknown;
      [k: string]: unknown | undefined;
    };
/**
 * Token usage attached to this agent message.
 */
export type AgentMessageUsage = (
  | ((
      | {
          input_tokens: unknown;
          [k: string]: unknown | undefined;
        }
      | {
          input_tokens_cumulative: unknown;
          [k: string]: unknown | undefined;
        }
    ) &
      (
        | {
            output_tokens: unknown;
            [k: string]: unknown | undefined;
          }
        | {
            output_tokens_cumulative: unknown;
            [k: string]: unknown | undefined;
          }
      ))
  | {
      total_tokens: unknown;
      [k: string]: unknown | undefined;
    }
  | {
      total_tokens_cumulative: unknown;
      [k: string]: unknown | undefined;
    }
) & {
  /**
   * Input token count reported for this source envelope.
   */
  input_tokens?: number;
  /**
   * Output token count reported for this source envelope.
   */
  output_tokens?: number;
  /**
   * Cumulative input token count through this source envelope.
   */
  input_tokens_cumulative?: number;
  /**
   * Cumulative output token count through this source envelope.
   */
  output_tokens_cumulative?: number;
  /**
   * Total token count reported for this source envelope.
   */
  total_tokens?: number;
  /**
   * Cumulative total token count through this source envelope.
   */
  total_tokens_cumulative?: number;
  /**
   * Tokens read from model cache for this source envelope.
   */
  cache_read_tokens?: number;
  /**
   * Tokens written to model cache for this source envelope.
   */
  cache_creation_tokens?: number;
  /**
   * Reasoning token count reported for this source envelope.
   */
  reasoning_tokens?: number;
  /**
   * Source-reported context input token pressure for this request.
   */
  context_input_tokens?: number;
  /**
   * Model context window size reported by the source.
   */
  context_window_tokens?: number;
};
export type TaskPlanDelta =
  | {
      /**
       * Task plan delta discriminator.
       */
      kind: "added";
      /**
       * Identifier of the task plan item affected by this delta.
       */
      item_id: string;
      /**
       * Task plan item text after this delta.
       */
      to_content: string;
      /**
       * Task plan item status after this delta.
       */
      to_status: "pending" | "in_progress" | "completed" | "cancelled" | "blocked";
      /**
       * Active-progress phrasing after this delta.
       */
      to_active_form?: string;
    }
  | {
      /**
       * Task plan delta discriminator.
       */
      kind: "removed";
      /**
       * Identifier of the task plan item affected by this delta.
       */
      item_id: string;
      /**
       * Task plan item text before this delta.
       */
      from_content: string;
      /**
       * Task plan item status before this delta.
       */
      from_status: "pending" | "in_progress" | "completed" | "cancelled" | "blocked";
      /**
       * Active-progress phrasing before this delta.
       */
      from_active_form?: string;
    }
  | {
      /**
       * Task plan delta discriminator.
       */
      kind: "status_changed";
      /**
       * Identifier of the task plan item affected by this delta.
       */
      item_id: string;
      /**
       * Task plan item status before this delta.
       */
      from_status: "pending" | "in_progress" | "completed" | "cancelled" | "blocked";
      /**
       * Task plan item status after this delta.
       */
      to_status: "pending" | "in_progress" | "completed" | "cancelled" | "blocked";
    }
  | {
      /**
       * Task plan delta discriminator.
       */
      kind: "content_changed";
      /**
       * Identifier of the task plan item affected by this delta.
       */
      item_id: string;
      /**
       * Task plan item text before this delta.
       */
      from_content: string;
      /**
       * Task plan item text after this delta.
       */
      to_content: string;
    };
/**
 * Token usage attached to this tool call when it is the first usage-capable derived entry.
 */
export type AgentMessageUsage1 = (
  | ((
      | {
          input_tokens: unknown;
          [k: string]: unknown | undefined;
        }
      | {
          input_tokens_cumulative: unknown;
          [k: string]: unknown | undefined;
        }
    ) &
      (
        | {
            output_tokens: unknown;
            [k: string]: unknown | undefined;
          }
        | {
            output_tokens_cumulative: unknown;
            [k: string]: unknown | undefined;
          }
      ))
  | {
      total_tokens: unknown;
      [k: string]: unknown | undefined;
    }
  | {
      total_tokens_cumulative: unknown;
      [k: string]: unknown | undefined;
    }
) & {
  /**
   * Input token count reported for this source envelope.
   */
  input_tokens?: number;
  /**
   * Output token count reported for this source envelope.
   */
  output_tokens?: number;
  /**
   * Cumulative input token count through this source envelope.
   */
  input_tokens_cumulative?: number;
  /**
   * Cumulative output token count through this source envelope.
   */
  output_tokens_cumulative?: number;
  /**
   * Total token count reported for this source envelope.
   */
  total_tokens?: number;
  /**
   * Cumulative total token count through this source envelope.
   */
  total_tokens_cumulative?: number;
  /**
   * Tokens read from model cache for this source envelope.
   */
  cache_read_tokens?: number;
  /**
   * Tokens written to model cache for this source envelope.
   */
  cache_creation_tokens?: number;
  /**
   * Reasoning token count reported for this source envelope.
   */
  reasoning_tokens?: number;
  /**
   * Source-reported context input token pressure for this request.
   */
  context_input_tokens?: number;
  /**
   * Model context window size reported by the source.
   */
  context_window_tokens?: number;
};
/**
 * Token usage attached to this thinking block.
 */
export type AgentMessageUsage2 = (
  | ((
      | {
          input_tokens: unknown;
          [k: string]: unknown | undefined;
        }
      | {
          input_tokens_cumulative: unknown;
          [k: string]: unknown | undefined;
        }
    ) &
      (
        | {
            output_tokens: unknown;
            [k: string]: unknown | undefined;
          }
        | {
            output_tokens_cumulative: unknown;
            [k: string]: unknown | undefined;
          }
      ))
  | {
      total_tokens: unknown;
      [k: string]: unknown | undefined;
    }
  | {
      total_tokens_cumulative: unknown;
      [k: string]: unknown | undefined;
    }
) & {
  /**
   * Input token count reported for this source envelope.
   */
  input_tokens?: number;
  /**
   * Output token count reported for this source envelope.
   */
  output_tokens?: number;
  /**
   * Cumulative input token count through this source envelope.
   */
  input_tokens_cumulative?: number;
  /**
   * Cumulative output token count through this source envelope.
   */
  output_tokens_cumulative?: number;
  /**
   * Total token count reported for this source envelope.
   */
  total_tokens?: number;
  /**
   * Cumulative total token count through this source envelope.
   */
  total_tokens_cumulative?: number;
  /**
   * Tokens read from model cache for this source envelope.
   */
  cache_read_tokens?: number;
  /**
   * Tokens written to model cache for this source envelope.
   */
  cache_creation_tokens?: number;
  /**
   * Reasoning token count reported for this source envelope.
   */
  reasoning_tokens?: number;
  /**
   * Source-reported context input token pressure for this request.
   */
  context_input_tokens?: number;
  /**
   * Model context window size reported by the source.
   */
  context_window_tokens?: number;
};
/**
 * Any JSON value.
 */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | {
      [k: string]: JsonValue;
    };

/**
 * Optional trail envelope record (line 1). File-level metadata; not part of the event graph. When present, MUST appear at line 1 and the first session header MUST follow on line 2. At most one per file. Multi-session files (spec §9.6) carry one envelope followed by N session groups in file order.
 */
export interface TrailEnvelope {
  /**
   * Trail envelope discriminator.
   */
  type: "trail";
  /**
   * Agent Trail schema version for the envelope record.
   */
  schema_version: "0.1.0";
  /**
   * Globally unique identifier for this trail envelope.
   */
  id: string;
  /**
   * Human-readable trail name.
   */
  name?: string;
  /**
   * Human-readable trail description.
   */
  description?: string;
  /**
   * Writer timestamp for the trail envelope.
   */
  ts: string;
  /**
   * Producer name and version that wrote the trail file.
   */
  producer: string;
  /**
   * Content hash for the finalized trail file, or pending marker while open.
   */
  content_hash?: Sha256Hex | "<pending>";
  /**
   * User-visible tags associated with the trail file.
   */
  tags?: string[];
  vcs?: Vcs;
  /**
   * Prior trail artifact this trail was forked from.
   */
  fork_from?: {
    /**
     * Identifier of the prior trail artifact.
     */
    trail_id: string;
    /**
     * SHA-256 hash as lowercase hex (64 chars)
     */
    content_hash?: string;
  };
  /**
   * Prior content hash this redacted artifact derives from.
   */
  redacted_from?: {
    /**
     * SHA-256 hash as lowercase hex (64 chars)
     */
    content_hash: string;
  };
  /**
   * Optional manifest of sessions contained in the file, one entry per session group in file order (spec §8.4, §9.6). Validator warns on length mismatch or per-entry drift vs actual file content.
   */
  sessions?: {
    /**
     * Globally unique identifier for this trail envelope.
     */
    id: string;
    /**
     * Canonical agent name for the session manifest entry.
     */
    agent:
      | (
          | "claude-code"
          | "pi"
          | "openclaw"
          | "codex"
          | "cursor"
          | "opencode"
          | "aider"
          | "amp"
          | "cline"
          | "crush"
          | "kimi-code"
          | "qwen-code"
          | "factory"
          | "vibe"
          | "copilot-cli"
          | "copilot-chat"
          | "chatgpt"
          | "clawdbot"
        )
      | string;
  }[];
  /**
   * Free-form vendor extensions. Recommended keys use the x-<vendor>/<name> extension grammar.
   */
  meta?: {
    [k: string]: unknown | undefined;
  };
}
/**
 * Worktree context for the captured session.
 */
export interface Worktree {
  /**
   * Worktree name reported by the source.
   */
  name: string;
  /**
   * Filesystem path of the worktree.
   */
  path: string;
  /**
   * Working directory of the parent repository at the time the worktree was created.
   */
  original_cwd?: string;
  /**
   * Branch the parent repository was on when the worktree was created.
   */
  original_branch?: string;
  /**
   * Commit hash the worktree was forked from.
   */
  original_head_commit?: string;
}
/**
 * Parse fidelity summary for this session group.
 */
export interface ParseFidelity {
  /**
   * Number of quarantined source records emitted as x-* /unknown_record system_event entries in this session group.
   */
  quarantined_count: number;
  /**
   * Final abnormal session termination reason, when a session_terminated event is present.
   */
  termination_reason?: (
    | ("eof_with_open_tool_calls" | "process_terminated" | "truncated" | "user_abort")
    | {
        [k: string]: unknown | undefined;
      }
  ) &
    string;
}
export interface EntryBase {
  /**
   * Event type discriminator.
   */
  type: string;
  /**
   * Globally unique identifier for this event entry.
   */
  id: string;
  /**
   * Parent event ID in the session tree, or null for a root event.
   */
  parent_id?: string | null;
  /**
   * Writer timestamp for this event entry.
   */
  ts: string;
  /**
   * Event-specific payload object.
   */
  payload: object;
  semantic?: SemanticMetadata;
  source?: SourceMetadata;
  /**
   * Agent Trail metadata for this event.
   */
  meta?: {
    /**
     * Number of redactor mutations applied to this event entry.
     */
    redaction_count?: number;
    [k: string]: unknown | undefined;
  };
}
/**
 * Semantic linking metadata for this event.
 */
export interface SemanticMetadata {
  /**
   * Source semantic group identifier used for related events.
   */
  group_id?: string;
  /**
   * Source semantic tool-call identifier used for pairing.
   */
  call_id?: string;
  /**
   * Canonical tool kind associated with this semantic link.
   */
  tool_kind?:
    | "file_read"
    | "file_write"
    | "file_edit"
    | "file_patch"
    | "file_list"
    | "file_search"
    | "shell_command"
    | "shell_output"
    | "shell_input"
    | "mcp_call"
    | "web_fetch"
    | "web_search"
    | "tool_search"
    | "notebook_edit"
    | "subagent_invoke"
    | "other";
}
/**
 * Source metadata for this event.
 */
export interface SourceMetadata {
  /**
   * Source agent that produced the original event.
   */
  agent?:
    | (
        | "claude-code"
        | "pi"
        | "openclaw"
        | "codex"
        | "cursor"
        | "opencode"
        | "aider"
        | "amp"
        | "cline"
        | "crush"
        | "kimi-code"
        | "qwen-code"
        | "factory"
        | "vibe"
        | "copilot-cli"
        | "copilot-chat"
        | "chatgpt"
        | "clawdbot"
      )
    | string;
  /**
   * Original source event type before Agent Trail normalization.
   */
  original_type?: string;
  /**
   * Source schema or format version when reported.
   */
  schema_version?: string;
  /**
   * Opaque source object preserved verbatim. If an object, may use envelope_ref to reference an earlier entry's inlined envelope.
   */
  raw?: {
    [k: string]: unknown | undefined;
  };
  /**
   * Whether the adapter synthesized this metadata rather than copying it from source input.
   */
  synthesized?: boolean;
}
export interface UserMessage {
  /**
   * User message event discriminator.
   */
  type?: "user_message";
  /**
   * User message event payload.
   */
  payload?: {
    /**
     * User-role message text.
     */
    text: string;
    /**
     * Authorship marker for user-role text. Absent means user-authored.
     */
    origin?: (
      | ("user" | "injected" | "mixed")
      | {
          [k: string]: unknown | undefined;
        }
    ) &
      string;
    /**
     * Attachments carried by the user message.
     */
    attachments?: Attachment[];
  };
  [k: string]: unknown | undefined;
}
export interface AgentMessage {
  /**
   * Agent message event discriminator.
   */
  type?: "agent_message";
  /**
   * Agent message event payload.
   */
  payload?: {
    /**
     * Assistant-role message text.
     */
    text: string;
    /**
     * Model that produced this agent message.
     */
    model?: string;
    /**
     * Source-reported reason generation stopped.
     */
    stop_reason?: string;
    usage?: AgentMessageUsage;
    /**
     * Attachments carried by the agent message.
     */
    attachments?: Attachment[];
  };
  [k: string]: unknown | undefined;
}
export interface TaskPlanUpdate {
  /**
   * Task plan update event discriminator.
   */
  type?: "task_plan_update";
  /**
   * Task plan update event payload.
   */
  payload?: {
    /**
     * Optional explanation accompanying the task plan update.
     */
    explanation?: string;
    /**
     * Full task plan state after the update.
     */
    items: TaskPlanItem[];
    /**
     * Incremental task plan changes represented by this update.
     */
    deltas?: TaskPlanDelta[];
  };
  [k: string]: unknown | undefined;
}
export interface TaskPlanItem {
  /**
   * Stable identifier for this task plan item.
   */
  id: string;
  /**
   * User-visible task plan item text.
   */
  content: string;
  /**
   * Current status of this task plan item.
   */
  status: "pending" | "in_progress" | "completed" | "cancelled" | "blocked";
  /**
   * Active-progress phrasing for this task plan item.
   */
  active_form?: string;
}
export interface ToolCall {
  /**
   * Tool call event discriminator.
   */
  type?: "tool_call";
  /**
   * Tool call event payload.
   */
  payload?: (
    | {
        /**
         * Canonical kind of tool requested by the agent.
         */
        tool: "file_read";
        args: ToolCallFileReadArgs;
        [k: string]: unknown | undefined;
      }
    | {
        /**
         * Canonical kind of tool requested by the agent.
         */
        tool: "file_write";
        args: ToolCallFileWriteArgs;
        [k: string]: unknown | undefined;
      }
    | {
        /**
         * Canonical kind of tool requested by the agent.
         */
        tool: "file_edit";
        /**
         * Arguments for a file edit tool call.
         */
        args:
          | {
              /**
               * Path of the file to edit.
               */
              path: string;
              /**
               * Patch or diff content describing the edit.
               */
              diff: string;
            }
          | {
              /**
               * Path of the file to edit.
               */
              path: string;
              /**
               * Original text expected in the target file.
               */
              old: string;
              /**
               * Replacement text for the target file.
               */
              new: string;
              /**
               * Whether all matching occurrences are replaced.
               */
              replace_all?: boolean;
            };
        [k: string]: unknown | undefined;
      }
    | {
        /**
         * Canonical kind of tool requested by the agent.
         */
        tool: "file_patch";
        args: ToolCallFilePatchArgs;
        [k: string]: unknown | undefined;
      }
    | {
        /**
         * Canonical kind of tool requested by the agent.
         */
        tool: "file_list";
        args: ToolCallFileListArgs;
        [k: string]: unknown | undefined;
      }
    | {
        /**
         * Canonical kind of tool requested by the agent.
         */
        tool: "file_search";
        args: ToolCallFileSearchArgs;
        [k: string]: unknown | undefined;
      }
    | {
        /**
         * Canonical kind of tool requested by the agent.
         */
        tool: "shell_command";
        args: ToolCallShellCommandArgs;
        [k: string]: unknown | undefined;
      }
    | {
        /**
         * Canonical kind of tool requested by the agent.
         */
        tool: "shell_output";
        args: ToolCallShellOutputArgs;
        [k: string]: unknown | undefined;
      }
    | {
        /**
         * Canonical kind of tool requested by the agent.
         */
        tool: "shell_input";
        args: ToolCallShellInputArgs;
        [k: string]: unknown | undefined;
      }
    | {
        /**
         * Canonical kind of tool requested by the agent.
         */
        tool: "mcp_call";
        args: ToolCallMcpCallArgs;
        [k: string]: unknown | undefined;
      }
    | {
        /**
         * Canonical kind of tool requested by the agent.
         */
        tool: "web_fetch";
        args: ToolCallWebFetchArgs;
        [k: string]: unknown | undefined;
      }
    | {
        /**
         * Canonical kind of tool requested by the agent.
         */
        tool: "web_search";
        args: ToolCallWebSearchArgs;
        [k: string]: unknown | undefined;
      }
    | {
        /**
         * Canonical kind of tool requested by the agent.
         */
        tool: "tool_search";
        args: ToolCallToolSearchArgs;
        [k: string]: unknown | undefined;
      }
    | {
        /**
         * Canonical kind of tool requested by the agent.
         */
        tool: "notebook_edit";
        args: ToolCallNotebookEditArgs;
        [k: string]: unknown | undefined;
      }
    | {
        /**
         * Canonical kind of tool requested by the agent.
         */
        tool: "subagent_invoke";
        args: ToolCallSubagentInvokeArgs;
        [k: string]: unknown | undefined;
      }
    | {
        /**
         * Canonical kind of tool requested by the agent.
         */
        tool: "other";
        args: ToolCallOtherArgs;
        [k: string]: unknown | undefined;
      }
  ) & {
    usage?: AgentMessageUsage1;
    /**
     * Content-addressed reference to full arguments when arguments are truncated.
     */
    overflow_ref?: string | null;
    [k: string]: unknown | undefined;
  } & (
      | {
          /**
           * Whether tool-call arguments were truncated before emission.
           */
          truncated: true;
          /**
           * UTF-8 byte length of the original args object before truncation. Required when truncated is true.
           */
          args_size: number;
          [k: string]: unknown | undefined;
        }
      | {
          /**
           * Whether tool-call arguments were truncated before emission.
           */
          truncated?: false;
          /**
           * UTF-8 byte length of the original args object before truncation. Required when truncated is true.
           */
          args_size?: number;
          [k: string]: unknown | undefined;
        }
    );
  [k: string]: unknown | undefined;
}
/**
 * Arguments for a file read tool call.
 */
export interface ToolCallFileReadArgs {
  /**
   * Path of the file to read.
   */
  path: string;
  /**
   * Optional inclusive line range requested from the file.
   *
   * @minItems 2
   * @maxItems 2
   */
  range?: [number, number];
}
/**
 * Arguments for a file write tool call.
 */
export interface ToolCallFileWriteArgs {
  /**
   * Path of the file to write.
   */
  path: string;
  /**
   * Full file content to write.
   */
  content: string;
}
/**
 * Arguments for an atomic multi-file patch tool call.
 */
export interface ToolCallFilePatchArgs {
  /**
   * Files changed by this patch request.
   *
   * @minItems 1
   */
  files: [
    {
      /**
       * Path of the file changed by this patch entry.
       */
      path: string;
      /**
       * Patch content for this file.
       */
      diff: string;
    },
    ...{
      /**
       * Path of the file changed by this patch entry.
       */
      path: string;
      /**
       * Patch content for this file.
       */
      diff: string;
    }[],
  ];
  /**
   * Whether the patch should be applied atomically.
   */
  atomic?: boolean;
}
/**
 * Arguments for a file listing tool call.
 */
export interface ToolCallFileListArgs {
  /**
   * Directory path to list.
   */
  path: string;
  /**
   * Whether nested directories are included.
   */
  recursive?: boolean;
  /**
   * Optional glob filter for listed paths.
   */
  glob?: string;
}
/**
 * Arguments for a file search tool call.
 */
export interface ToolCallFileSearchArgs {
  /**
   * Search query or pattern.
   */
  query: string;
  /**
   * Root path to search within.
   */
  path?: string;
  /**
   * Optional glob filter for searched paths.
   */
  glob?: string;
}
/**
 * Arguments for a shell command tool call.
 */
export interface ToolCallShellCommandArgs {
  /**
   * Shell command requested by the agent.
   */
  command: string;
  /**
   * Working directory for the shell command.
   */
  cwd?: string;
  /**
   * Requested command timeout.
   */
  timeout?: number;
}
/**
 * Arguments for polling shell command output.
 */
export interface ToolCallShellOutputArgs {
  /**
   * Source command identifier whose output is requested.
   */
  command_id?: string;
}
/**
 * Arguments for sending input to a running shell command.
 */
export interface ToolCallShellInputArgs {
  /**
   * Input text sent to the running command.
   */
  input: string;
  /**
   * Source shell session identifier.
   */
  session_id?: string;
  /**
   * Source command identifier receiving input.
   */
  command_id?: string;
}
/**
 * Arguments for an MCP tool call.
 */
export interface ToolCallMcpCallArgs {
  /**
   * MCP server name or identifier.
   */
  server: string;
  /**
   * MCP tool name invoked on the server.
   */
  tool: string;
  /**
   * Tool-specific argument object passed to the MCP tool.
   */
  args?: {
    [k: string]: unknown | undefined;
  };
  /**
   * Request headers supplied to the MCP call.
   */
  headers?: {
    [k: string]: unknown | undefined;
  };
}
/**
 * Arguments for a web fetch tool call.
 */
export interface ToolCallWebFetchArgs {
  /**
   * URL requested by the fetch.
   */
  url: string;
  /**
   * HTTP method requested by the fetch.
   */
  method?: string;
  /**
   * Request headers supplied to the fetch.
   */
  headers?: {
    [k: string]: unknown | undefined;
  };
}
/**
 * Arguments for a web search tool call.
 */
export interface ToolCallWebSearchArgs {
  /**
   * Search query submitted to the web search tool.
   */
  query: string;
}
/**
 * Arguments for a tool discovery search.
 */
export interface ToolCallToolSearchArgs {
  /**
   * Search query used to discover tools.
   */
  query: string;
  /**
   * Maximum number of tool results requested.
   */
  limit?: number;
}
/**
 * Arguments for a notebook edit tool call.
 */
export interface ToolCallNotebookEditArgs {
  /**
   * Notebook path to edit.
   */
  path: string;
  /**
   * Notebook cell identifier to edit.
   */
  cell_id?: string;
  /**
   * Patch content for the notebook edit.
   */
  diff?: string;
  /**
   * Replacement notebook cell content.
   */
  content?: string;
}
/**
 * Arguments for invoking a subagent.
 */
export interface ToolCallSubagentInvokeArgs {
  /**
   * Task prompt or instruction given to the subagent.
   */
  task: string;
  /**
   * Requested subagent type or role.
   */
  agent_type?: string;
  /**
   * Globally-unique identifier shape: canonical uppercase ULID (26 Crockford base32 chars), lowercase hyphenated UUID (36 chars), or lowercase unhyphenated UUID (32 hex chars). Header ids, event ids, and envelope ids share this shape so cross-segment reconciliation can dedup by exact string equality (spec §9.5).
   */
  session_id?: string;
}
/**
 * Opaque arguments for the unclassified tool call.
 */
export interface ToolCallOtherArgs {
  /**
   * Tool name reported by the source agent.
   */
  name: string;
  /**
   * Opaque arguments for the unclassified tool call.
   */
  args?: {
    [k: string]: unknown | undefined;
  };
}
export interface ToolResult {
  /**
   * Tool result event discriminator.
   */
  type?: "tool_result";
  /**
   * Tool result event payload.
   */
  payload?: {
    /**
     * Globally-unique identifier shape: canonical uppercase ULID (26 Crockford base32 chars), lowercase hyphenated UUID (36 chars), or lowercase unhyphenated UUID (32 hex chars). Header ids, event ids, and envelope ids share this shape so cross-segment reconciliation can dedup by exact string equality (spec §9.5).
     */
    for_id?: string;
    /**
     * Whether the tool call completed successfully.
     */
    ok: boolean;
    /**
     * Human-readable tool output.
     */
    output?: string;
    /**
     * Whether tool output was truncated before emission.
     */
    truncated?: boolean;
    /**
     * UTF-8 byte length of the original output before truncation. Required when truncated is true.
     */
    output_size?: number;
    /**
     * Content-addressed reference to full output when output is truncated.
     */
    overflow_ref?: string | null;
    /**
     * Error detail when the tool result failed, or null when unavailable.
     */
    error?: string | null;
    /**
     * Attachments produced by the tool result.
     */
    attachments?: Attachment[];
    /**
     * Structured per-toolkind outputs, keyed by the originating tool_call.tool. Optional; consumers fall back to payload.output when the relevant key is absent. Registered keys are writer-strict; unregistered/future toolkinds are opaque objects. Vendors extend a registered key via x-<vendor>/<name> pattern keys.
     */
    meta?: {
      /**
       * Structured output for an MCP tool result.
       */
      mcp_call?: {
        /**
         * Structured MCP content blocks returned by the tool.
         */
        content_blocks?: {
          /**
           * MCP content block kind.
           */
          type: "text" | "image" | "resource";
          /**
           * Text payload for a text MCP content block.
           */
          text?: string;
          /**
           * Encoded data for a binary MCP content block.
           */
          data?: string;
          /**
           * Media type for the MCP content block data.
           */
          mime_type?: string;
          /**
           * Resource URI for an MCP resource content block.
           */
          uri?: string;
        }[];
        /**
         * Whether the MCP tool result represents an error.
         */
        is_error?: boolean;
        /**
         * This interface was referenced by `undefined`'s JSON-Schema definition
         * via the `patternProperty` "^x-[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9][a-z0-9_-]*$".
         */
        [k: string]: unknown;
      };
      /**
       * Structured output for a file read result.
       */
      file_read?: {
        /**
         * Line range represented by the file read output.
         *
         * @minItems 2
         * @maxItems 2
         */
        range?: [number, number];
        /**
         * Total line count reported for the read file.
         */
        total_lines?: number;
        /**
         * Text encoding reported for the read output.
         */
        encoding?: string;
        /**
         * Line where file output was truncated, or null when not line-truncated.
         */
        truncated_at_line?: number | null;
        /**
         * This interface was referenced by `undefined`'s JSON-Schema definition
         * via the `patternProperty` "^x-[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9][a-z0-9_-]*$".
         */
        [k: string]: unknown;
      };
      /**
       * Structured output for a shell command result.
       */
      shell_command?: {
        /**
         * Standard output captured from the shell command.
         */
        stdout?: string;
        /**
         * Standard error captured from the shell command.
         */
        stderr?: string;
        /**
         * Process exit code, or null when unavailable.
         */
        exit_code?: number | null;
        /**
         * Termination signal, or null when unavailable.
         */
        signal?: string | null;
        /**
         * Shell command duration in milliseconds.
         */
        duration_ms?: number;
        /**
         * This interface was referenced by `undefined`'s JSON-Schema definition
         * via the `patternProperty` "^x-[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9][a-z0-9_-]*$".
         */
        [k: string]: unknown;
      };
      [k: string]:
        | {
            [k: string]: unknown | undefined;
          }
        | undefined;
    };
  };
  [k: string]: unknown | undefined;
}
export interface ToolCallAborted {
  type?: "tool_call_aborted";
  payload?: ToolCallAbortedPayload;
  [k: string]: unknown | undefined;
}
export type ToolCallAbortedReason =
  | "user_interrupt"
  | "hook_blocked"
  | "timeout"
  | "permission_denied"
  | "runtime_error"
  | `x-${string}/${string}`;
export type ToolCallAbortedPayload = {
  /**
   * Why execution stopped before a normal tool_result.
   */
  reason: ToolCallAbortedReason;
  blocked_by?: string;
} & (
  | {
      /**
       * Abort granularity. tool_call aborts reference a specific tool_call by for_id; turn aborts describe a broader turn-level stop when the source cannot identify one call.
       */
      scope: "tool_call";
      /**
       * Globally-unique identifier shape: canonical uppercase ULID (26 Crockford base32 chars), lowercase hyphenated UUID (36 chars), or lowercase unhyphenated UUID (32 hex chars). Header ids, event ids, and envelope ids share this shape so cross-segment reconciliation can dedup by exact string equality (spec §9.5).
       */
      for_id: string;
    }
  | {
      /**
       * Abort granularity. tool_call aborts reference a specific tool_call by for_id; turn aborts describe a broader turn-level stop when the source cannot identify one call.
       */
      scope: "turn" | `x-${string}/${string}`;
      for_id?: never;
    }
);

export interface UserQuery {
  /**
   * User query event discriminator.
   */
  type?: "user_query";
  /**
   * User query event payload.
   */
  payload?: {
    /**
     * Questions presented to the user.
     *
     * @minItems 1
     */
    questions: [
      {
        /**
         * Stable question identifier.
         */
        id: string;
        /**
         * Question text presented to the user.
         */
        question: string;
        /**
         * Short user-visible question header.
         */
        header?: string;
        /**
         * Whether multiple options may be selected.
         */
        multi_select?: boolean;
        /**
         * Whether the answer should be treated as secret input.
         */
        is_secret?: boolean;
        /**
         * Whether a free-form other answer is allowed.
         */
        allow_other?: boolean;
        /**
         * Predefined answer options for the question.
         */
        options?: {
          /**
           * Stable option identifier.
           */
          id?: string;
          /**
           * User-visible option label.
           */
          label: string;
          /**
           * User-visible option description.
           */
          description?: string;
        }[];
      },
      ...{
        /**
         * Stable question identifier.
         */
        id: string;
        /**
         * Question text presented to the user.
         */
        question: string;
        /**
         * Short user-visible question header.
         */
        header?: string;
        /**
         * Whether multiple options may be selected.
         */
        multi_select?: boolean;
        /**
         * Whether the answer should be treated as secret input.
         */
        is_secret?: boolean;
        /**
         * Whether a free-form other answer is allowed.
         */
        allow_other?: boolean;
        /**
         * Predefined answer options for the question.
         */
        options?: {
          /**
           * Stable option identifier.
           */
          id?: string;
          /**
           * User-visible option label.
           */
          label: string;
          /**
           * User-visible option description.
           */
          description?: string;
        }[];
      }[],
    ];
  };
  [k: string]: unknown | undefined;
}
export interface UserQueryResponse {
  /**
   * User query response event discriminator.
   */
  type?: "user_query_response";
  /**
   * User query response event payload.
   */
  payload?: {
    /**
     * Globally-unique identifier shape: canonical uppercase ULID (26 Crockford base32 chars), lowercase hyphenated UUID (36 chars), or lowercase unhyphenated UUID (32 hex chars). Header ids, event ids, and envelope ids share this shape so cross-segment reconciliation can dedup by exact string equality (spec §9.5).
     */
    for_id: string;
    /**
     * Answers keyed by user query question ID.
     */
    answers: {
      [k: string]:
        | {
            /**
             * Selected option IDs or labels for this answer.
             */
            selected: string[];
            /**
             * Free-form other answer text.
             */
            other?: string;
          }
        | undefined;
    };
  };
  [k: string]: unknown | undefined;
}
export interface SessionSummary {
  /**
   * Session summary event discriminator.
   */
  type?: "session_summary";
  /**
   * Session summary event payload.
   */
  payload?: {
    /**
     * Summary scope covered by this event.
     */
    scope: "session";
    /**
     * Summary text for the session.
     */
    text: string;
    /**
     * Model that produced the summary when reported.
     */
    model?: string;
  };
  [k: string]: unknown | undefined;
}
export interface SystemEvent {
  /**
   * System event event discriminator.
   */
  type?: "system_event";
  /**
   * System event event payload.
   */
  payload?: {
    /**
     * Lifecycle/hook signal category. Either one of the reserved cross-agent values, or a vendor-namespaced extension of the form `x-<vendor>/<name>`.
     */
    kind: (
      | (
          | "session_start"
          | "turn_start"
          | "turn_end"
          | "subagent_start"
          | "subagent_end"
          | "pre_tool_use"
          | "post_tool_use"
          | "hook_fired"
          | "permission_request"
          | "permission_decision"
          | "cwd_change"
          | "env_snapshot"
          | "task_started"
          | "task_completed"
          | "plan_completed"
          | "turn_aborted"
          | "tool_decision"
          | "context_injected"
          | "hook_progress"
          | "queue_operation"
          | "heartbeat"
          | "agent_error"
          | "agent_warning"
          | "api_error"
          | "stream_error"
          | "deprecation_notice"
          | "guardian_alert"
          | "model_rerouted"
          | "hook_failed"
          | "vcs_commit"
        )
      | {
          [k: string]: unknown | undefined;
        }
    ) &
      string;
    /**
     * Human-readable system event text.
     */
    text?: string;
    /**
     * Structured data associated with the system event.
     */
    data?: {
      [k: string]: unknown | undefined;
    };
  };
  [k: string]: unknown | undefined;
}
export interface AgentThinking {
  /**
   * Agent thinking event discriminator.
   */
  type?: "agent_thinking";
  /**
   * Agent thinking event payload.
   */
  payload?: {
    /**
     * Agent reasoning or thinking text.
     */
    text: string;
    /**
     * Model that produced the thinking block.
     */
    model?: string;
    /**
     * Source-defined thinking effort or visibility level.
     */
    level?: string;
    usage?: AgentMessageUsage2;
  };
  [k: string]: unknown | undefined;
}
export interface UserInterrupt {
  /**
   * User interrupt event discriminator.
   */
  type?: "user_interrupt";
  /**
   * User interrupt event payload.
   */
  payload?: {
    /**
     * Reason for the user interrupt when reported.
     */
    reason?: string;
  };
  [k: string]: unknown | undefined;
}
export interface ContextCompact {
  /**
   * Context compaction event discriminator.
   */
  type?: "context_compact";
  /**
   * Context compaction event payload.
   */
  payload?: {
    /**
     * Compaction summary that replaces earlier context.
     */
    summary: string;
    /**
     * Trigger that caused context compaction.
     */
    trigger?: (
      | ("manual" | "auto")
      | {
          [k: string]: unknown | undefined;
        }
    ) &
      string;
    /**
     * Token count before context compaction.
     */
    tokens_before?: number;
    /**
     * Token count after context compaction.
     */
    tokens_after?: number;
    /**
     * Agent Trail entry IDs folded or replaced by this compaction summary. Provenance-only; readers must not require same-file resolution.
     */
    replaced_message_ids?: string[];
  };
  [k: string]: unknown | undefined;
}
export interface BranchPoint {
  /**
   * Branch point event discriminator.
   */
  type?: "branch_point";
  /**
   * Branch point event payload.
   */
  payload?: {
    /**
     * Globally-unique identifier shape: canonical uppercase ULID (26 Crockford base32 chars), lowercase hyphenated UUID (36 chars), or lowercase unhyphenated UUID (32 hex chars). Header ids, event ids, and envelope ids share this shape so cross-segment reconciliation can dedup by exact string equality (spec §9.5).
     */
    from_id: string;
    /**
     * Reason the branch was created.
     */
    reason?: string;
  };
  [k: string]: unknown | undefined;
}
export interface BranchSummary {
  /**
   * Branch summary event discriminator.
   */
  type?: "branch_summary";
  /**
   * Branch summary event payload.
   */
  payload?: {
    /**
     * Globally-unique identifier shape: canonical uppercase ULID (26 Crockford base32 chars), lowercase hyphenated UUID (36 chars), or lowercase unhyphenated UUID (32 hex chars). Header ids, event ids, and envelope ids share this shape so cross-segment reconciliation can dedup by exact string equality (spec §9.5).
     */
    abandoned_branch_id: string;
    /**
     * Summary of the abandoned branch.
     */
    summary: string;
    /**
     * Model that produced the branch summary when reported.
     */
    model?: string;
  };
  [k: string]: unknown | undefined;
}
export interface ModelChange {
  /**
   * Model change event discriminator.
   */
  type?: "model_change";
  /**
   * Model change event payload.
   */
  payload?: {
    /**
     * Model in use before the change when known.
     */
    from_model?: string;
    /**
     * Model in use after the change.
     */
    to_model: string;
    /**
     * Model provider before the change when known.
     */
    from_provider?: string;
    /**
     * Model provider after the change when known.
     */
    to_provider?: string;
    /**
     * Reason the model changed.
     */
    reason?: string;
    /**
     * Trigger that caused the model change.
     */
    trigger?: (
      | ("initial" | "user_set" | "agent_set" | "runtime_inferred" | "auto_reroute" | "external")
      | {
          [k: string]: unknown | undefined;
        }
    ) &
      string;
    /**
     * Source turn identifier associated with the model change.
     */
    turn_id?: string;
  };
  [k: string]: unknown | undefined;
}
export interface ModeChange {
  /**
   * Mode change event discriminator.
   */
  type?: "mode_change";
  /**
   * Mode change event payload.
   */
  payload?: {
    /**
     * Mode domain changed by this event.
     */
    scope: (
      | ("collaboration" | "permission" | "execution" | "ui")
      | {
          [k: string]: unknown | undefined;
        }
    ) &
      string;
    /**
     * Mode value before the change when known.
     */
    from_mode?: string;
    /**
     * Mode value after the change.
     */
    to_mode: string;
    /**
     * Reason the mode changed.
     */
    reason?: string;
    /**
     * Trigger that caused the mode change.
     */
    trigger?: (
      | ("initial" | "user_set" | "agent_set" | "runtime_inferred" | "auto_reroute" | "external")
      | {
          [k: string]: unknown | undefined;
        }
    ) &
      string;
    /**
     * Source turn identifier associated with the mode change.
     */
    turn_id?: string;
    /**
     * Structured data associated with the mode change.
     */
    data?: {
      [k: string]: unknown | undefined;
    };
  };
  [k: string]: unknown | undefined;
}
export interface ThinkingLevelChange {
  /**
   * Thinking-level change event discriminator.
   */
  type?: "thinking_level_change";
  /**
   * Thinking-level change event payload.
   */
  payload?: {
    /**
     * Thinking level before the change when known.
     */
    from_level?: string;
    /**
     * Thinking level after the change.
     */
    to_level: string;
    /**
     * Reason the thinking level changed.
     */
    reason?: string;
    /**
     * Trigger that caused the thinking level change.
     */
    trigger?: (
      | ("initial" | "user_set" | "agent_set" | "runtime_inferred" | "auto_reroute" | "external")
      | {
          [k: string]: unknown | undefined;
        }
    ) &
      string;
    /**
     * Source turn identifier associated with the thinking level change.
     */
    turn_id?: string;
    /**
     * Structured data associated with the thinking level change.
     */
    data?: {
      [k: string]: unknown | undefined;
    };
  };
  [k: string]: unknown | undefined;
}
export interface SessionTerminated {
  /**
   * Session termination event discriminator.
   */
  type?: "session_terminated";
  /**
   * Session termination event payload.
   */
  payload?: {
    /**
     * Reason the session ended abnormally.
     */
    reason: (
      | ("eof_with_open_tool_calls" | "process_terminated" | "truncated" | "user_abort")
      | {
          [k: string]: unknown | undefined;
        }
    ) &
      string;
    /**
     * Tool-call IDs still open when the session ended abnormally.
     */
    open_call_ids?: string[];
  };
  [k: string]: unknown | undefined;
}
export interface SessionEnd {
  /**
   * Session end event discriminator.
   */
  type?: "session_end";
  /**
   * Session end event payload.
   */
  payload?: {
    /**
     * Reason the session ended cleanly.
     */
    reason: (
      | ("complete" | "user_quit" | "agent_idle")
      | {
          [k: string]: unknown | undefined;
        }
    ) &
      string;
    /**
     * Globally-unique identifier shape: canonical uppercase ULID (26 Crockford base32 chars), lowercase hyphenated UUID (36 chars), or lowercase unhyphenated UUID (32 hex chars). Header ids, event ids, and envelope ids share this shape so cross-segment reconciliation can dedup by exact string equality (spec §9.5).
     */
    final_message_id?: string;
  };
  [k: string]: unknown | undefined;
}
export interface CommandInvoke {
  /**
   * Command invocation event discriminator.
   */
  type?: "command_invoke";
  /**
   * Command invocation event payload.
   */
  payload?: {
    /**
     * User-visible identifier of the invoked capability. Leading slash for slash/builtin/custom_prompt commands (`/clear`); bare name for skills (`webapp-testing`).
     */
    name: string;
    /**
     * What kind of capability was invoked.
     */
    kind: (
      | ("slash" | "builtin" | "skill" | "custom_prompt" | "plugin")
      | {
          [k: string]: unknown | undefined;
        }
    ) &
      string;
    /**
     * How the invocation reached the agent. `auto_trigger` covers description-matched skill activation with no user action; adapters MAY synthesize it (set source.synthesized=true).
     */
    via: (
      | ("user_typed" | "auto_trigger" | "agent_invoked")
      | {
          [k: string]: unknown | undefined;
        }
    ) &
      string;
    /**
     * Structured arguments for the invoked capability.
     */
    args?: {
      [k: string]: unknown | undefined;
    };
    /**
     * Text inserted or expanded by the invoked capability.
     */
    expansion_text?: string;
    /**
     * What the runtime did with the invocation. Either one of the reserved values, a vendor-namespaced extension of the form `x-<vendor>/<name>`, or null.
     */
    result_action?: ("compact" | "clear" | "expand" | "load_skill" | "noop") | string | null;
  };
  [k: string]: unknown | undefined;
}
export interface CapabilityChange {
  /**
   * Capability change event discriminator.
   */
  type?: "capability_change";
  /**
   * Capability change event payload.
   */
  payload?:
    | {
        /**
         * Capability domain changed by this event.
         */
        scope: (
          | ("tool" | "skill" | "mcp_server" | "mcp_tool" | "plugin")
          | {
              [k: string]: unknown | undefined;
            }
        ) &
          string;
        /**
         * Reason the capability set changed.
         */
        reason: (
          | (
              | "initial"
              | "registered"
              | "deregistered"
              | "connected"
              | "disconnected"
              | "loaded"
              | "unloaded"
              | "error"
              | "instructions_updated"
            )
          | {
              [k: string]: unknown | undefined;
            }
        ) &
          string;
        /**
         * Capabilities added by this change.
         *
         * @minItems 1
         */
        added: [CapabilityAddedItem, ...CapabilityAddedItem[]];
        /**
         * Capabilities removed by this change.
         *
         * @minItems 1
         */
        removed?: [CapabilityRemovedItem, ...CapabilityRemovedItem[]];
        /**
         * Capabilities modified by this change.
         *
         * @minItems 1
         */
        changed?: [CapabilityChangedItem, ...CapabilityChangedItem[]];
        /**
         * Full capability snapshot after this change.
         *
         * @minItems 1
         */
        snapshot?: [CapabilityAddedItem, ...CapabilityAddedItem[]];
      }
    | {
        /**
         * Capability domain changed by this event.
         */
        scope: (
          | ("tool" | "skill" | "mcp_server" | "mcp_tool" | "plugin")
          | {
              [k: string]: unknown | undefined;
            }
        ) &
          string;
        /**
         * Reason the capability set changed.
         */
        reason: (
          | (
              | "initial"
              | "registered"
              | "deregistered"
              | "connected"
              | "disconnected"
              | "loaded"
              | "unloaded"
              | "error"
              | "instructions_updated"
            )
          | {
              [k: string]: unknown | undefined;
            }
        ) &
          string;
        /**
         * Capabilities added by this change.
         *
         * @minItems 1
         */
        added?: [CapabilityAddedItem, ...CapabilityAddedItem[]];
        /**
         * Capabilities removed by this change.
         *
         * @minItems 1
         */
        removed: [CapabilityRemovedItem, ...CapabilityRemovedItem[]];
        /**
         * Capabilities modified by this change.
         *
         * @minItems 1
         */
        changed?: [CapabilityChangedItem, ...CapabilityChangedItem[]];
        /**
         * Full capability snapshot after this change.
         *
         * @minItems 1
         */
        snapshot?: [CapabilityAddedItem, ...CapabilityAddedItem[]];
      }
    | {
        /**
         * Capability domain changed by this event.
         */
        scope: (
          | ("tool" | "skill" | "mcp_server" | "mcp_tool" | "plugin")
          | {
              [k: string]: unknown | undefined;
            }
        ) &
          string;
        /**
         * Reason the capability set changed.
         */
        reason: (
          | (
              | "initial"
              | "registered"
              | "deregistered"
              | "connected"
              | "disconnected"
              | "loaded"
              | "unloaded"
              | "error"
              | "instructions_updated"
            )
          | {
              [k: string]: unknown | undefined;
            }
        ) &
          string;
        /**
         * Capabilities added by this change.
         *
         * @minItems 1
         */
        added?: [CapabilityAddedItem, ...CapabilityAddedItem[]];
        /**
         * Capabilities removed by this change.
         *
         * @minItems 1
         */
        removed?: [CapabilityRemovedItem, ...CapabilityRemovedItem[]];
        /**
         * Capabilities modified by this change.
         *
         * @minItems 1
         */
        changed: [CapabilityChangedItem, ...CapabilityChangedItem[]];
        /**
         * Full capability snapshot after this change.
         *
         * @minItems 1
         */
        snapshot?: [CapabilityAddedItem, ...CapabilityAddedItem[]];
      }
    | {
        /**
         * Capability domain changed by this event.
         */
        scope: (
          | ("tool" | "skill" | "mcp_server" | "mcp_tool" | "plugin")
          | {
              [k: string]: unknown | undefined;
            }
        ) &
          string;
        /**
         * Reason the capability set changed.
         */
        reason: (
          | (
              | "initial"
              | "registered"
              | "deregistered"
              | "connected"
              | "disconnected"
              | "loaded"
              | "unloaded"
              | "error"
              | "instructions_updated"
            )
          | {
              [k: string]: unknown | undefined;
            }
        ) &
          string;
        /**
         * Capabilities added by this change.
         *
         * @minItems 1
         */
        added?: [CapabilityAddedItem, ...CapabilityAddedItem[]];
        /**
         * Capabilities removed by this change.
         *
         * @minItems 1
         */
        removed?: [CapabilityRemovedItem, ...CapabilityRemovedItem[]];
        /**
         * Capabilities modified by this change.
         *
         * @minItems 1
         */
        changed?: [CapabilityChangedItem, ...CapabilityChangedItem[]];
        /**
         * Full capability snapshot after this change.
         *
         * @minItems 1
         */
        snapshot: [CapabilityAddedItem, ...CapabilityAddedItem[]];
      };
  [k: string]: unknown | undefined;
}
export interface CapabilityAddedItem {
  /**
   * Name of the added capability.
   */
  name: string;
  /**
   * Structured metadata for the added capability.
   */
  metadata?: {
    [k: string]: unknown | undefined;
  };
}
export interface CapabilityRemovedItem {
  /**
   * Name of the removed capability.
   */
  name: string;
}
export interface CapabilityChangedItem {
  /**
   * Name of the changed capability.
   */
  name: string;
  /**
   * Capability field that changed.
   */
  field: string;
  /**
   * Previous capability field value.
   */
  from?:
    | null
    | boolean
    | number
    | string
    | JsonValue[]
    | {
        [k: string]: JsonValue;
      };
  /**
   * Any JSON value.
   */
  to?:
    | null
    | boolean
    | number
    | string
    | JsonValue[]
    | {
        [k: string]: JsonValue;
      };
}
export interface SessionMetadataUpdate {
  /**
   * Session metadata update event discriminator.
   */
  type?: "session_metadata_update";
  /**
   * Session metadata update event payload.
   */
  payload?:
    | {
        /**
         * Session metadata field being updated.
         */
        field: "name" | "description" | "agent.model_default" | "vcs.branch";
        /**
         * New session metadata value.
         */
        value: string;
        /**
         * Previous session metadata value when known.
         */
        previous_value?: string;
        /**
         * Reason the session metadata changed.
         */
        reason: (
          | ("ai_generated" | "user_set" | "runtime_inferred" | "external")
          | {
              [k: string]: unknown | undefined;
            }
        ) &
          string;
      }
    | {
        /**
         * Session metadata field being updated.
         */
        field: "tags";
        /**
         * New session metadata value.
         */
        value: string[];
        /**
         * Previous session metadata value when known.
         */
        previous_value?: string[];
        /**
         * Reason the session metadata changed.
         */
        reason: (
          | ("ai_generated" | "user_set" | "runtime_inferred" | "external")
          | {
              [k: string]: unknown | undefined;
            }
        ) &
          string;
      }
    | {
        /**
         * Session metadata field being updated.
         */
        field: "vcs.worktree";
        value: Worktree1;
        previous_value?: Worktree2;
        /**
         * Reason the session metadata changed.
         */
        reason: (
          | ("ai_generated" | "user_set" | "runtime_inferred" | "external")
          | {
              [k: string]: unknown | undefined;
            }
        ) &
          string;
      }
    | {
        /**
         * Session metadata field being updated.
         */
        field: string;
        /**
         * Any JSON value.
         */
        value:
          | null
          | boolean
          | number
          | string
          | JsonValue[]
          | {
              [k: string]: JsonValue;
            };
        /**
         * Any JSON value.
         */
        previous_value?:
          | null
          | boolean
          | number
          | string
          | JsonValue[]
          | {
              [k: string]: JsonValue;
            };
        /**
         * Reason the session metadata changed.
         */
        reason: (
          | ("ai_generated" | "user_set" | "runtime_inferred" | "external")
          | {
              [k: string]: unknown | undefined;
            }
        ) &
          string;
      };
  [k: string]: unknown | undefined;
}
/**
 * New session metadata value.
 */
export interface Worktree1 {
  /**
   * Worktree name reported by the source.
   */
  name: string;
  /**
   * Filesystem path of the worktree.
   */
  path: string;
  /**
   * Working directory of the parent repository at the time the worktree was created.
   */
  original_cwd?: string;
  /**
   * Branch the parent repository was on when the worktree was created.
   */
  original_branch?: string;
  /**
   * Commit hash the worktree was forked from.
   */
  original_head_commit?: string;
}
/**
 * Previous session metadata value when known.
 */
export interface Worktree2 {
  /**
   * Worktree name reported by the source.
   */
  name: string;
  /**
   * Filesystem path of the worktree.
   */
  path: string;
  /**
   * Working directory of the parent repository at the time the worktree was created.
   */
  original_cwd?: string;
  /**
   * Branch the parent repository was on when the worktree was created.
   */
  original_branch?: string;
  /**
   * Commit hash the worktree was forked from.
   */
  original_head_commit?: string;
}
