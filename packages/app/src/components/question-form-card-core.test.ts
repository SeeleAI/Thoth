import { describe, expect, test } from "vitest";
import type { ProviderQuestionItem } from "@thoth/protocol/agent-types";
import {
  areQuestionsAnswered,
  buildProviderQuestionResolution,
  questionShowsTextInput,
} from "./question-form-card-core";

const questions: ProviderQuestionItem[] = [
  {
    id: "target",
    header: "Choice",
    prompt: "Choose one target",
    options: [
      { value: "a", label: "A" },
      { value: "b", label: "B" },
    ],
    selectionMode: "single",
    allowOther: false,
    secret: false,
  },
  {
    id: "checks",
    header: "Choice",
    prompt: "Choose checks",
    options: [
      { value: "unit", label: "Unit" },
      { value: "e2e", label: "E2E" },
    ],
    selectionMode: "multiple",
    allowOther: true,
    secret: false,
  },
];

describe("Provider question form core", () => {
  test("keys answers by native question id even when headers repeat", () => {
    const selections = {
      target: new Set(["b"]),
      checks: new Set(["unit", "e2e"]),
    };
    expect(areQuestionsAnswered(questions, selections, {})).toBe(true);
    expect(buildProviderQuestionResolution(questions, selections, {})).toEqual({
      type: "answer",
      answers: [
        { questionId: "target", values: ["b"] },
        { questionId: "checks", values: ["unit", "e2e"] },
      ],
    });
  });

  test("keeps a free-form Other answer as one array value", () => {
    expect(questionShowsTextInput(questions[1]!)).toBe(true);
    expect(
      buildProviderQuestionResolution(
        questions,
        { target: new Set(["a"]), checks: new Set() },
        { checks: "custom,unsplit" },
      ),
    ).toEqual({
      type: "answer",
      answers: [
        { questionId: "target", values: ["a"] },
        { questionId: "checks", values: ["custom,unsplit"] },
      ],
    });
  });

  test("does not accept an empty required answer", () => {
    expect(areQuestionsAnswered(questions, { target: new Set(["a"]) }, {})).toBe(false);
  });
});
