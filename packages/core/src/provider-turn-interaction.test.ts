import { describe, expect, it } from "vitest";
import {
  PROVIDER_PLAN_MAX_BYTES,
  createProviderTurnInteractionState,
  reduceProviderTurnInteraction,
  validateProviderQuestionResolution,
} from "./provider-turn-interaction.js";
import type { ProviderQuestionProjection } from "@thoth/protocol/agent-types";

describe("ProviderTurnInteraction", () => {
  it("blocks Plan completion and terminal success while a Provider question is pending", () => {
    let state = createProviderTurnInteractionState({
      providerThreadId: "thread-1",
      providerTurnId: "turn-1",
    });
    state = reduceProviderTurnInteraction(state, {
      type: "question_requested",
      providerThreadId: "thread-1",
      providerTurnId: "turn-1",
      interactionId: "question-1",
    }).state;

    expect(
      reduceProviderTurnInteraction(state, {
        type: "plan_completed",
        providerThreadId: "thread-1",
        providerTurnId: "turn-1",
        itemId: "plan-1",
        byteLength: 20,
      }),
    ).toMatchObject({ accepted: false, errorCode: "PROVIDER_QUESTION_PENDING" });
    expect(
      reduceProviderTurnInteraction(state, {
        type: "turn_completed",
        providerThreadId: "thread-1",
        providerTurnId: "turn-1",
      }),
    ).toMatchObject({
      accepted: false,
      errorCode: "PROVIDER_QUESTION_PENDING",
      state: { phase: "invalid", pendingQuestionId: null },
    });
  });

  it("accepts question -> completed Plan -> Implement exactly in order", () => {
    let state = createProviderTurnInteractionState({
      providerThreadId: "thread-1",
      providerTurnId: "turn-1",
    });
    for (const event of [
      {
        type: "question_requested",
        providerThreadId: "thread-1",
        providerTurnId: "turn-1",
        interactionId: "question-1",
      } as const,
      {
        type: "question_resolved",
        providerThreadId: "thread-1",
        providerTurnId: "turn-1",
        interactionId: "question-1",
        resolution: "answered",
      } as const,
      {
        type: "plan_completed",
        providerThreadId: "thread-1",
        providerTurnId: "turn-1",
        itemId: "plan-1",
        byteLength: 20,
      } as const,
      {
        type: "turn_completed",
        providerThreadId: "thread-1",
        providerTurnId: "turn-1",
      } as const,
      { type: "implementation_approved" } as const,
      { type: "implementation_settled" } as const,
    ]) {
      const result = reduceProviderTurnInteraction(state, event);
      expect(result.accepted).toBe(true);
      state = result.state;
    }
    expect(state.phase).toBe("settled");
  });

  it("rejects missing, oversized and duplicate completed Plans", () => {
    const initial = createProviderTurnInteractionState({
      providerThreadId: "thread-1",
      providerTurnId: "turn-1",
    });
    expect(
      reduceProviderTurnInteraction(initial, {
        type: "turn_completed",
        providerThreadId: "thread-1",
        providerTurnId: "turn-1",
      }),
    ).toMatchObject({ errorCode: "PROVIDER_PLAN_MISSING" });
    expect(
      reduceProviderTurnInteraction(initial, {
        type: "plan_completed",
        providerThreadId: "thread-1",
        providerTurnId: "turn-1",
        itemId: "large",
        byteLength: PROVIDER_PLAN_MAX_BYTES + 1,
      }),
    ).toMatchObject({ errorCode: "PROVIDER_PLAN_TOO_LARGE" });
    const planned = reduceProviderTurnInteraction(initial, {
      type: "plan_completed",
      providerThreadId: "thread-1",
      providerTurnId: "turn-1",
      itemId: "plan-1",
      byteLength: PROVIDER_PLAN_MAX_BYTES,
    }).state;
    expect(
      reduceProviderTurnInteraction(planned, {
        type: "plan_completed",
        providerThreadId: "thread-1",
        providerTurnId: "turn-1",
        itemId: "plan-1",
        byteLength: 1,
      }),
    ).toMatchObject({ errorCode: "PROVIDER_PLAN_DUPLICATE" });
  });

  it("rejects Provider events from a different native thread or turn", () => {
    const initial = createProviderTurnInteractionState({
      providerThreadId: "thread-1",
      providerTurnId: "turn-1",
    });
    expect(
      reduceProviderTurnInteraction(initial, {
        type: "plan_completed",
        providerThreadId: "thread-2",
        providerTurnId: "turn-1",
        itemId: "plan-1",
        byteLength: 10,
      }),
    ).toMatchObject({ accepted: false, errorCode: "PROVIDER_TURN_MISMATCH" });
    expect(
      reduceProviderTurnInteraction(initial, {
        type: "question_requested",
        providerThreadId: "thread-1",
        providerTurnId: "turn-2",
        interactionId: "question-1",
      }),
    ).toMatchObject({ accepted: false, errorCode: "PROVIDER_TURN_MISMATCH" });
  });

  it("expires an unanswered Provider question without inventing a resolution", () => {
    const pending = reduceProviderTurnInteraction(
      createProviderTurnInteractionState({
        providerThreadId: "thread-1",
        providerTurnId: "turn-1",
      }),
      {
        type: "question_requested",
        providerThreadId: "thread-1",
        providerTurnId: "turn-1",
        interactionId: "question-1",
      },
    ).state;
    expect(
      reduceProviderTurnInteraction(pending, {
        type: "question_resolved",
        providerThreadId: "thread-1",
        providerTurnId: "turn-1",
        interactionId: "question-1",
        resolution: "expired",
      }),
    ).toMatchObject({
      accepted: false,
      errorCode: "PROVIDER_QUESTION_PENDING",
      state: { phase: "invalid", pendingQuestionId: null },
    });
  });

  it("uses UTF-8 bytes at the exact completed Plan boundary", () => {
    const initial = createProviderTurnInteractionState({
      providerThreadId: "thread-1",
      providerTurnId: "turn-1",
    });
    const exact = "界".repeat(Math.floor(PROVIDER_PLAN_MAX_BYTES / 3)) + "a";
    expect(Buffer.byteLength(exact, "utf8")).toBe(PROVIDER_PLAN_MAX_BYTES);
    expect(
      reduceProviderTurnInteraction(initial, {
        type: "plan_completed",
        providerThreadId: "thread-1",
        providerTurnId: "turn-1",
        itemId: "utf8-exact",
        byteLength: Buffer.byteLength(exact, "utf8"),
      }).accepted,
    ).toBe(true);
    expect(
      reduceProviderTurnInteraction(initial, {
        type: "plan_completed",
        providerThreadId: "thread-1",
        providerTurnId: "turn-1",
        itemId: "utf8-too-large",
        byteLength: Buffer.byteLength(`${exact}界`, "utf8"),
      }),
    ).toMatchObject({ accepted: false, errorCode: "PROVIDER_PLAN_TOO_LARGE" });
  });

  it("validates structured answers by question id and preserves arrays", () => {
    const projection: ProviderQuestionProjection = {
      interactionId: "interaction-1",
      agentId: "agent-1",
      providerThreadId: "thread-1",
      providerTurnId: "turn-1",
      providerItemId: "item-1",
      revision: 0,
      questions: [
        {
          id: "one",
          header: "Same",
          prompt: "One",
          options: [{ value: "a", label: "A" }],
          selectionMode: "single",
          allowOther: false,
          secret: false,
        },
        {
          id: "many",
          header: "Same",
          prompt: "Many",
          options: [],
          selectionMode: "multiple",
          allowOther: true,
          secret: true,
        },
      ],
      expiresAt: null,
    };
    const valid = validateProviderQuestionResolution(projection, {
      type: "answer",
      answers: [
        { questionId: "one", values: ["a"] },
        { questionId: "many", values: ["one,two", "three"] },
      ],
    });
    expect(valid.accepted && valid.answersByQuestionId.get("many")).toEqual(["one,two", "three"]);
    expect(
      validateProviderQuestionResolution(projection, {
        type: "answer",
        answers: [
          { questionId: "one", values: ["a", "a"] },
          { questionId: "many", values: ["x"] },
        ],
      }),
    ).toMatchObject({ accepted: false, errorCode: "PROVIDER_QUESTION_INVALID_RESPONSE" });
  });
});
