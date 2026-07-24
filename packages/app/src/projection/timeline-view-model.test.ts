import { describe, expect, it } from "vitest";
import type {
  AgentTimelineEntry,
  AgentTimelineItem,
  ToolCallDetail,
} from "@thoth/protocol/agent-types";
import { createTimelineViewModels, timelineViewRegistry } from "./timeline-view-model";

function entry(item: AgentTimelineItem, seq = 1): AgentTimelineEntry {
  return {
    provider: "codex",
    item,
    timestamp: "2026-07-24T00:00:00.000Z",
    seqStart: seq,
    seqEnd: seq,
    sourceSeqRanges: [{ startSeq: seq, endSeq: seq }],
    collapsed: [],
  };
}

describe("timelineViewRegistry", () => {
  it("covers every canonical Timeline kind", () => {
    expect(Object.keys(timelineViewRegistry).sort()).toEqual([
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
    const [model] = createTimelineViewModels(
      [
        entry({
          type: "tool_call",
          callId: "call-1",
          name: "shell",
          status: "completed",
          error: null,
          detail,
          metadata: { phase: "review" },
        }),
      ],
      { agentIsRunning: false },
    );
    expect(model).toMatchObject({
      kind: "tool_call",
      id: "call-1",
      payload: {
        source: "agent",
        data: {
          callId: "call-1",
          name: "shell",
          status: "completed",
          error: null,
          detail,
          metadata: { phase: "review" },
        },
      },
    });
  });

  it("derives loading only for the live final reasoning entry", () => {
    const models = createTimelineViewModels([entry({ type: "reasoning", text: "thinking" })], {
      agentIsRunning: true,
    });
    expect(models[0]).toMatchObject({ kind: "thought", status: "loading" });
  });
});
