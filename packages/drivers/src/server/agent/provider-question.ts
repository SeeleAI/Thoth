import type { ProviderQuestionProjection, ProviderQuestionResolution } from "./harness-contract.js";

export class ProviderQuestionValidationError extends Error {
  readonly code = "PROVIDER_QUESTION_INVALID_RESPONSE";
}

/**
 * Validate one structured Provider answer without converting it through labels,
 * headers, or comma-delimited text. Returned arrays preserve the exact values
 * supplied by the user for the Provider-specific codec.
 */
export function validateProviderQuestionResolution(
  projection: ProviderQuestionProjection,
  resolution: ProviderQuestionResolution,
): ReadonlyMap<string, readonly string[]> {
  if (resolution.type === "dismiss") {
    return new Map();
  }

  const questionById = new Map(projection.questions.map((question) => [question.id, question]));
  const answersById = new Map<string, readonly string[]>();

  for (const answer of resolution.answers) {
    if (answersById.has(answer.questionId)) {
      throw new ProviderQuestionValidationError(
        `Provider question '${answer.questionId}' was answered more than once`,
      );
    }
    const question = questionById.get(answer.questionId);
    if (!question) {
      throw new ProviderQuestionValidationError(
        `Unknown Provider question id '${answer.questionId}'`,
      );
    }
    if (answer.values.length === 0 || answer.values.some((value) => value.trim().length === 0)) {
      throw new ProviderQuestionValidationError(
        `Provider question '${answer.questionId}' requires a non-empty answer`,
      );
    }
    if (question.selectionMode === "single" && answer.values.length !== 1) {
      throw new ProviderQuestionValidationError(
        `Provider question '${answer.questionId}' accepts exactly one answer`,
      );
    }

    const allowedValues = new Set(question.options.map((option) => option.value));
    if (!question.allowOther) {
      const invalidValue = answer.values.find((value) => !allowedValues.has(value));
      if (invalidValue !== undefined) {
        throw new ProviderQuestionValidationError(
          `Provider question '${answer.questionId}' contains a value outside its allowed options`,
        );
      }
    }
    answersById.set(answer.questionId, [...answer.values]);
  }

  for (const question of projection.questions) {
    if (!answersById.has(question.id)) {
      throw new ProviderQuestionValidationError(
        `Provider question '${question.id}' is missing an answer`,
      );
    }
  }

  return answersById;
}
