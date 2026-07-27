import { describe, expect, it } from "vitest";
import { InMemoryAgentTimelineStore } from "./agent-timeline-store.js";

describe("InMemoryAgentTimelineStore", () => {
  it("normalizes legacy limit zero to a bounded page while retaining an explicit internal full read", () => {
    const store = new InMemoryAgentTimelineStore();
    store.initialize("agent-bounded", {
      epoch: "epoch-bounded",
      rows: Array.from({ length: 250 }, (_, index) => ({
        seq: index + 1,
        timestamp: `2026-01-01T00:00:${String(index % 60).padStart(2, "0")}.000Z`,
        item: { type: "assistant_message" as const, text: String(index + 1) },
      })),
    });

    const publicPage = store.fetch("agent-bounded", { direction: "tail", limit: 0 });
    expect(publicPage.rows).toHaveLength(200);
    expect(publicPage.rows[0]?.seq).toBe(51);
    expect(publicPage.hasOlder).toBe(true);

    const internalHistory = store.fetchAll("agent-bounded", { direction: "tail" });
    expect(internalHistory.rows).toHaveLength(250);
    expect(internalHistory.rows[0]?.seq).toBe(1);
    expect(internalHistory.hasOlder).toBe(false);
  });

  it("returns a bounded reset window when an after cursor is behind retained history", () => {
    const store = new InMemoryAgentTimelineStore();
    store.initialize("agent-1", {
      epoch: "epoch-1",
      nextSeq: 8,
      rows: [
        {
          seq: 5,
          timestamp: "2026-01-01T00:00:00.000Z",
          item: { type: "assistant_message", text: "five" },
        },
        {
          seq: 6,
          timestamp: "2026-01-01T00:00:01.000Z",
          item: { type: "assistant_message", text: "six" },
        },
        {
          seq: 7,
          timestamp: "2026-01-01T00:00:02.000Z",
          item: { type: "assistant_message", text: "seven" },
        },
      ],
    });

    const result = store.fetch("agent-1", {
      direction: "after",
      cursor: { epoch: "epoch-1", seq: 1 },
      limit: 1,
    });

    expect(result).toEqual({
      epoch: "epoch-1",
      direction: "after",
      reset: true,
      staleCursor: false,
      gap: true,
      window: { minSeq: 5, maxSeq: 7, nextSeq: 8 },
      hasOlder: true,
      hasNewer: false,
      rows: [
        {
          seq: 7,
          timestamp: "2026-01-01T00:00:02.000Z",
          item: { type: "assistant_message", text: "seven" },
        },
      ],
    });
  });
});
