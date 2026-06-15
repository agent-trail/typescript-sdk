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

export function coerceInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function legacyIsObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function jsonObjectValue(value: unknown): Record<string, unknown> | undefined {
  return legacyIsObject(value) ? value : undefined;
}

export function legacyStringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function quoteShellArg(value: string): string {
  return /^[A-Za-z0-9_\-./@:+=]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

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

export function mapAgentMessageUsage(raw: unknown): AgentMessageUsage | undefined {
  if (!legacyIsObject(raw)) return undefined;
  const usage: Partial<AgentMessageUsage> = {};
  const inputTokens = pick(raw, ["input_tokens", "inputTokens", "input"]);
  if (inputTokens !== undefined) usage.input_tokens = inputTokens;
  const outputTokens = pick(raw, ["output_tokens", "outputTokens", "output"]);
  if (outputTokens !== undefined) usage.output_tokens = outputTokens;
  const inputCumulative = pick(raw, [
    "input_tokens_cumulative",
    "inputTokensCumulative",
    "cumulativeInputTokens",
  ]);
  if (inputCumulative !== undefined) usage.input_tokens_cumulative = inputCumulative;
  const outputCumulative = pick(raw, [
    "output_tokens_cumulative",
    "outputTokensCumulative",
    "cumulativeOutputTokens",
  ]);
  if (outputCumulative !== undefined) usage.output_tokens_cumulative = outputCumulative;
  const totalTokens = pick(raw, ["total_tokens", "totalTokens", "total", "totalTokenCount"]);
  if (totalTokens !== undefined) usage.total_tokens = totalTokens;
  const totalCumulative = pick(raw, [
    "total_tokens_cumulative",
    "totalTokensCumulative",
    "cumulativeTotalTokens",
  ]);
  if (totalCumulative !== undefined) usage.total_tokens_cumulative = totalCumulative;
  const cacheRead = pick(raw, [
    "cache_read_input_tokens",
    "cache_read_tokens",
    "cacheReadInputTokens",
    "cacheReadTokens",
    "cacheRead",
  ]);
  if (cacheRead !== undefined) usage.cache_read_tokens = cacheRead;
  const cacheCreate = pick(raw, [
    "cache_creation_input_tokens",
    "cache_creation_tokens",
    "cacheCreationInputTokens",
    "cacheCreationTokens",
    "cacheWrite",
  ]);
  if (cacheCreate !== undefined) usage.cache_creation_tokens = cacheCreate;
  const reasoning = pick(raw, ["reasoning_tokens", "reasoningTokens"]);
  if (reasoning !== undefined) usage.reasoning_tokens = reasoning;
  const contextInput = pick(raw, ["context_input_tokens", "contextInputTokens"]);
  if (contextInput !== undefined) {
    usage.context_input_tokens = contextInput;
  } else if ([inputTokens, cacheRead, cacheCreate].some((value) => value !== undefined)) {
    usage.context_input_tokens = (inputTokens ?? 0) + (cacheRead ?? 0) + (cacheCreate ?? 0);
  }
  const contextWindow =
    positiveInteger(raw.context_window_tokens) ?? positiveInteger(raw.contextWindowTokens);
  if (contextWindow !== undefined) usage.context_window_tokens = contextWindow;
  const hasInput = usage.input_tokens !== undefined || usage.input_tokens_cumulative !== undefined;
  const hasOutput =
    usage.output_tokens !== undefined || usage.output_tokens_cumulative !== undefined;
  const hasTotal = usage.total_tokens !== undefined || usage.total_tokens_cumulative !== undefined;
  return (hasInput && hasOutput) || hasTotal ? (usage as AgentMessageUsage) : undefined;
}
