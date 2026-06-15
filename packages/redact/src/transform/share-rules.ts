import type { RedactionSummary } from "../public/types.js";
import { addMutationCount } from "./mutation-accounting.js";
import type { RedactionRecord } from "./records.js";
import { isSentinelRaw, recordSummaryMutation } from "./summary-mutations.js";

const SHA256_REF_RE = /^sha256:[0-9a-f]{64}$/;
const UNRESOLVED_USER_QUERY_RESPONSE_RAW_SENTINEL =
  "[STRIPPED unresolved user_query_response source.raw]";

type UserQueryIndex = {
  groupByRecordIndex: Map<number, number>;
  queriesByGroup: Map<number, Map<string, Set<string>>>;
  secretQueriesByGroup: Map<number, Set<string>>;
};

export function applyAttachmentUriRules(
  records: RedactionRecord[],
  rewrites: Record<string, `sha256:${string}`> | undefined,
  summary: RedactionSummary,
  maxSamples: number,
  mutationCounts: Map<number, number>,
): void {
  for (const [recordIndex, record] of records.entries()) {
    const value = record.value as Record<string, unknown>;
    if (!recordMayHaveAttachments(value.type)) continue;
    const payload = value.payload as Record<string, unknown> | undefined;
    const attachments = payload?.attachments;
    if (!Array.isArray(attachments)) continue;

    for (const [i, attachment] of attachments.entries()) {
      rewriteAttachmentUri(
        attachment,
        rewrites,
        recordIndex,
        i,
        summary,
        maxSamples,
        mutationCounts,
      );
    }
  }
}

function recordMayHaveAttachments(type: unknown): boolean {
  return type === "user_message" || type === "agent_message" || type === "tool_result";
}

function rewriteAttachmentUri(
  attachment: unknown,
  rewrites: Record<string, `sha256:${string}`> | undefined,
  recordIndex: number,
  attachmentIndex: number,
  summary: RedactionSummary,
  maxSamples: number,
  mutationCounts: Map<number, number>,
): void {
  if (attachment === null || typeof attachment !== "object") return;
  const object = attachment as Record<string, unknown>;
  const uri = object.uri;
  if (uri === undefined) return;
  if (typeof uri !== "string") {
    delete object.uri;
    recordSummaryMutation(
      summary,
      maxSamples,
      "attachment_file_uri_removed",
      `records[${recordIndex}].payload.attachments[${attachmentIndex}].uri`,
      "[malformed file attachment uri]",
      "[STRIPPED]",
    );
    addMutationCount(mutationCounts, recordIndex, 1);
    return;
  }
  if (!uri.toLowerCase().startsWith("file:")) return;

  const rewrite = rewrites?.[uri];
  const location = `records[${recordIndex}].payload.attachments[${attachmentIndex}].uri`;
  if (typeof rewrite === "string" && SHA256_REF_RE.test(rewrite)) {
    object.uri = rewrite;
    recordSummaryMutation(
      summary,
      maxSamples,
      "attachment_file_uri_rewritten",
      location,
      "file:",
      rewrite,
    );
  } else {
    delete object.uri;
    recordSummaryMutation(
      summary,
      maxSamples,
      "attachment_file_uri_removed",
      location,
      "file:",
      "[STRIPPED]",
    );
  }
  addMutationCount(mutationCounts, recordIndex, 1);
}

export function stripUnsafeOverflowRefs(
  records: RedactionRecord[],
  summary: RedactionSummary,
  maxSamples: number,
  mutationCounts: Map<number, number>,
): void {
  for (const [recordIndex, record] of records.entries()) {
    const value = record.value as Record<string, unknown>;
    if (value.type !== "tool_result") continue;
    const payload = value.payload as Record<string, unknown> | undefined;
    const overflowRef = payload?.overflow_ref;
    if (payload === undefined) continue;
    if (overflowRef === undefined) continue;
    if (typeof overflowRef === "string" && SHA256_REF_RE.test(overflowRef)) continue;
    delete payload.overflow_ref;
    recordSummaryMutation(
      summary,
      maxSamples,
      "overflow_ref_stripped",
      `records[${recordIndex}].payload.overflow_ref`,
      "[overflow_ref]",
      "[STRIPPED]",
    );
    addMutationCount(mutationCounts, recordIndex, 1);
  }
}

export function stripUnresolvedUserQueryResponses(
  records: RedactionRecord[],
  summary: RedactionSummary,
  maxSamples: number,
  mutationCounts: Map<number, number>,
): void {
  const queryIndex = indexUserQueries(records);
  for (const [recordIndex, record] of records.entries()) {
    stripOneUserQueryResponse(record, recordIndex, queryIndex, summary, maxSamples, mutationCounts);
  }
}

function indexUserQueries(records: RedactionRecord[]): UserQueryIndex {
  const groupByRecordIndex = new Map<number, number>();
  const queriesByGroup = new Map<number, Map<string, Set<string>>>();
  const secretQueriesByGroup = new Map<number, Set<string>>();
  let group = -1;
  for (const [recordIndex, record] of records.entries()) {
    const value = record.value as Record<string, unknown>;
    if (value.type === "session") group += 1;
    groupByRecordIndex.set(recordIndex, group);
    indexUserQuery(value, group, queriesByGroup, secretQueriesByGroup);
  }
  return { groupByRecordIndex, queriesByGroup, secretQueriesByGroup };
}

function indexUserQuery(
  value: Record<string, unknown>,
  group: number,
  queriesByGroup: Map<number, Map<string, Set<string>>>,
  secretQueriesByGroup: Map<number, Set<string>>,
): void {
  if (value.type !== "user_query" || typeof value.id !== "string") return;
  const payload = value.payload as { questions?: unknown } | undefined;
  const queries = queriesByGroup.get(group) ?? new Map<string, Set<string>>();
  queries.set(value.id, questionIdsFromPayload(payload));
  queriesByGroup.set(group, queries);
  if (hasSecretQuestion(payload)) {
    const secretQueries = secretQueriesByGroup.get(group) ?? new Set<string>();
    secretQueries.add(value.id);
    secretQueriesByGroup.set(group, secretQueries);
  }
}

function questionIdsFromPayload(payload: { questions?: unknown } | undefined): Set<string> {
  const questionIds = new Set<string>();
  if (!Array.isArray(payload?.questions)) return questionIds;
  for (const question of payload.questions) {
    if (question === null || typeof question !== "object") continue;
    const id = (question as { id?: unknown }).id;
    if (typeof id === "string") questionIds.add(id);
  }
  return questionIds;
}

function hasSecretQuestion(payload: { questions?: unknown } | undefined): boolean {
  if (!Array.isArray(payload?.questions)) return false;
  return payload.questions.some(
    (question) =>
      question !== null &&
      typeof question === "object" &&
      typeof (question as { id?: unknown }).id === "string" &&
      (question as { is_secret?: unknown }).is_secret === true,
  );
}

function stripOneUserQueryResponse(
  record: RedactionRecord,
  recordIndex: number,
  queryIndex: UserQueryIndex,
  summary: RedactionSummary,
  maxSamples: number,
  mutationCounts: Map<number, number>,
): void {
  const value = record.value as Record<string, unknown>;
  if (value.type !== "user_query_response") return;
  const source = value.source as Record<string, unknown> | undefined;
  if (!isPlainObject(value.payload)) {
    stripMalformedUserQueryResponsePayload(
      value,
      source,
      recordIndex,
      summary,
      maxSamples,
      mutationCounts,
    );
    return;
  }
  const payload = value.payload as { for_id?: unknown; answers?: unknown };
  const answers = objectAnswers(payload.answers);
  const recordGroup = queryIndex.groupByRecordIndex.get(recordIndex) ?? -1;
  const questionIds =
    typeof payload.for_id === "string"
      ? queryIndex.queriesByGroup.get(recordGroup)?.get(payload.for_id)
      : undefined;
  const isSecretQuery =
    typeof payload.for_id === "string" &&
    queryIndex.secretQueriesByGroup.get(recordGroup)?.has(payload.for_id) === true;

  if (questionIds !== undefined) {
    if (
      stripMalformedResolvedAnswers(
        payload,
        answers,
        isSecretQuery,
        source,
        recordIndex,
        summary,
        maxSamples,
        mutationCounts,
      )
    )
      return;
    stripUnknownAnswers(
      answers,
      questionIds,
      source,
      recordIndex,
      summary,
      maxSamples,
      mutationCounts,
    );
    return;
  }

  if (hasPresentAnswers(payload.answers)) {
    payload.answers = {};
    recordSummaryMutation(
      summary,
      maxSamples,
      "user_query_response_unresolved_answers_stripped",
      `records[${recordIndex}].payload.answers`,
      "[unresolved user_query_response answers]",
      "{}",
    );
    addMutationCount(mutationCounts, recordIndex, 1);
  }

  stripUserQueryResponseSourceRaw(
    source,
    recordIndex,
    summary,
    maxSamples,
    mutationCounts,
    "user_query_response_unresolved_source_raw_stripped",
    "[unresolved user_query_response source.raw]",
  );
}

function stripMalformedResolvedAnswers(
  payload: { answers?: unknown },
  answers: Record<string, unknown> | undefined,
  isSecretQuery: boolean,
  source: Record<string, unknown> | undefined,
  recordIndex: number,
  summary: RedactionSummary,
  maxSamples: number,
  mutationCounts: Map<number, number>,
): boolean {
  if (!hasPresentAnswers(payload.answers) || answers !== undefined) return false;
  if (isSecretQuery) return true;
  payload.answers = {};
  recordSummaryMutation(
    summary,
    maxSamples,
    "user_query_response_unknown_answers_stripped",
    `records[${recordIndex}].payload.answers`,
    "[malformed user_query_response answers]",
    "{}",
  );
  addMutationCount(mutationCounts, recordIndex, 1);
  stripUserQueryResponseSourceRaw(
    source,
    recordIndex,
    summary,
    maxSamples,
    mutationCounts,
    "user_query_response_unknown_source_raw_stripped",
    "[unknown user_query_response source.raw]",
  );
  return true;
}

function stripMalformedUserQueryResponsePayload(
  value: Record<string, unknown>,
  source: Record<string, unknown> | undefined,
  recordIndex: number,
  summary: RedactionSummary,
  maxSamples: number,
  mutationCounts: Map<number, number>,
): void {
  if (value.payload !== undefined && value.payload !== null) {
    value.payload = {};
    recordSummaryMutation(
      summary,
      maxSamples,
      "user_query_response_unresolved_answers_stripped",
      `records[${recordIndex}].payload`,
      "[malformed user_query_response payload]",
      "{}",
    );
    addMutationCount(mutationCounts, recordIndex, 1);
  }
  stripUserQueryResponseSourceRaw(
    source,
    recordIndex,
    summary,
    maxSamples,
    mutationCounts,
    "user_query_response_unresolved_source_raw_stripped",
    "[unresolved user_query_response source.raw]",
  );
}

function hasPresentAnswers(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stripUnknownAnswers(
  answers: Record<string, unknown> | undefined,
  questionIds: ReadonlySet<string>,
  source: Record<string, unknown> | undefined,
  recordIndex: number,
  summary: RedactionSummary,
  maxSamples: number,
  mutationCounts: Map<number, number>,
): void {
  if (answers === undefined) return;
  const unknownAnswerKeys = Object.keys(answers).filter((key) => !questionIds.has(key));
  if (unknownAnswerKeys.length === 0) return;
  for (const key of unknownAnswerKeys) delete answers[key];
  recordSummaryMutation(
    summary,
    maxSamples,
    "user_query_response_unknown_answers_stripped",
    `records[${recordIndex}].payload.answers`,
    "[unknown user_query_response answers]",
    "[STRIPPED]",
  );
  addMutationCount(mutationCounts, recordIndex, 1);
  stripUserQueryResponseSourceRaw(
    source,
    recordIndex,
    summary,
    maxSamples,
    mutationCounts,
    "user_query_response_unknown_source_raw_stripped",
    "[unknown user_query_response source.raw]",
  );
}

function objectAnswers(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function stripUserQueryResponseSourceRaw(
  source: Record<string, unknown> | undefined,
  recordIndex: number,
  summary: RedactionSummary,
  maxSamples: number,
  mutationCounts: Map<number, number>,
  patternId: string,
  before: string,
): void {
  if (source?.raw === undefined) return;
  const alreadyStripped = isSentinelRaw(source.raw, UNRESOLVED_USER_QUERY_RESPONSE_RAW_SENTINEL);
  if (alreadyStripped) return;
  source.raw = { redacted: UNRESOLVED_USER_QUERY_RESPONSE_RAW_SENTINEL };
  recordSummaryMutation(
    summary,
    maxSamples,
    patternId,
    `records[${recordIndex}].source.raw`,
    before,
    "[STRIPPED]",
  );
  addMutationCount(mutationCounts, recordIndex, 1);
}
