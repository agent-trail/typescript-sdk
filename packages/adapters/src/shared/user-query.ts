type UserQueryOption = { id?: string; label: string; description?: string };

/**
 * @internal
 */
export type UserQueryPayloadOptions = {
  fallbackId: (question: string, fallbackIndex: number) => string;
  fallbackIndex?: (
    question: Record<string, unknown>,
    arrayIndex: number,
    occurrences: Map<string, number>,
  ) => number;
  includeIsOther?: boolean;
  stringValue: (value: unknown) => string | undefined;
  isNonEmptyString: (value: unknown) => value is string;
};

/**
 * @internal
 */
export function userQueryPayloadFromInput(
  input: unknown,
  options: UserQueryPayloadOptions,
): { questions: Record<string, unknown>[] } | undefined {
  const args = isRecord(input) ? input : {};
  if (Array.isArray(args.questions)) {
    const occurrences = new Map<string, number>();
    const questions = args.questions
      .filter(isRecord)
      .map((question, index) =>
        userQueryQuestion(question, questionIndex(question, index, occurrences, options), options),
      )
      .filter((question): question is Record<string, unknown> => question !== undefined);
    if (questions.length > 0) return { questions };
  }

  const question = userQueryQuestion(args, 0, options);
  return question === undefined ? undefined : { questions: [question] };
}

function questionIndex(
  question: Record<string, unknown>,
  index: number,
  occurrences: Map<string, number>,
  options: UserQueryPayloadOptions,
): number {
  return options.fallbackIndex?.(question, index, occurrences) ?? index;
}

function userQueryQuestion(
  raw: Record<string, unknown>,
  fallbackIndex: number,
  options: UserQueryPayloadOptions,
): Record<string, unknown> | undefined {
  const question = options.stringValue(raw.question);
  if (question === undefined) return undefined;

  const out: Record<string, unknown> = {
    id: options.stringValue(raw.id) ?? options.fallbackId(question, fallbackIndex),
    question,
  };
  add(out, "header", options.stringValue(raw.header));
  add(out, "multi_select", firstBoolean(raw.multi_select, raw.multiSelect));
  add(out, "is_secret", firstBoolean(raw.is_secret, raw.isSecret));
  add(out, "allow_other", allowOtherValue(raw, options.includeIsOther === true));
  add(out, "options", optionObjects(raw.options, options) ?? optionObjects(raw.choices, options));
  return out;
}

function optionObjects(
  value: unknown,
  options: UserQueryPayloadOptions,
): UserQueryOption[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value
    .map((option) => optionObject(option, options))
    .filter((option): option is UserQueryOption => option !== undefined);
  return out.length === value.length ? out : undefined;
}

function optionObject(
  option: unknown,
  options: UserQueryPayloadOptions,
): UserQueryOption | undefined {
  if (typeof option === "string") return { label: option };
  if (!isRecord(option)) return undefined;
  const label = options.stringValue(option.label);
  if (label === undefined) return undefined;
  const id = options.stringValue(option.id);
  const description = options.stringValue(option.description);
  return {
    ...(id !== undefined && options.isNonEmptyString(id) ? { id } : {}),
    label,
    ...(description !== undefined ? { description } : {}),
  };
}

function allowOtherValue(
  raw: Record<string, unknown>,
  includeIsOther: boolean,
): boolean | undefined {
  return (
    firstBoolean(raw.allow_other, raw.allowOther, raw.is_other) ??
    (includeIsOther ? booleanValue(raw.isOther) : undefined)
  );
}

function firstBoolean(...values: unknown[]): boolean | undefined {
  return values.map(booleanValue).find((value) => value !== undefined);
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function add(out: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined) out[key] = value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
