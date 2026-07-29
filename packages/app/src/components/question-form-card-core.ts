import type { ProviderQuestionItem, ProviderQuestionResolution } from "@thoth/protocol/agent-types";

export type QuestionSelections = Record<string, ReadonlySet<string>>;
export type QuestionOtherTexts = Record<string, string>;

export function questionShowsTextInput(question: ProviderQuestionItem): boolean {
  return question.options.length === 0 || question.allowOther;
}

export function isQuestionAnswered(
  question: ProviderQuestionItem,
  selections: QuestionSelections,
  otherTexts: QuestionOtherTexts,
): boolean {
  const selected = selections[question.id];
  if (selected && selected.size > 0) return true;
  if (!questionShowsTextInput(question)) return false;
  return Boolean(otherTexts[question.id]?.trim());
}

export function areQuestionsAnswered(
  questions: readonly ProviderQuestionItem[],
  selections: QuestionSelections,
  otherTexts: QuestionOtherTexts,
): boolean {
  return questions.every((question) => isQuestionAnswered(question, selections, otherTexts));
}

export function buildProviderQuestionResolution(
  questions: readonly ProviderQuestionItem[],
  selections: QuestionSelections,
  otherTexts: QuestionOtherTexts,
): ProviderQuestionResolution {
  return {
    type: "answer",
    answers: questions.map((question) => {
      const other = otherTexts[question.id]?.trim();
      const values = other
        ? [other]
        : Array.from(selections[question.id] ?? []).filter((value) => value.length > 0);
      return { questionId: question.id, values };
    }),
  };
}
