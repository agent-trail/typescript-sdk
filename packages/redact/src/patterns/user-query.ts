import { redactString } from "../config/rules.js";
import type { PiiConfig, RedactionPattern, RedactionSummary } from "../public/types.js";
import { addMutationCount } from "../transform/mutation-accounting.js";
import type { RedactionRecord } from "../transform/records.js";
import { isSentinelRaw, recordSummaryMutation } from "../transform/summary-mutations.js";

function secretQuestionIdsByQueryId(records: RedactionRecord[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const record of records) {
    const value = record.value as Record<string, unknown>;
    if (value.type !== "user_query") continue;
    const entryId = value.id;
    const payload = value.payload as { questions?: unknown } | undefined;
    if (typeof entryId !== "string" || !Array.isArray(payload?.questions)) continue;
    const secretIds = secretQuestionIds(payload.questions);
    if (secretIds.size > 0) out.set(entryId, secretIds);
  }
  return out;
}

function secretQuestionIds(questions: unknown[]): Set<string> {
  const secretIds = new Set<string>();
  for (const question of questions) {
    if (question === null || typeof question !== "object") continue;
    const q = question as { id?: unknown; is_secret?: unknown };
    if (typeof q.id === "string" && q.is_secret === true) secretIds.add(q.id);
  }
  return secretIds;
}

export function stripSecretUserQueryAnswers(
  records: RedactionRecord[],
  summary: RedactionSummary,
  maxSamples: number,
  mutationCounts: Map<number, number>,
): void {
  const secretByQueryId = secretQuestionIdsByQueryId(records);
  if (secretByQueryId.size === 0) return;
  for (const [index, record] of records.entries()) {
    const value = record.value as Record<string, unknown>;
    if (value.type !== "user_query_response") continue;
    const payload = value.payload as { for_id?: unknown; answers?: unknown } | undefined;
    stripSecretResponse(
      value,
      payload,
      secretByQueryId,
      index,
      summary,
      maxSamples,
      mutationCounts,
    );
  }
}

function stripSecretResponse(
  value: Record<string, unknown>,
  payload: { for_id?: unknown; answers?: unknown } | undefined,
  secretByQueryId: ReadonlyMap<string, Set<string>>,
  index: number,
  summary: RedactionSummary,
  maxSamples: number,
  mutationCounts: Map<number, number>,
): void {
  if (typeof payload?.for_id !== "string") return;
  const secretIds = secretByQueryId.get(payload.for_id);
  if (secretIds === undefined) return;
  stripSecretSourceRaw(
    value.source as Record<string, unknown> | undefined,
    index,
    summary,
    maxSamples,
    mutationCounts,
  );
  if (
    payload.answers === null ||
    typeof payload.answers !== "object" ||
    Array.isArray(payload.answers)
  ) {
    payload.answers = {};
    recordSummaryMutation(
      summary,
      maxSamples,
      "user_query_secret_answer",
      `records[${index}].payload.answers`,
      "[secret answers]",
      "[STRIPPED]",
    );
    addMutationCount(mutationCounts, index, 1);
    return;
  }
  stripSecretAnswerValues(
    payload.answers as Record<string, unknown>,
    secretIds,
    index,
    summary,
    maxSamples,
    mutationCounts,
  );
}

function stripSecretSourceRaw(
  source: Record<string, unknown> | undefined,
  index: number,
  summary: RedactionSummary,
  maxSamples: number,
  mutationCounts: Map<number, number>,
): void {
  if (source?.raw === undefined) return;
  if (isSentinelRaw(source.raw, "[STRIPPED secret user_query_response source.raw]")) return;
  source.raw = { redacted: "[STRIPPED secret user_query_response source.raw]" };
  recordSummaryMutation(
    summary,
    maxSamples,
    "user_query_secret_source_raw",
    `records[${index}].source.raw`,
    "[secret source raw]",
    "[STRIPPED]",
  );
  addMutationCount(mutationCounts, index, 1);
}

function stripSecretAnswerValues(
  answers: Record<string, unknown>,
  secretIds: ReadonlySet<string>,
  index: number,
  summary: RedactionSummary,
  maxSamples: number,
  mutationCounts: Map<number, number>,
): void {
  for (const questionId of secretIds) {
    const answer = answers[questionId];
    if (answer === undefined) continue;
    if (answer === null || typeof answer !== "object") {
      stripOneSecretAnswer(answers, questionId, index, summary, maxSamples, mutationCounts);
      continue;
    }
    const answerObject = answer as Record<string, unknown>;
    if (!isCanonicalAnswerObject(answerObject)) {
      stripOneSecretAnswer(answers, questionId, index, summary, maxSamples, mutationCounts);
      continue;
    }
    const hadSelected = answerObject.selected.length > 0;
    const hadOther = typeof answerObject.other === "string" && answerObject.other.length > 0;
    if (hadSelected || hadOther) {
      stripOneSecretAnswer(answers, questionId, index, summary, maxSamples, mutationCounts);
    }
  }
}

function isCanonicalAnswerObject(answer: Record<string, unknown>): answer is {
  selected: unknown[];
  other?: string;
} {
  return (
    Object.keys(answer).every((key) => key === "selected" || key === "other") &&
    Array.isArray(answer.selected) &&
    (answer.other === undefined || typeof answer.other === "string")
  );
}

function stripOneSecretAnswer(
  answers: Record<string, unknown>,
  questionId: string,
  index: number,
  summary: RedactionSummary,
  maxSamples: number,
  mutationCounts: Map<number, number>,
): void {
  answers[questionId] = { selected: [] };
  recordSummaryMutation(
    summary,
    maxSamples,
    "user_query_secret_answer",
    `records[${index}].payload.answers.${questionId}`,
    "[secret answer]",
    "[STRIPPED]",
  );
  addMutationCount(mutationCounts, index, 1);
}

function uniqueKey(preferred: string, used: Set<string>): string {
  if (!used.has(preferred)) return preferred;
  let suffix = 2;
  let candidate = `${preferred}_${suffix}`;
  while (used.has(candidate)) {
    suffix += 1;
    candidate = `${preferred}_${suffix}`;
  }
  return candidate;
}

export function redactUserQueryQuestionIds(
  records: RedactionRecord[],
  userPatterns: RedactionPattern[],
  patterns: readonly RedactionPattern[],
  allowedSecrets: readonly string[],
  summary: RedactionSummary,
  maxSamples: number,
  mutationCounts: Map<number, number>,
  enableEntropyRedaction: boolean,
  pii: PiiConfig,
): Map<string, Map<string, string>> {
  const idMaps = new Map<string, Map<string, string>>();

  for (const [index, record] of records.entries()) {
    const value = record.value as Record<string, unknown>;
    if (value.type !== "user_query" || typeof value.id !== "string") continue;
    const payload = value.payload as { questions?: unknown } | undefined;
    if (!Array.isArray(payload?.questions)) continue;

    const idMap = redactQuestionIds(
      payload.questions,
      index,
      userPatterns,
      patterns,
      allowedSecrets,
      summary,
      maxSamples,
      mutationCounts,
      enableEntropyRedaction,
      pii,
    );
    if (idMap.size > 0) idMaps.set(value.id, idMap);
  }

  return idMaps;
}

function redactQuestionIds(
  questions: unknown[],
  index: number,
  userPatterns: RedactionPattern[],
  patterns: readonly RedactionPattern[],
  allowedSecrets: readonly string[],
  summary: RedactionSummary,
  maxSamples: number,
  mutationCounts: Map<number, number>,
  enableEntropyRedaction: boolean,
  pii: PiiConfig,
): Map<string, string> {
  const used = new Set<string>();
  const idMap = new Map<string, string>();
  for (let i = 0; i < questions.length; i += 1) {
    const rewrite = redactedQuestionId(
      questions[i],
      index,
      i,
      used,
      userPatterns,
      patterns,
      allowedSecrets,
      summary,
      maxSamples,
      mutationCounts,
      enableEntropyRedaction,
      pii,
    );
    if (rewrite !== undefined) idMap.set(rewrite.before, rewrite.after);
  }
  return idMap;
}

function redactedQuestionId(
  question: unknown,
  recordIndex: number,
  questionIndex: number,
  used: Set<string>,
  userPatterns: RedactionPattern[],
  patterns: readonly RedactionPattern[],
  allowedSecrets: readonly string[],
  summary: RedactionSummary,
  maxSamples: number,
  mutationCounts: Map<number, number>,
  enableEntropyRedaction: boolean,
  pii: PiiConfig,
): { before: string; after: string } | undefined {
  if (question === null || typeof question !== "object") return undefined;
  const questionObject = question as Record<string, unknown>;
  const before = questionObject.id;
  if (typeof before !== "string") return undefined;
  const redacted = redactString(
    before,
    `records[${recordIndex}].payload.questions[${questionIndex}].id`,
    userPatterns,
    patterns,
    allowedSecrets,
    summary,
    maxSamples,
    enableEntropyRedaction,
    pii,
  );
  const after = uniqueKey(redacted, used);
  questionObject.id = after;
  used.add(after);
  if (after === before) return undefined;
  addMutationCount(mutationCounts, recordIndex, 1);
  return { before, after };
}

export function redactUserQueryAnswerKeys(
  records: RedactionRecord[],
  queryIdMaps: Map<string, Map<string, string>>,
  userPatterns: RedactionPattern[],
  patterns: readonly RedactionPattern[],
  allowedSecrets: readonly string[],
  summary: RedactionSummary,
  maxSamples: number,
  mutationCounts: Map<number, number>,
  enableEntropyRedaction: boolean,
  pii: PiiConfig,
): void {
  for (const [index, record] of records.entries()) {
    const value = record.value as Record<string, unknown>;
    if (value.type !== "user_query_response") continue;
    const payload = value.payload as { for_id?: unknown; answers?: unknown } | undefined;
    if (typeof payload?.for_id !== "string") continue;
    if (payload.answers === null || typeof payload.answers !== "object") continue;

    const rewritten = redactAnswerKeys(
      payload.answers as Record<string, unknown>,
      queryIdMaps.get(payload.for_id),
      index,
      userPatterns,
      patterns,
      allowedSecrets,
      summary,
      maxSamples,
      mutationCounts,
      enableEntropyRedaction,
      pii,
    );
    const changed = rewritten !== undefined;
    if (changed) payload.answers = rewritten;
  }
}

function redactAnswerKeys(
  answers: Record<string, unknown>,
  idMap: Map<string, string> | undefined,
  index: number,
  userPatterns: RedactionPattern[],
  patterns: readonly RedactionPattern[],
  allowedSecrets: readonly string[],
  summary: RedactionSummary,
  maxSamples: number,
  mutationCounts: Map<number, number>,
  enableEntropyRedaction: boolean,
  pii: PiiConfig,
): Record<string, unknown> | undefined {
  const rewritten = Object.create(null) as Record<string, unknown>;
  const used = new Set<string>();
  let changed = false;
  for (const [before, answer] of Object.entries(answers)) {
    const redacted = redactString(
      before,
      `records[${index}].payload.answers.<key>`,
      userPatterns,
      patterns,
      allowedSecrets,
      summary,
      maxSamples,
      enableEntropyRedaction,
      pii,
    );
    const after = uniqueKey(idMap?.get(before) ?? redacted, used);
    used.add(after);
    rewritten[after] = answer;
    if (after !== before) {
      changed = true;
      addMutationCount(mutationCounts, index, 1);
    }
  }
  return changed ? rewritten : undefined;
}
