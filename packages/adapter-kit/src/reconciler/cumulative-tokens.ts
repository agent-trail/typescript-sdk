import type { Entry } from "@agent-trail/types";
import { isRecordObject } from "../primitives/guards.js";

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function hasInputCoverage(usage: Record<string, unknown>): boolean {
  return (
    numberOrUndefined(usage.input_tokens) !== undefined ||
    numberOrUndefined(usage.input_tokens_cumulative) !== undefined
  );
}

function hasOutputCoverage(usage: Record<string, unknown>): boolean {
  return (
    numberOrUndefined(usage.output_tokens) !== undefined ||
    numberOrUndefined(usage.output_tokens_cumulative) !== undefined
  );
}

type TokenTotals = {
  input: number;
  output: number;
};

function canTrackUsage(usage: Record<string, unknown>): boolean {
  return hasInputCoverage(usage) && hasOutputCoverage(usage);
}

function updateFromAuthoritativeUsage(
  totals: TokenTotals,
  usage: Record<string, unknown>,
): TokenTotals {
  return {
    input:
      numberOrUndefined(usage.input_tokens_cumulative) ??
      totals.input + (numberOrUndefined(usage.input_tokens) ?? 0),
    output:
      numberOrUndefined(usage.output_tokens_cumulative) ??
      totals.output + (numberOrUndefined(usage.output_tokens) ?? 0),
  };
}

function usageWithCumulative(
  totals: TokenTotals,
  usage: Record<string, unknown>,
): { totals: TokenTotals; usage?: Record<string, unknown> } {
  const input = numberOrUndefined(usage.input_tokens);
  const output = numberOrUndefined(usage.output_tokens);
  if (input === undefined || output === undefined) return { totals };

  const nextTotals = {
    input: totals.input + input,
    output: totals.output + output,
  };
  return {
    totals: nextTotals,
    usage: {
      ...usage,
      input_tokens_cumulative: nextTotals.input,
      output_tokens_cumulative: nextTotals.output,
    },
  };
}

/**
 * Compute session-cumulative token counts for `agent_message` entries whose
 * `payload.usage` carries per-turn `input_tokens`/`output_tokens` but no
 * `*_cumulative` fields. Adapters whose source already emits cumulative counts
 * (e.g. Codex) leave this rule disabled. An entry already carrying a cumulative
 * field is left untouched, but its tokens still advance the running totals so a
 * source that emits cumulative counts intermittently stays consistent.
 *
 * Running totals accumulate in array (file-position) order. Adapters enabling
 * this rule must emit Pass-1 output in chronological order; the rule does not
 * sort defensively (that would mask adapter ordering bugs).
 */
export function cumulativeTokens(entries: Entry[]): Entry[] {
  let totals: TokenTotals = { input: 0, output: 0 };

  return entries.map((entry) => {
    if (entry.type !== "agent_message") return entry;
    const usage = (entry.payload as { usage?: unknown }).usage;
    if (!isRecordObject(usage)) return entry;
    if (!canTrackUsage(usage)) return entry;
    if (
      usage.input_tokens_cumulative !== undefined ||
      usage.output_tokens_cumulative !== undefined
    ) {
      // Source already carries cumulative counts for this turn — keep the entry
      // as-is but advance the running totals (authoritative cumulative value, or
      // running + turn delta) so later computed entries stay consistent.
      totals = updateFromAuthoritativeUsage(totals, usage);
      return entry;
    }

    const result = usageWithCumulative(totals, usage);
    totals = result.totals;
    if (result.usage === undefined) return entry;

    return {
      ...entry,
      payload: {
        ...entry.payload,
        usage: result.usage,
      },
    } as Entry;
  });
}
