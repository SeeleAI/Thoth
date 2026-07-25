import { describe, expect, it, vi } from "vitest";
import type { ToolCallDetail } from "@thoth/protocol/agent-types";
import { timelineEntry } from "@/test-fixtures/timeline";
import {
  renderTimelineItem,
  timelineId,
  timelineItemViewRegistry,
  type TimelineRenderContext,
} from "./timeline-view-registry";

function renderContext(overrides: Partial<TimelineRenderContext> = {}): TimelineRenderContext {
  return {
    agentIsRunning: false,
    layout: {
      assistantSpacing: "default",
      isFirstInUserGroup: true,
      isLastInUserGroup: true,
      isLastInToolSequence: true,
    },
    renderPendingUser: () => null,
    renderUser: () => null,
    renderAssistant: () => null,
    renderReasoning: () => null,
    renderTool: () => null,
    renderClarify: () => null,
    renderTask: () => null,
    renderGoal: () => null,
    renderRegisteredTask: () => null,
    renderTodo: () => null,
    renderError: () => null,
    renderCompaction: () => null,
    ...overrides,
  };
}

describe("timelineItemViewRegistry", () => {
  it("covers every canonical Timeline kind", () => {
    expect(Object.keys(timelineItemViewRegistry).sort()).toEqual([
      "assistant_message",
      "clarify_card",
      "compaction",
      "error",
      "goal_card",
      "reasoning",
      "registered_task",
      "task_card",
      "todo",
      "tool_call",
      "user_message",
    ]);
  });

  it("preserves tool lifecycle fields without normalization", () => {
    const detail: ToolCallDetail = {
      type: "shell",
      command: "npm test",
      output: "ok",
      exitCode: 0,
    };
    const entry = timelineEntry(
      {
        type: "tool_call",
        callId: "call-1",
        name: "shell",
        status: "completed",
        error: null,
        detail,
        metadata: { phase: "review" },
      },
      1,
    );
    const renderTool = vi.fn(() => null);

    renderTimelineItem(entry, renderContext({ renderTool }));

    expect(timelineId(entry)).toBe("call-1");
    expect(renderTool).toHaveBeenCalledWith(
      entry,
      expect.objectContaining({ assistantSpacing: "default" }),
    );
  });

  it("passes live state only to the selected reasoning renderer", () => {
    const entry = timelineEntry({ type: "reasoning", text: "thinking" }, 1);
    const renderReasoning = vi.fn(() => null);

    renderTimelineItem(entry, renderContext({ agentIsRunning: true, renderReasoning }));

    expect(renderReasoning).toHaveBeenCalledWith(
      entry,
      true,
      expect.objectContaining({ isLastInToolSequence: true }),
    );
  });
});
