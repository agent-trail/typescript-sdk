import type { RedactionSummary } from "../public/types.js";
import type { RedactionRecord } from "./records.js";
import { recordSummaryMutation } from "./summary-mutations.js";

const TRUNCATION_NOTICE = "\n…[truncated]";
const TEXT_ENCODER = new TextEncoder();

function byteLength(s: string): number {
  return TEXT_ENCODER.encode(s).byteLength;
}

function truncateToByteLimit(text: string, maxBytes: number): string {
  if (byteLength(text) <= maxBytes) return text;
  if (maxBytes <= 0) return "";
  const noticeBytes = byteLength(TRUNCATION_NOTICE);
  if (maxBytes < noticeBytes) {
    return truncateRawToByteLimit(TRUNCATION_NOTICE, maxBytes);
  }
  const budget = maxBytes - noticeBytes;
  return `${truncateRawToByteLimit(text, budget)}${TRUNCATION_NOTICE}`;
}

function truncateRawToByteLimit(text: string, budget: number): string {
  if (budget <= 0) return "";
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (byteLength(text.slice(0, mid)) <= budget) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo);
}

function addMutationCount(
  counts: Map<number, number> | undefined,
  recordIndex: number,
  count: number,
): void {
  if (counts === undefined || count <= 0) return;
  counts.set(recordIndex, (counts.get(recordIndex) ?? 0) + count);
}

function hasValidOutputSize(payload: Record<string, unknown>): boolean {
  const outputSize = payload.output_size;
  return typeof outputSize === "number" && Number.isInteger(outputSize) && outputSize >= 0;
}

function truncateToolResultOutput(
  payload: Record<string, unknown>,
  recordIndex: number,
  maxBytes: number,
  summary: RedactionSummary,
  maxSamples: number,
  mutationCounts?: Map<number, number>,
  originalOutputSizes?: ReadonlyMap<number, number>,
): void {
  const output = payload.output;
  if (typeof output !== "string") return;
  repairMissingOutputSize(
    payload,
    output,
    recordIndex,
    summary,
    mutationCounts,
    originalOutputSizes,
  );
  if (byteLength(output) <= maxBytes) return;
  const original = output;
  if (!hasValidOutputSize(payload)) {
    payload.output_size = originalOutputSizes?.get(recordIndex) ?? byteLength(original);
  }
  payload.output = truncateToByteLimit(output, maxBytes);
  payload.truncated = true;
  addMutationCount(mutationCounts, recordIndex, 1);
  summary.counts.output_truncated = (summary.counts.output_truncated ?? 0) + 1;
  if (summary.samples.length < maxSamples) {
    summary.samples.push({
      patternId: "output_truncated",
      location: `records[${recordIndex}].payload.output`,
      before: `${original.length} chars`,
      after: `${(payload.output as string).length} chars`,
    });
  }
}

function repairMissingOutputSize(
  payload: Record<string, unknown>,
  output: string,
  recordIndex: number,
  summary: RedactionSummary,
  mutationCounts?: Map<number, number>,
  originalOutputSizes?: ReadonlyMap<number, number>,
): void {
  if (payload.truncated !== true || hasValidOutputSize(payload)) return;
  payload.output_size = originalOutputSizes?.get(recordIndex) ?? byteLength(output);
  addMutationCount(mutationCounts, recordIndex, 1);
  summary.counts.output_size_repaired = (summary.counts.output_size_repaired ?? 0) + 1;
}

function truncateUserQueryResponseAnswers(
  payload: Record<string, unknown>,
  recordIndex: number,
  maxBytes: number,
  summary: RedactionSummary,
  maxSamples: number,
  mutationCounts?: Map<number, number>,
): void {
  const answers = payload.answers;
  if (answers === null || typeof answers !== "object") return;
  for (const [questionId, answer] of Object.entries(answers as Record<string, unknown>)) {
    truncateOneAnswer(
      answer,
      questionId,
      recordIndex,
      maxBytes,
      summary,
      maxSamples,
      mutationCounts,
    );
  }
}

function truncateOneAnswer(
  answer: unknown,
  questionId: string,
  recordIndex: number,
  maxBytes: number,
  summary: RedactionSummary,
  maxSamples: number,
  mutationCounts?: Map<number, number>,
): void {
  if (answer === null || typeof answer !== "object") return;
  const answerObject = answer as Record<string, unknown>;
  truncateSelectedAnswers(
    answerObject,
    questionId,
    recordIndex,
    maxBytes,
    summary,
    maxSamples,
    mutationCounts,
  );
  const other = answerObject.other;
  if (typeof other !== "string" || byteLength(other) <= maxBytes) return;
  answerObject.other = truncateAnswerString(
    other,
    `records[${recordIndex}].payload.answers.${questionId}.other`,
    recordIndex,
    maxBytes,
    summary,
    maxSamples,
    mutationCounts,
  );
}

function truncateSelectedAnswers(
  answerObject: Record<string, unknown>,
  questionId: string,
  recordIndex: number,
  maxBytes: number,
  summary: RedactionSummary,
  maxSamples: number,
  mutationCounts?: Map<number, number>,
): void {
  const selected = answerObject.selected;
  if (!Array.isArray(selected)) return;
  for (let i = 0; i < selected.length; i += 1) {
    const value = selected[i];
    if (typeof value !== "string" || byteLength(value) <= maxBytes) continue;
    selected[i] = truncateAnswerString(
      value,
      `records[${recordIndex}].payload.answers.${questionId}.selected[${i}]`,
      recordIndex,
      maxBytes,
      summary,
      maxSamples,
      mutationCounts,
    );
  }
}

function truncateAnswerString(
  value: string,
  location: string,
  recordIndex: number,
  maxBytes: number,
  summary: RedactionSummary,
  maxSamples: number,
  mutationCounts?: Map<number, number>,
): string {
  const truncated = truncateToByteLimit(value, maxBytes);
  addMutationCount(mutationCounts, recordIndex, 1);
  recordSummaryMutation(
    summary,
    maxSamples,
    "user_query_answer_truncated",
    location,
    `${value.length} chars`,
    `${truncated.length} chars`,
  );
  return truncated;
}

export function truncateOutputs(
  records: RedactionRecord[],
  maxBytes: number,
  summary: RedactionSummary,
  maxSamples: number,
  mutationCounts?: Map<number, number>,
  originalOutputSizes?: ReadonlyMap<number, number>,
): void {
  for (const [index, record] of records.entries()) {
    const value = record.value as Record<string, unknown>;
    const payload = value.payload as Record<string, unknown> | undefined;
    if (!payload) continue;
    if (value.type === "tool_result") {
      truncateToolResultOutput(
        payload,
        index,
        maxBytes,
        summary,
        maxSamples,
        mutationCounts,
        originalOutputSizes,
      );
      continue;
    }

    if (value.type === "user_query_response") {
      truncateUserQueryResponseAnswers(
        payload,
        index,
        maxBytes,
        summary,
        maxSamples,
        mutationCounts,
      );
    }
  }
}
