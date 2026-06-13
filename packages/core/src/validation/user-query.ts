import type { ParsedTrailRecord, SessionGroup, TrailDiagnostic } from "../index.js";
import { diagnostic, escapeJsonPointer, isJsonObject, readString } from "../shared.js";

export function userQueryDiagnostics(group: SessionGroup): TrailDiagnostic[] {
  const diagnostics: TrailDiagnostic[] = [];
  const queryQuestions = new Map<string, Set<string>>();
  for (const event of group.events) {
    diagnostics.push(...recordUserQuery(event, queryQuestions));
    diagnostics.push(...recordUserQueryResponse(event, queryQuestions));
  }
  return diagnostics;
}

function recordUserQuery(
  event: ParsedTrailRecord,
  queryQuestions: Map<string, Set<string>>,
): TrailDiagnostic[] {
  if (
    event.record.type !== "user_query" ||
    !isJsonObject(event.record.payload) ||
    !Array.isArray(event.record.payload.questions)
  )
    return [];

  const questionIds = new Set<string>();
  const diagnostics = event.record.payload.questions.flatMap((question, questionIndex) =>
    questionDiagnostics(event.line, questionIndex, question, questionIds),
  );
  const eventId = readString(event.record, "id");
  if (eventId !== undefined) queryQuestions.set(eventId, questionIds);
  return diagnostics;
}

function questionDiagnostics(
  line: number,
  questionIndex: number,
  question: unknown,
  questionIds: Set<string>,
): TrailDiagnostic[] {
  if (!isJsonObject(question)) return [];
  const diagnostics: TrailDiagnostic[] = [];
  const questionId = readString(question, "id");
  if (questionId !== undefined) {
    if (questionIds.has(questionId)) {
      diagnostics.push(
        diagnostic(
          line,
          `/payload/questions/${questionIndex}/id`,
          "error",
          "duplicate_user_query_question_id",
        ),
      );
    }
    questionIds.add(questionId);
  }
  diagnostics.push(...optionDiagnostics(line, questionIndex, question.options));
  return diagnostics;
}

function optionDiagnostics(
  line: number,
  questionIndex: number,
  options: unknown,
): TrailDiagnostic[] {
  if (!Array.isArray(options)) return [];
  const diagnostics: TrailDiagnostic[] = [];
  const labels = new Map<string, { hasId: boolean }>();
  for (const [optionIndex, option] of options.entries()) {
    if (!isJsonObject(option) || typeof option.label !== "string") continue;
    const previous = labels.get(option.label);
    const hasId = typeof option.id === "string";
    if (previous !== undefined && (!previous.hasId || !hasId)) {
      diagnostics.push(
        diagnostic(
          line,
          `/payload/questions/${questionIndex}/options/${optionIndex}/label`,
          "warning",
          "duplicate_option_labels",
        ),
      );
    }
    labels.set(option.label, { hasId });
  }
  return diagnostics;
}

function recordUserQueryResponse(
  event: ParsedTrailRecord,
  queryQuestions: Map<string, Set<string>>,
): TrailDiagnostic[] {
  if (event.record.type !== "user_query_response" || !isJsonObject(event.record.payload)) return [];
  const forId = readString(event.record.payload, "for_id");
  const questions = forId === undefined ? undefined : queryQuestions.get(forId);
  return [
    ...unknownQueryForIdDiagnostics(event, forId, questions),
    ...unknownAnswerKeyDiagnostics(event, questions),
  ];
}

function unknownQueryForIdDiagnostics(
  event: ParsedTrailRecord,
  forId: string | undefined,
  questions: Set<string> | undefined,
): TrailDiagnostic[] {
  return forId !== undefined && questions === undefined
    ? [diagnostic(event.line, "/payload/for_id", "warning", "unknown_user_query_for_id")]
    : [];
}

function unknownAnswerKeyDiagnostics(
  event: ParsedTrailRecord,
  questions: Set<string> | undefined,
): TrailDiagnostic[] {
  if (
    questions === undefined ||
    !("payload" in event.record) ||
    !isJsonObject(event.record.payload) ||
    !isJsonObject(event.record.payload.answers)
  )
    return [];
  return Object.keys(event.record.payload.answers).flatMap((key) =>
    questions.has(key)
      ? []
      : [
          diagnostic(
            event.line,
            `/payload/answers/${escapeJsonPointer(key)}`,
            "error",
            "unknown_user_query_answer_key",
          ),
        ],
  );
}
