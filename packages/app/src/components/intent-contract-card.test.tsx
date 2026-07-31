/**
 * @vitest-environment jsdom
 */
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThothIntentContractCardModel } from "@thoth/protocol/thoth/rpc-schemas";
import { IntentContractCard } from "./intent-contract-card";

const { theme } = vi.hoisted(() => ({
  theme: {
    spacing: { 1: 4, 2: 8, 3: 12, 4: 16 },
    borderWidth: { 1: 1 },
    borderRadius: { md: 6, lg: 8 },
    fontSize: { xs: 11, sm: 13, base: 15 },
    fontWeight: { semibold: "600" },
    colors: {
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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function intentContractCard(
  overrides: Partial<ThothIntentContractCardModel> = {},
): ThothIntentContractCardModel {
  const now = "2026-07-30T00:00:00.000Z";
  return {
    id: "contract-card-1",
    sessionId: "clarify-session-1",
    provenanceSummary: "来自 Decision Map 与 Workspace evidence。",
    turnControls: {
      mode: "loop",
      clarifyStrength: "balanced",
      loop: "run_until_stopped",
    },
    submitted: false,
    contract: {
      id: "contract-1",
      workspaceId: "workspace-1",
      sourceAgentId: "agent-1",
      taskId: null,
      title: "发布可靠的桌面版本",
      objective: "修复回归并发布可验证的桌面版本。",
      nonGoals: ["不发布移动端"],
      invariants: ["不触碰 main"],
      acceptanceClaims: [
        {
          id: "claim-1",
          statement: "三个桌面平台构建通过。",
          status: "open",
          evidenceRefs: [],
          revision: 1,
        },
      ],
      riskBoundary: ["Release 失败时保留旧版本"],
      humanDecisionRefs: ["decision-1"],
      escalationPolicy: { returnToHumanWhen: ["边界改变"], finalConfirmation: "required" },
      status: "proposed",
      revision: 1,
      confirmedAt: null,
      createdAt: now,
      updatedAt: now,
    },
    ...overrides,
  };
}

describe("IntentContractCard", () => {
  it("renders one contract and uses the frozen Loop path", async () => {
    const onSubmit = vi.fn();
    render(<IntentContractCard card={intentContractCard()} onSubmit={onSubmit} />);

    expect(screen.getByText("修复回归并发布可验证的桌面版本。")).toBeTruthy();
    expect(screen.getByText("三个桌面平台构建通过。")).toBeTruthy();
    fireEvent.click(screen.getByTestId("thoth-intent-contract-accept-loop"));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({
      intent: "accept_loop",
      cardId: "contract-card-1",
      rawAnswer: "确认意图合同并注册 Loop",
    });
  });

  it("uses the frozen Quick path and submits revision notes", async () => {
    const onSubmit = vi.fn();
    render(
      <IntentContractCard
        card={intentContractCard({
          turnControls: { mode: "quick", clarifyStrength: "light", loop: null },
        })}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.queryByTestId("thoth-intent-contract-accept-loop")).toBeNull();
    fireEvent.change(screen.getByTestId("thoth-intent-contract-note"), {
      target: { value: "验收还要包含公开下载校验" },
    });
    fireEvent.click(screen.getByTestId("thoth-intent-contract-annotate"));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({
      intent: "annotate",
      cardId: "contract-card-1",
      note: "验收还要包含公开下载校验",
      rawAnswer: "验收还要包含公开下载校验",
    });
  });
});
