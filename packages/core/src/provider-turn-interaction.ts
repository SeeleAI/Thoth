import type {
  ProviderQuestionProjection,
  ProviderQuestionResolution,
} from "@thoth/protocol/agent-types";

export const PROVIDER_PLAN_MAX_BYTES = 64 * 1024;

export type ProviderTurnInteractionPhase =
  | "running"
  | "awaiting_provider_question"
  | "plan_completed"
  | "awaiting_implementation"
  | "implementing"
  | "settled"
  | "invalid";

export interface ProviderTurnInteractionState {
  providerThreadId: string;
  providerTurnId: string;
  phase: ProviderTurnInteractionPhase;
  pendingQuestionId: string | null;
  completedPlanId: string | null;
  errorCode: ProviderTurnInteractionErrorCode | null;
}

export type ProviderTurnInteractionErrorCode =
  | "PROVIDER_QUESTION_PENDING"
  | "PROVIDER_QUESTION_MISMATCH"
  | "PROVIDER_PLAN_MISSING"
  | "PROVIDER_PLAN_SEQUENCE_INVALID"
  | "PROVIDER_PLAN_TOO_LARGE"
  | "PROVIDER_PLAN_DUPLICATE"
  | "PROVIDER_TURN_MISMATCH";

export type ProviderTurnInteractionEvent =
  | {
      type: "question_requested";
      providerThreadId: string;
      providerTurnId: string;
      interactionId: string;
    }
  | {
      type: "question_resolved";
      providerThreadId: string;
      providerTurnId: string;
      interactionId: string;
      resolution: "answered" | "dismissed" | "expired";
    }
  | {
      type: "plan_completed";
      providerThreadId: string;
      providerTurnId: string;
      itemId: string;
      byteLength: number;
    }
  | { type: "turn_completed"; providerThreadId: string; providerTurnId: string }
  | { type: "implementation_approved" }
  | { type: "implementation_rejected" }
  | { type: "implementation_settled" };

export interface ProviderTurnInteractionTransition {
  state: ProviderTurnInteractionState;
  accepted: boolean;
  errorCode: ProviderTurnInteractionErrorCode | null;
}

export type ProviderQuestionValidationResult =
  | {
      accepted: true;
      answersByQuestionId: ReadonlyMap<string, readonly string[]>;
      errorCode: null;
    }
  | {
      accepted: false;
      answersByQuestionId: null;
      errorCode: "PROVIDER_QUESTION_INVALID_RESPONSE";
    };

export function validateProviderQuestionResolution(
  projection: ProviderQuestionProjection,
  resolution: ProviderQuestionResolution,
): ProviderQuestionValidationResult {
  if (resolution.type === "dismiss") {
    return { accepted: true, answersByQuestionId: new Map(), errorCode: null };
  }
  const questions = new Map(projection.questions.map((question) => [question.id, question]));
  const answers = new Map<string, readonly string[]>();
  for (const answer of resolution.answers) {
    const question = questions.get(answer.questionId);
    if (!question || answers.has(answer.questionId)) {
      return {
        accepted: false,
        answersByQuestionId: null,
        errorCode: "PROVIDER_QUESTION_INVALID_RESPONSE",
      };
    }
    if (answer.values.length === 0 || answer.values.some((value) => value.trim().length === 0)) {
      return {
        accepted: false,
        answersByQuestionId: null,
        errorCode: "PROVIDER_QUESTION_INVALID_RESPONSE",
      };
    }
    if (question.selectionMode === "single" && answer.values.length !== 1) {
      return {
        accepted: false,
        answersByQuestionId: null,
        errorCode: "PROVIDER_QUESTION_INVALID_RESPONSE",
      };
    }
    const allowed = new Set(question.options.map((option) => option.value));
    if (!question.allowOther && answer.values.some((value) => !allowed.has(value))) {
      return {
        accepted: false,
        answersByQuestionId: null,
        errorCode: "PROVIDER_QUESTION_INVALID_RESPONSE",
      };
    }
    answers.set(answer.questionId, [...answer.values]);
  }
  if (projection.questions.some((question) => !answers.has(question.id))) {
    return {
      accepted: false,
      answersByQuestionId: null,
      errorCode: "PROVIDER_QUESTION_INVALID_RESPONSE",
    };
  }
  return { accepted: true, answersByQuestionId: answers, errorCode: null };
}

export function createProviderTurnInteractionState(input: {
  providerThreadId: string;
  providerTurnId: string;
}): ProviderTurnInteractionState {
  return {
    providerThreadId: input.providerThreadId,
    providerTurnId: input.providerTurnId,
    phase: "running",
    pendingQuestionId: null,
    completedPlanId: null,
    errorCode: null,
  };
}

function reject(
  state: ProviderTurnInteractionState,
  errorCode: ProviderTurnInteractionErrorCode,
): ProviderTurnInteractionTransition {
  return { state: { ...state, errorCode }, accepted: false, errorCode };
}

function accept(
  state: ProviderTurnInteractionState,
  patch: Partial<ProviderTurnInteractionState>,
): ProviderTurnInteractionTransition {
  return {
    state: { ...state, ...patch, errorCode: null },
    accepted: true,
    errorCode: null,
  };
}

export function reduceProviderTurnInteraction(
  state: ProviderTurnInteractionState,
  event: ProviderTurnInteractionEvent,
): ProviderTurnInteractionTransition {
  if (
    "providerThreadId" in event &&
    (event.providerThreadId !== state.providerThreadId ||
      event.providerTurnId !== state.providerTurnId)
  ) {
    return reject(state, "PROVIDER_TURN_MISMATCH");
  }
  switch (event.type) {
    case "question_requested":
      if (state.phase !== "running" || state.pendingQuestionId) {
        return reject(state, "PROVIDER_PLAN_SEQUENCE_INVALID");
      }
      return accept(state, {
        phase: "awaiting_provider_question",
        pendingQuestionId: event.interactionId,
      });
    case "question_resolved":
      if (
        state.phase !== "awaiting_provider_question" ||
        state.pendingQuestionId !== event.interactionId
      ) {
        return reject(state, "PROVIDER_QUESTION_MISMATCH");
      }
      if (event.resolution === "expired") {
        return reject(
          { ...state, phase: "invalid", pendingQuestionId: null },
          "PROVIDER_QUESTION_PENDING",
        );
      }
      return accept(state, { phase: "running", pendingQuestionId: null });
    case "plan_completed":
      if (state.pendingQuestionId) {
        return reject(state, "PROVIDER_QUESTION_PENDING");
      }
      if (event.byteLength > PROVIDER_PLAN_MAX_BYTES) {
        return reject(state, "PROVIDER_PLAN_TOO_LARGE");
      }
      if (state.completedPlanId === event.itemId) {
        return reject(state, "PROVIDER_PLAN_DUPLICATE");
      }
      if (state.phase !== "running" || state.completedPlanId) {
        return reject(state, "PROVIDER_PLAN_SEQUENCE_INVALID");
      }
      return accept(state, { phase: "plan_completed", completedPlanId: event.itemId });
    case "turn_completed":
      if (state.pendingQuestionId) {
        return reject(
          { ...state, phase: "invalid", pendingQuestionId: null },
          "PROVIDER_QUESTION_PENDING",
        );
      }
      if (state.phase !== "plan_completed") {
        return reject({ ...state, phase: "invalid" }, "PROVIDER_PLAN_MISSING");
      }
      return accept(state, { phase: "awaiting_implementation" });
    case "implementation_approved":
      return state.phase === "awaiting_implementation"
        ? accept(state, { phase: "implementing" })
        : reject(state, "PROVIDER_PLAN_SEQUENCE_INVALID");
    case "implementation_rejected":
      return state.phase === "awaiting_implementation"
        ? accept(state, { phase: "settled" })
        : reject(state, "PROVIDER_PLAN_SEQUENCE_INVALID");
    case "implementation_settled":
      return state.phase === "implementing"
        ? accept(state, { phase: "settled" })
        : reject(state, "PROVIDER_PLAN_SEQUENCE_INVALID");
  }
}
