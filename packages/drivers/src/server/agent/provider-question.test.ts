import { describe, expect, it } from "vitest";
import type { ProviderQuestionProjection } from "./harness-contract.js";
import { validateProviderQuestionResolution } from "./provider-question.js";

const projection: ProviderQuestionProjection = {
  interactionId: "interaction-1",
  agentId: "agent-1",
  providerThreadId: "thread-1",
  providerTurnId: "turn-1",
  providerItemId: "item-1",
  revision: 0,
  questions: [
    {
      id: "single",
      header: "Repeated",
      prompt: "Choose one",
      options: [
        { value: "a", label: "A" },
        { value: "b", label: "B" },
      ],
      selectionMode: "single",
      allowOther: false,
      secret: false,
    },
    {
      id: "multiple",
      header: "Repeated",
      prompt: "Choose several",
      options: [],
      selectionMode: "multiple",
      allowOther: true,
      secret: true,
    },
  ],
  expiresAt: null,
};

describe("Provider question resolution", () => {
  it("preserves question-id arrays and duplicate headers without comma parsing", () => {
    const result = validateProviderQuestionResolution(projection, {
      type: "answer",
      answers: [
        { questionId: "single", values: ["a"] },
        { questionId: "multiple", values: ["one,two", "three"] },
      ],
    });

    expect(result.get("single")).toEqual(["a"]);
    expect(result.get("multiple")).toEqual(["one,two", "three"]);
  });

  it.each([
    {
      name: "duplicate",
      answers: [
        { questionId: "single", values: ["a"] },
        { questionId: "single", values: ["b"] },
        { questionId: "multiple", values: ["x"] },
      ],
    },
    {
      name: "unknown",
      answers: [
        { questionId: "single", values: ["a"] },
        { questionId: "unknown", values: ["x"] },
        { questionId: "multiple", values: ["x"] },
      ],
    },
    {
      name: "missing",
      answers: [{ questionId: "single", values: ["a"] }],
    },
    {
      name: "empty",
      answers: [
        { questionId: "single", values: [] },
        { questionId: "multiple", values: ["x"] },
      ],
    },
    {
      name: "single with multiple values",
      answers: [
        { questionId: "single", values: ["a", "b"] },
        { questionId: "multiple", values: ["x"] },
      ],
    },
    {
      name: "option outside the closed set",
      answers: [
        { questionId: "single", values: ["other"] },
        { questionId: "multiple", values: ["x"] },
      ],
    },
  ])("rejects $name while leaving the caller's live handler untouched", ({ answers }) => {
    expect(() =>
      validateProviderQuestionResolution(projection, { type: "answer", answers }),
    ).toThrowError(expect.objectContaining({ code: "PROVIDER_QUESTION_INVALID_RESPONSE" }));
  });

  it("represents dismiss without inventing an answer", () => {
    expect(validateProviderQuestionResolution(projection, { type: "dismiss" }).size).toBe(0);
  });
});
