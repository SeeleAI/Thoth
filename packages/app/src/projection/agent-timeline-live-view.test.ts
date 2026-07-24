import { describe, expect, it } from "vitest";
import type { AgentTimelineEntry } from "@thoth/protocol/agent-types";
import { createTimelineViewModels } from "@/projection/timeline-view-model";

function entry(item: AgentTimelineEntry["item"], seq: number): AgentTimelineEntry {
  return {
    provider: "codex",
    item,
    timestamp: new Date(seq).toISOString(),
    seqStart: seq,
    seqEnd: seq,
    sourceSeqRanges: [{ startSeq: seq, endSeq: seq }],
    collapsed: [],
  };
}

describe("AgentTimeline live ViewModel", () => {
  it("marks only the final running reasoning item as loading", () => {
    const models = createTimelineViewModels(
      [
        entry({ type: "reasoning", text: "first" }, 1),
        entry({ type: "reasoning", text: "last" }, 2),
      ],
      { agentIsRunning: true },
    );
    expect(models.map((model) => (model.kind === "thought" ? model.status : null))).toEqual([
      "ready",
      "loading",
    ]);
  });

  it("keeps a completed reasoning tail ready", () => {
    const [model] = createTimelineViewModels([entry({ type: "reasoning", text: "done" }, 1)], {
      agentIsRunning: false,
    });
    expect(model).toMatchObject({ kind: "thought", status: "ready", text: "done" });
  });
});
