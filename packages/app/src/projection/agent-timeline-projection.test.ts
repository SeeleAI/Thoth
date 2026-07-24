import { describe, expect, it, vi } from "vitest";
import type { AgentTimelineEntry } from "@thoth/protocol/agent-types";
import type { FetchAgentTimelineResponseMessage } from "@thoth/protocol/messages";
import {
  AuthorityProjectionStore,
  DaemonProjectionService,
} from "@/projection/authority-projection";

type TimelinePage = FetchAgentTimelineResponseMessage["payload"];

function entry(seq: number, type: AgentTimelineEntry["item"]["type"] = "assistant_message") {
  const item: AgentTimelineEntry["item"] =
    type === "tool_call"
      ? {
          type,
          callId: "call-1",
          name: "shell",
          status: "completed",
          error: null,
          detail: { type: "shell", command: "echo ok", output: "ok", exitCode: 0 },
        }
      : type === "reasoning"
        ? { type, text: "thinking" }
        : { type: "assistant_message", text: String(seq), messageId: `assistant-${seq}` };
  return {
    provider: "codex" as const,
    item,
    timestamp: new Date(seq).toISOString(),
    seqStart: seq,
    seqEnd: seq,
    sourceSeqRanges: [{ startSeq: seq, endSeq: seq }],
    collapsed: [],
  } satisfies AgentTimelineEntry;
}

function page(overrides: Partial<TimelinePage> = {}): TimelinePage {
  return {
    requestId: "request",
    agentId: "agent",
    agent: null,
    direction: "tail",
    projection: "projected",
    epoch: "epoch-1",
    reset: false,
    staleCursor: false,
    gap: false,
    window: { minSeq: 1, maxSeq: 1, nextSeq: 2 },
    entries: [entry(1)],
    startCursor: { epoch: "epoch-1", seq: 1 },
    endCursor: { epoch: "epoch-1", seq: 1 },
    hasOlder: false,
    hasNewer: false,
    error: null,
    ...overrides,
  };
}

function client() {
  const listeners = new Map<string, (message: never) => void>();
  const fetchAgentTimeline = vi.fn(async () => page());
  return {
    api: {
      on: vi.fn((type: string, listener: (message: never) => void) => {
        listeners.set(type, listener);
        return () => listeners.delete(type);
      }),
      fetchAgentTimeline,
      subscribeAgentThothStateUpdates: vi.fn(() => () => {}),
    },
    emit(type: string, message: unknown) {
      listeners.get(type)?.(message as never);
    },
    fetchAgentTimeline,
  };
}

describe("AgentTimeline projection", () => {
  it("uses daemon entry timestamps and retains typed tool details", () => {
    const store = new AuthorityProjectionStore();
    const entries = [entry(1, "reasoning"), entry(2, "tool_call")];
    store.applyProjectionDelta("server", {
      type: "timeline_page",
      agentId: "agent",
      page: page({ entries }),
    });
    expect(store.getSnapshot("server").timelines.get("agent")?.entries).toEqual(entries);
  });

  it("replaces the complete window on reset and epoch change", () => {
    const store = new AuthorityProjectionStore();
    store.applyProjectionDelta("server", {
      type: "timeline_page",
      agentId: "agent",
      page: page({ entries: [entry(1), entry(2)] }),
    });
    store.applyProjectionDelta("server", {
      type: "timeline_page",
      agentId: "agent",
      page: page({ epoch: "epoch-2", reset: true, entries: [entry(9)] }),
    });
    expect(store.getSnapshot("server").timelines.get("agent")?.entries).toEqual([entry(9)]);
  });

  it("deduplicates overlapping projected source ranges", () => {
    const store = new AuthorityProjectionStore();
    store.applyProjectionDelta("server", {
      type: "timeline_page",
      agentId: "agent",
      page: page({ entries: [entry(1), entry(2)] }),
    });
    const replacement = { ...entry(2), seqEnd: 3, sourceSeqRanges: [{ startSeq: 2, endSeq: 3 }] };
    store.applyProjectionDelta("server", {
      type: "timeline_page",
      agentId: "agent",
      page: page({ direction: "after", entries: [replacement] }),
    });
    expect(
      store
        .getSnapshot("server")
        .timelines.get("agent")
        ?.entries.map((item) => [item.seqStart, item.seqEnd]),
    ).toEqual([
      [1, 1],
      [2, 3],
    ]);
  });

  it("turns live timeline events into one canonical catch-up request", async () => {
    vi.useFakeTimers();
    const transport = client();
    const service = new DaemonProjectionService(new AuthorityProjectionStore());
    service.start(transport.api as never, "server");
    transport.emit("agent_stream", {
      type: "agent_stream",
      payload: {
        agentId: "agent",
        internal: false,
        event: { type: "timeline", provider: "codex", item: { type: "reasoning", text: "a" } },
      },
    });
    transport.emit("agent_stream", {
      type: "agent_stream",
      payload: {
        agentId: "agent",
        internal: false,
        event: { type: "timeline", provider: "codex", item: { type: "reasoning", text: "ab" } },
      },
    });
    await vi.advanceTimersByTimeAsync(16);
    expect(transport.fetchAgentTimeline).toHaveBeenCalledTimes(1);
    expect(transport.fetchAgentTimeline).toHaveBeenCalledWith("agent", {
      direction: "tail",
      projection: "projected",
    });
    service.stop();
    vi.useRealTimers();
  });

  it("rejects a stale or gapped page and requests an authoritative tail", async () => {
    const transport = client();
    const store = new AuthorityProjectionStore();
    const service = new DaemonProjectionService(store);
    service.start(transport.api as never, "server");
    transport.emit("fetch_agent_timeline_response", {
      type: "fetch_agent_timeline_response",
      payload: page({ gap: true, entries: [entry(99)] }),
    });
    await Promise.resolve();
    expect(store.getSnapshot("server").timelines.get("agent")).toEqual(
      expect.objectContaining({
        entries: [],
        loadingTail: true,
      }),
    );
    expect(transport.fetchAgentTimeline).toHaveBeenCalledWith("agent", {
      direction: "tail",
      projection: "projected",
    });
    await vi.waitFor(() => {
      expect(store.getSnapshot("server").timelines.get("agent")?.loadingTail).toBe(false);
    });
    service.stop();
  });
});
