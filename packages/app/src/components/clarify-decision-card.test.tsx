/**
 * @vitest-environment jsdom
 */
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThothClarifyCardModel } from "@thoth/protocol/thoth/rpc-schemas";
import { ClarifyDecisionCard } from "./clarify-decision-card";

const { theme } = vi.hoisted(() => ({
  theme: {
    spacing: { 1: 4, 2: 8, 3: 12, 4: 16 },
    borderWidth: { 1: 1 },
    borderRadius: { md: 6, lg: 8 },
    fontSize: { xs: 11, sm: 13, base: 15 },
    fontWeight: { medium: "500", semibold: "600" },
    iconSize: { md: 16 },
    opacity: { 50: 0.5 },
    colors: {
      accent: "#0a84ff",
      accentForeground: "#fff",
      foreground: "#fff",
      foregroundMuted: "#aaa",
      surface0: "#000",
      surface1: "#111",
      surface2: "#222",
      border: "#444",
      borderAccent: "#666",
    },
  },
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: unknown) => (typeof factory === "function" ? factory(theme) : factory),
  },
  useUnistyles: () => ({ theme }),
}));

vi.mock("lucide-react-native", () => ({
  Check: () => React.createElement("span", { "data-icon": "Check" }),
}));

vi.hoisted(() => {
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function card(overrides: Partial<ThothClarifyCardModel> = {}): ThothClarifyCardModel {
  return {
    id: "clarify-card-1",
    sessionId: "clarify-session-1",
    roundIndex: 1,
    submitted: false,
    card: {
      title: "确认方向",
      whyNow: "先确认关键分叉。",
      publicSummary: "确认影响实现与验收的关键分叉。",
      allowChoiceNotes: true,
      allowNoteOnly: true,
      allowSubtreeDelegation: true,
      questions: [
        {
          nodeId: "scope",
          question: "优先哪条路线？",
          selectionMode: "single",
          recommendedChoiceId: "ship",
          choices: [
            { id: "ship", label: "上线", description: "真实发布" },
            { id: "demo", label: "演示", description: "先做演示" },
          ],
        },
        {
          nodeId: "risk",
          question: "风险边界？",
          selectionMode: "single",
          recommendedChoiceId: "safe",
          choices: [
            { id: "safe", label: "保守", description: "少改动" },
            { id: "bold", label: "激进", description: "可重构" },
          ],
        },
        {
          nodeId: "evidence",
          question: "需要哪些验收？",
          selectionMode: "multiple",
          recommendedChoiceId: "tests",
          choices: [
            { id: "tests", label: "测试", description: "覆盖正确性" },
            { id: "bench", label: "基准", description: "覆盖性能" },
          ],
        },
      ],
    },
    ...overrides,
  };
}

describe("ClarifyDecisionCard", () => {
  it("renders a typed multi-question clarify card without preselected choices", () => {
    render(<ClarifyDecisionCard card={card()} onSubmit={vi.fn()} />);

    expect(screen.getByTestId("clarify-card-title").textContent).toContain("确认方向");
    expect(screen.getByTestId("clarify-card-why-now").textContent).toContain("先确认关键分叉");
    expect(screen.getByTestId("clarify-card-question-scope").textContent).toContain(
      "优先哪条路线？",
    );
    expect(screen.getByTestId("clarify-card-question-mode-scope-single").textContent).toContain(
      "单选",
    );
    expect(screen.queryByTestId("clarify-card-question-risk")).toBeNull();
    fireEvent.click(screen.getByTestId("clarify-card-question-tab-2"));
    expect(screen.getByTestId("clarify-card-question-risk").textContent).toContain("风险边界？");
    fireEvent.click(screen.getByTestId("clarify-card-question-tab-3"));
    expect(
      screen.getByTestId("clarify-card-question-mode-evidence-multiple").textContent,
    ).toContain("多选");
    expect(screen.getByTestId("clarify-card-submit").getAttribute("aria-disabled")).toBe("true");
    expect(screen.queryByTestId("clarify-card-decide")).toBeNull();
    expect(screen.getByTestId("clarify-card-cancel").textContent).toContain("取消");
    expect(screen.getByPlaceholderText("可补说明也可以只写备注。")).toBeTruthy();
    expect(screen.queryByPlaceholderText("可补一句说明")).toBeNull();
  });

  it("submits selected choices and per-option notes as a typed payload", async () => {
    const onSubmit = vi.fn();
    render(<ClarifyDecisionCard card={card()} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByTestId("clarify-card-choice-scope-ship"));
    expect(screen.getByTestId("clarify-card-question-risk").textContent).toContain("风险边界？");
    expect(screen.getByTestId("clarify-card-submit").getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(screen.getByTestId("clarify-card-question-tab-1"));
    fireEvent.change(screen.getByTestId("clarify-card-choice-note-scope-ship"), {
      target: { value: "必须是真的上线" },
    });
    fireEvent.click(screen.getByTestId("clarify-card-question-tab-2"));
    fireEvent.change(screen.getByTestId("clarify-card-question-note-risk"), {
      target: { value: "风险优先保守" },
    });
    expect(screen.getByTestId("clarify-card-submit").getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(screen.getByTestId("clarify-card-question-tab-3"));
    fireEvent.click(screen.getByTestId("clarify-card-choice-evidence-tests"));
    fireEvent.click(screen.getByTestId("clarify-card-choice-evidence-bench"));
    fireEvent.click(screen.getByTestId("clarify-card-submit"));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({
      intent: "submit_choices",
      questionCardId: "clarify-card-1",
      delegatedNodeIds: [],
      rawAnswer: expect.stringContaining("必须是真的上线"),
      answers: [
        {
          nodeId: "scope",
          choiceIds: ["ship"],
          choiceNotes: { ship: "必须是真的上线" },
        },
        {
          nodeId: "risk",
          choiceIds: [],
          choiceNotes: {},
          note: "风险优先保守",
        },
        {
          nodeId: "evidence",
          choiceIds: ["tests", "bench"],
          choiceNotes: {},
        },
      ],
    });
  });

  it("replaces single-choice selections, keeps multi-choice selections, and submits recommendation immediately", async () => {
    const onSubmit = vi.fn();
    render(<ClarifyDecisionCard card={card()} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByTestId("clarify-card-choice-scope-ship"));
    fireEvent.click(screen.getByTestId("clarify-card-question-tab-1"));
    fireEvent.click(screen.getByTestId("clarify-card-choice-scope-demo"));
    fireEvent.click(screen.getByTestId("clarify-card-question-tab-1"));

    expect(screen.queryByTestId("clarify-card-choice-note-scope-ship")).toBeNull();
    expect(screen.getByTestId("clarify-card-choice-note-scope-demo")).toBeTruthy();

    fireEvent.click(screen.getByTestId("clarify-card-question-tab-3"));
    fireEvent.click(screen.getByTestId("clarify-card-choice-evidence-tests"));
    fireEvent.click(screen.getByTestId("clarify-card-choice-evidence-bench"));
    expect(screen.getByTestId("clarify-card-choice-note-evidence-tests")).toBeTruthy();
    expect(screen.getByTestId("clarify-card-choice-note-evidence-bench")).toBeTruthy();

    fireEvent.click(screen.getByTestId("clarify-card-question-tab-2"));
    fireEvent.click(screen.getByTestId("clarify-card-recommend"));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: "recommend",
        questionCardId: "clarify-card-1",
        delegatedNodeIds: ["risk"],
        rawAnswer: "你推荐",
        answers: [
          {
            nodeId: "risk",
            choiceIds: [],
            choiceNotes: {},
          },
        ],
      }),
    );
  });

  it("delegates only the active subtree and leaves sibling questions unanswered", async () => {
    const onSubmit = vi.fn();
    render(<ClarifyDecisionCard card={card()} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByTestId("clarify-card-question-tab-3"));
    fireEvent.click(screen.getByTestId("clarify-card-delegate-subtree"));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({
      intent: "delegate_subtree",
      questionCardId: "clarify-card-1",
      delegatedNodeIds: ["evidence"],
      rawAnswer: "此分支交给 Agent 决定",
      answers: [
        {
          nodeId: "evidence",
          choiceIds: [],
          choiceNotes: {},
        },
      ],
    });
  });

  it("renders submitted cards as readonly history", () => {
    render(
      <ClarifyDecisionCard
        card={card({ submitted: true, submittedSummary: "已按上线方向提交" })}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByTestId("clarify-card-readonly").textContent).toContain("已按上线方向提交");
    expect(screen.queryByTestId("clarify-card-submit")).toBeNull();
  });

  it("submits cancel as a pause answer without selecting a fallback choice", async () => {
    const onSubmit = vi.fn();
    render(<ClarifyDecisionCard card={card()} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByTestId("clarify-card-cancel"));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({
      intent: "stop",
      questionCardId: "clarify-card-1",
      delegatedNodeIds: [],
      rawAnswer: "暂停继续询问",
      answers: [
        {
          nodeId: "scope",
          choiceIds: [],
          choiceNotes: {},
        },
        {
          nodeId: "risk",
          choiceIds: [],
          choiceNotes: {},
        },
        {
          nodeId: "evidence",
          choiceIds: [],
          choiceNotes: {},
        },
      ],
    });
  });
});
