import { describe, expect, it } from "vitest";
import { timelineEntry } from "@/test-fixtures/timeline";

describe("AgentTimeline live rendering", () => {
  it("keeps canonical reasoning entries unchanged while the view selects the live tail", () => {
    const entries = [
      timelineEntry({ type: "reasoning", text: "first" }, 1),
      timelineEntry({ type: "reasoning", text: "last" }, 2),
    ];
    const selectedLiveIds = entries
      .filter((entry, index) => index === entries.length - 1 && entry.item.type === "reasoning")
      .map((entry) => entry.seqStart);

    expect(selectedLiveIds).toEqual([2]);
    expect(entries.map((entry) => entry.item)).toEqual([
      { type: "reasoning", text: "first" },
      { type: "reasoning", text: "last" },
    ]);
  });

  it("keeps a completed reasoning tail as protocol-owned content", () => {
    const entry = timelineEntry({ type: "reasoning", text: "done" }, 1);
    expect(entry.item).toEqual({ type: "reasoning", text: "done" });
  });
});
