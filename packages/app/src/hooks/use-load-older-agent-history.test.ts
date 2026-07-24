import { describe, expect, it, vi } from "vitest";
import type { DaemonClient } from "@thoth/client";
import type { FetchAgentTimelineResponseMessage } from "@thoth/protocol/messages";
import {
  AuthorityProjectionStore,
  DaemonProjectionService,
} from "@/projection/authority-projection";

type TimelinePage = FetchAgentTimelineResponseMessage["payload"];

function page(input: Partial<TimelinePage> = {}): TimelinePage {
  return {
    requestId: "req",
    agentId: "agent-1",
    agent: null,
    direction: "tail",
    projection: "projected",
    epoch: "epoch-1",
    reset: false,
    staleCursor: false,
    gap: false,
    window: { minSeq: 10, maxSeq: 20, nextSeq: 21 },
    startCursor: { epoch: "epoch-1", seq: 10 },
    endCursor: { epoch: "epoch-1", seq: 20 },
    hasOlder: true,
    hasNewer: false,
    entries: [],
    error: null,
    ...input,
  };
}

function client(fetchAgentTimeline = vi.fn(async () => page())): DaemonClient {
  return {
    on: vi.fn(() => () => {}),
    subscribeAgentThothStateUpdates: vi.fn(() => () => {}),
    fetchAgentTimeline,
  } as unknown as DaemonClient;
}

describe("DaemonProjectionService.fetchOlder", () => {
  it("no-ops without a cursor or older history", async () => {
    const store = new AuthorityProjectionStore();
    const fetchAgentTimeline = vi.fn(async () => page());
    const service = new DaemonProjectionService(store);
    service.start(client(fetchAgentTimeline), "server");
    await service.fetchOlder("agent-1");
    expect(fetchAgentTimeline).not.toHaveBeenCalled();
  });

  it("requests the page before the authority start cursor", async () => {
    const store = new AuthorityProjectionStore();
    store.applyProjectionDelta("server", {
      type: "timeline_page",
      agentId: "agent-1",
      page: page(),
    });
    const fetchAgentTimeline = vi.fn(async () => page({ direction: "before" }));
    const service = new DaemonProjectionService(store);
    service.start(client(fetchAgentTimeline), "server");
    await service.fetchOlder("agent-1");
    expect(fetchAgentTimeline).toHaveBeenCalledWith("agent-1", {
      direction: "before",
      cursor: { epoch: "epoch-1", seq: 10 },
      limit: 100,
      projection: "projected",
    });
    expect(store.getSnapshot("server").timelines.get("agent-1")?.loadingOlder).toBe(false);
  });

  it("propagates failure and always clears loading state", async () => {
    const store = new AuthorityProjectionStore();
    store.applyProjectionDelta("server", {
      type: "timeline_page",
      agentId: "agent-1",
      page: page(),
    });
    const error = new Error("network");
    const service = new DaemonProjectionService(store);
    service.start(
      client(
        vi.fn(async () => {
          throw error;
        }),
      ),
      "server",
    );
    await expect(service.fetchOlder("agent-1")).rejects.toBe(error);
    expect(store.getSnapshot("server").timelines.get("agent-1")?.loadingOlder).toBe(false);
  });
});
