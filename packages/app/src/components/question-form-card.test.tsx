/**
 * @vitest-environment jsdom
 */
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderQuestionProjection } from "@thoth/protocol/agent-types";
import { QuestionFormCard } from "./question-form-card";

const { theme } = vi.hoisted(() => ({
  theme: {
    spacing: { 1: 4, 2: 8, 3: 12 },
    borderWidth: { 1: 1 },
    borderRadius: { md: 6, lg: 8 },
    fontSize: { xs: 11, sm: 13, base: 15 },
    fontWeight: { medium: "500" },
    colors: {
      foreground: "#fff",
      foregroundMuted: "#aaa",
      surface1: "#111",
      surface2: "#222",
      border: "#444",
      borderAccent: "#777",
      destructive: "#f44",
      accent: "#39f",
      accentForeground: "#fff",
    },
  },
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: unknown) => (typeof factory === "function" ? factory(theme) : factory),
  },
  useUnistyles: () => ({ theme }),
}));
vi.mock("@/constants/layout", () => ({ useIsCompactFormFactor: () => false }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "common.actions.dismiss": "Dismiss",
        "message.question.submit": "Submit",
        "message.question.next": "Next",
        "message.question.answerPlaceholder": "Answer",
        "message.question.otherPlaceholder": "Other",
      })[key] ?? key,
  }),
}));
vi.mock("lucide-react-native", () => ({ Check: () => null, X: () => null }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function projection(): ProviderQuestionProjection {
  return {
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
        options: [
          { value: "x", label: "X" },
          { value: "y", label: "Y" },
        ],
        selectionMode: "multiple",
        allowOther: false,
        secret: false,
      },
      {
        id: "secret",
        header: "Secret",
        prompt: "Enter secret",
        options: [],
        selectionMode: "single",
        allowOther: true,
        secret: true,
      },
    ],
    expiresAt: null,
  };
}

describe("QuestionFormCard", () => {
  it("submits multiple questions by id with arrays, duplicate headers, Other text, and secret input", async () => {
    const onRespond = vi.fn().mockResolvedValue(undefined);
    render(
      <QuestionFormCard
        question={projection()}
        onRespond={onRespond}
        isResponding={false}
        error={null}
      />,
    );

    fireEvent.click(screen.getByTestId("question-form-option-single-a"));
    expect(screen.getByTestId("question-form-current-question").textContent).toContain(
      "Choose several",
    );
    fireEvent.click(screen.getByTestId("question-form-option-multiple-x"));
    fireEvent.click(screen.getByTestId("question-form-option-multiple-y"));
    fireEvent.click(screen.getByTestId("question-form-primary-action"));

    const secret = screen.getByTestId("question-form-other-secret");
    expect(secret.getAttribute("type")).toBe("password");
    fireEvent.change(secret, { target: { value: "one,two" } });
    fireEvent.click(screen.getByTestId("question-form-primary-action"));

    await waitFor(() => expect(onRespond).toHaveBeenCalledTimes(1));
    expect(onRespond).toHaveBeenCalledWith({
      type: "answer",
      answers: [
        { questionId: "single", values: ["a"] },
        { questionId: "multiple", values: ["x", "y"] },
        { questionId: "secret", values: ["one,two"] },
      ],
    });
  });

  it("dismisses without selecting a default answer", async () => {
    const onRespond = vi.fn().mockResolvedValue(undefined);
    render(
      <QuestionFormCard
        question={projection()}
        onRespond={onRespond}
        isResponding={false}
        error={null}
      />,
    );

    fireEvent.click(screen.getByTestId("question-form-dismiss"));
    await waitFor(() => expect(onRespond).toHaveBeenCalledWith({ type: "dismiss" }));
  });

  it("keeps the card and entered answer visible after a rejected submit", async () => {
    const question = projection();
    question.questions = [question.questions[2]!];
    const onRespond = vi.fn().mockRejectedValue(new Error("stale"));
    const { rerender } = render(
      <QuestionFormCard
        question={question}
        onRespond={onRespond}
        isResponding={false}
        error={null}
      />,
    );
    const input = screen.getByTestId("question-form-other-secret");
    fireEvent.change(input, { target: { value: "retained secret" } });
    fireEvent.click(screen.getByTestId("question-form-primary-action"));
    await waitFor(() => expect(onRespond).toHaveBeenCalledTimes(1));

    rerender(
      <QuestionFormCard
        question={question}
        onRespond={onRespond}
        isResponding={false}
        error="The answer was rejected."
      />,
    );
    expect(screen.getByTestId("question-form-card")).toBeTruthy();
    expect((screen.getByTestId("question-form-other-secret") as HTMLInputElement).value).toBe(
      "retained secret",
    );
    expect(screen.getByTestId("question-form-error").textContent).toContain("rejected");
  });
});
