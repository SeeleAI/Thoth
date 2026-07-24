import { describe, expect, it, vi } from "vitest";
import type { AgentTimelineEntry } from "@thoth/protocol/agent-types";
import type { FetchAgentTimelineResponseMessage } from "@thoth/protocol/messages";
import { AuthorityProjectionStore } from "./authority-projection";

type TimelinePage = FetchAgentTimelineResponseMessage["payload"];

function entry(seqStart: number, seqEnd = seqStart, text = String(seqStart)): AgentTimelineEntry {
  return {
    provider: "codex",
    item: { type: "assistant_message", text },
    timestamp: new Date(seqStart).toISOString(),
    seqStart,
    seqEnd,
    sourceSeqRanges: [{ startSeq: seqStart, endSeq: seqEnd }],
    collapsed: seqEnd > seqStart ? ["assistant_merge"] : [],
  };
}

function page(input: Partial<TimelinePage> & Pick<TimelinePage, "entries">): TimelinePage {
  return {
    requestId: "req",
    agentId: "agent",
    agent: null,
    direction: "tail",
    projection: "projected",
    epoch: "epoch-1",
    reset: false,
    staleCursor: false,
    gap: false,
    window: { minSeq: 1, maxSeq: 1, nextSeq: 2 },
    startCursor: { epoch: "epoch-1", seq: 1 },
    endCursor: { epoch: "epoch-1", seq: 1 },
    hasOlder: false,
    hasNewer: false,
    error: null,
    ...input,
  };
}

describe("AuthorityProjectionStore", () => {
  it("replaces a tail snapshot and notifies subscribers", () => {
    const store = new AuthorityProjectionStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.applyProjectionDelta("server", {
      type: "timeline_page",
      agentId: "agent",
      page: page({ entries: [entry(1)] }),
    });
    expect(store.getSnapshot("server").timelines.get("agent")?.entries).toEqual([entry(1)]);
    expect(listener).toHaveBeenCalledOnce();
  });

  it("merges older and newer pages without duplicating source sequences", () => {
    const store = new AuthorityProjectionStore();
    store.applyProjectionDelta("server", {
      type: "timeline_page",
      agentId: "agent",
      page: page({ entries: [entry(2), entry(3)] }),
    });
    store.applyProjectionDelta("server", {
      type: "timeline_page",
      agentId: "agent",
      page: page({ direction: "before", entries: [entry(1)] }),
    });
    store.applyProjectionDelta("server", {
      type: "timeline_page",
      agentId: "agent",
      page: page({ direction: "after", entries: [entry(3, 4, "merged")] }),
    });
    expect(
      store
        .getSnapshot("server")
        .timelines.get("agent")
        ?.entries.map(({ seqStart, seqEnd }) => [seqStart, seqEnd]),
    ).toEqual([
      [1, 1],
      [2, 2],
      [3, 4],
    ]);
  });

  it("expands only the cursor edge owned by each page direction", () => {
    const store = new AuthorityProjectionStore();
    store.applyProjectionDelta("server", {
      type: "timeline_page",
      agentId: "agent",
      page: page({
        entries: [entry(5)],
        startCursor: { epoch: "epoch-1", seq: 5 },
        endCursor: { epoch: "epoch-1", seq: 5 },
        hasOlder: true,
        hasNewer: true,
      }),
    });
    store.applyProjectionDelta("server", {
      type: "timeline_page",
      agentId: "agent",
      page: page({
        direction: "before",
        entries: [entry(1)],
        startCursor: { epoch: "epoch-1", seq: 1 },
        endCursor: { epoch: "epoch-1", seq: 1 },
        hasOlder: false,
        hasNewer: false,
      }),
    });
    let timeline = store.getSnapshot("server").timelines.get("agent");
    expect(timeline).toMatchObject({
      startCursor: { epoch: "epoch-1", seq: 1 },
      endCursor: { epoch: "epoch-1", seq: 5 },
      hasOlder: false,
      hasNewer: true,
    });
    store.applyProjectionDelta("server", {
      type: "timeline_page",
      agentId: "agent",
      page: page({
        direction: "after",
        entries: [entry(9)],
        startCursor: { epoch: "epoch-1", seq: 9 },
        endCursor: { epoch: "epoch-1", seq: 9 },
        hasOlder: true,
        hasNewer: false,
      }),
    });
    timeline = store.getSnapshot("server").timelines.get("agent");
    expect(timeline).toMatchObject({
      startCursor: { epoch: "epoch-1", seq: 1 },
      endCursor: { epoch: "epoch-1", seq: 9 },
      hasOlder: false,
      hasNewer: false,
    });
  });

  it("atomically replaces entries when the authority epoch changes", () => {
    const store = new AuthorityProjectionStore();
    store.applyProjectionDelta("server", {
      type: "timeline_page",
      agentId: "agent",
      page: page({ entries: [entry(1)] }),
    });
    store.applyProjectionDelta("server", {
      type: "timeline_page",
      agentId: "agent",
      page: page({ epoch: "epoch-2", direction: "after", entries: [entry(9)] }),
    });
    const timeline = store.getSnapshot("server").timelines.get("agent");
    expect(timeline?.epoch).toBe("epoch-2");
    expect(timeline?.entries).toEqual([entry(9)]);
  });
});
