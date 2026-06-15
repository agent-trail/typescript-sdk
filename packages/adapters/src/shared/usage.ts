import { isRecord } from "./value-coercion.js";

export type AgentMessageUsage = {
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_cumulative?: number;
  output_tokens_cumulative?: number;
  total_tokens?: number;
  total_tokens_cumulative?: number;
  cache_read_tokens?: number;
  cache_creation_tokens?: number;
  reasoning_tokens?: number;
  context_input_tokens?: number;
  context_window_tokens?: number;
};

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : undefined;
}

function pick(record: Record<string, unknown>, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const value = nonNegativeInteger(record[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

const AGENT_USAGE_FIELDS = [
  ["input_tokens", ["input_tokens", "inputTokens", "input"]],
  ["output_tokens", ["output_tokens", "outputTokens", "output"]],
  [
    "input_tokens_cumulative",
    ["input_tokens_cumulative", "inputTokensCumulative", "cumulativeInputTokens"],
  ],
  [
    "output_tokens_cumulative",
    ["output_tokens_cumulative", "outputTokensCumulative", "cumulativeOutputTokens"],
  ],
  ["total_tokens", ["total_tokens", "totalTokens", "total", "totalTokenCount"]],
  [
    "total_tokens_cumulative",
    ["total_tokens_cumulative", "totalTokensCumulative", "cumulativeTotalTokens"],
  ],
  [
    "cache_read_tokens",
    [
      "cache_read_input_tokens",
      "cache_read_tokens",
      "cacheReadInputTokens",
      "cacheReadTokens",
      "cacheRead",
    ],
  ],
  [
    "cache_creation_tokens",
    [
      "cache_creation_input_tokens",
      "cache_creation_tokens",
      "cacheCreationInputTokens",
      "cacheCreationTokens",
      "cacheWrite",
    ],
  ],
  ["reasoning_tokens", ["reasoning_tokens", "reasoningTokens"]],
  ["context_input_tokens", ["context_input_tokens", "contextInputTokens"]],
] as const satisfies readonly [keyof AgentMessageUsage, readonly string[]][];

export function mapAgentMessageUsage(raw: unknown): AgentMessageUsage | undefined {
  if (!isRecord(raw)) return undefined;
  const usage = collectAgentMessageUsage(raw);
  addDerivedContextInput(usage);
  addContextWindow(usage, raw);
  return completeAgentMessageUsage(usage) ? (usage as AgentMessageUsage) : undefined;
}

function collectAgentMessageUsage(raw: Record<string, unknown>): Partial<AgentMessageUsage> {
  const usage: Partial<AgentMessageUsage> = {};

  for (const [field, keys] of AGENT_USAGE_FIELDS) {
    const value = pick(raw, keys);
    if (value !== undefined) usage[field] = value;
  }
  return usage;
}

function addDerivedContextInput(usage: Partial<AgentMessageUsage>): void {
  const inputTokens = usage.input_tokens;
  const cacheRead = usage.cache_read_tokens;
  const cacheCreate = usage.cache_creation_tokens;
  if (usage.context_input_tokens !== undefined) return;
  if ([inputTokens, cacheRead, cacheCreate].some((value) => value !== undefined)) {
    usage.context_input_tokens = (inputTokens ?? 0) + (cacheRead ?? 0) + (cacheCreate ?? 0);
  }
}

function addContextWindow(usage: Partial<AgentMessageUsage>, raw: Record<string, unknown>): void {
  const contextWindow =
    positiveInteger(raw.context_window_tokens) ?? positiveInteger(raw.contextWindowTokens);
  if (contextWindow !== undefined) usage.context_window_tokens = contextWindow;
}

function completeAgentMessageUsage(usage: Partial<AgentMessageUsage>): boolean {
  const hasInput = usage.input_tokens !== undefined || usage.input_tokens_cumulative !== undefined;
  const hasOutput =
    usage.output_tokens !== undefined || usage.output_tokens_cumulative !== undefined;
  const hasTotal = usage.total_tokens !== undefined || usage.total_tokens_cumulative !== undefined;
  return (hasInput && hasOutput) || hasTotal;
}
