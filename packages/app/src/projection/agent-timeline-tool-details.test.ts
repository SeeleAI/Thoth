import { describe, expect, it } from "vitest";
import type { AgentTimelineEntry, ToolCallDetail } from "@thoth/protocol/agent-types";
import { createTimelineViewModels } from "@/projection/timeline-view-model";

const details: ToolCallDetail[] = [
  { type: "shell", command: "pwd", output: "/tmp", exitCode: 0 },
  { type: "read", filePath: "a.ts", content: "a" },
  { type: "edit", filePath: "a.ts", unifiedDiff: "+a" },
  { type: "write", filePath: "a.ts", content: "a" },
  { type: "search", query: "a", content: "a.ts" },
  { type: "fetch", url: "https://example.test", result: "ok" },
  {
    type: "worktree_setup",
    worktreePath: "/tmp/w",
    branchName: "feature",
    log: "ready",
    commands: [],
  },
  { type: "sub_agent", description: "review", log: "done" },
  { type: "plain_text", text: "note" },
  { type: "plan", text: "ship" },
  { type: "unknown", input: { safe: true }, output: null },
];

describe("AgentTimeline harness tool details", () => {
  it("preserves every protocol-owned tool detail without reinterpretation", () => {
    for (const [index, detail] of details.entries()) {
      const entry: AgentTimelineEntry = {
        provider: "claude",
        item: {
          type: "tool_call",
          callId: `call-${index}`,
          name: detail.type,
          status: "completed",
          error: null,
          detail,
          metadata: { index },
        },
        timestamp: new Date(index).toISOString(),
        seqStart: index,
        seqEnd: index,
        sourceSeqRanges: [{ startSeq: index, endSeq: index }],
        collapsed: [],
      };
      const [model] = createTimelineViewModels([entry], { agentIsRunning: false });
      expect(model).toMatchObject({
        kind: "tool_call",
        payload: { source: "agent", data: { detail, metadata: { index } } },
      });
    }
  });
});
