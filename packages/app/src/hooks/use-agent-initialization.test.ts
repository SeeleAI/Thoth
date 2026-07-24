import { afterEach, describe, expect, it, vi } from "vitest";
import { TIMELINE_FETCH_PAGE_SIZE } from "@/timeline/timeline-fetch-policy";
import { getInitDeferred, getInitKey, resolveInitDeferred } from "@/utils/agent-initialization";
import {
  createSetAgentInitializing,
  ensureAgentIsInitialized,
  refreshAgentInitializationTimeout,
  refreshAgent,
} from "./use-agent-initialization";

const serverId = "server-1";
const agentId = "agent-1";
const loading = new Map<string, boolean>();

interface FakeDaemonClient {
  fetchAgentTimeline: ReturnType<typeof vi.fn>;
  refreshAgent: ReturnType<typeof vi.fn>;
}

function makeClient(): FakeDaemonClient {
  return {
    fetchAgentTimeline: vi.fn().mockResolvedValue(undefined),
    refreshAgent: vi.fn().mockResolvedValue(undefined),
  };
}

function bindSetAgentInitializing() {
  return createSetAgentInitializing(() => ({
    setAgentTimelineLoading: (id: string, value: boolean) => loading.set(id, value),
  }));
}

afterEach(() => {
  resolveInitDeferred(getInitKey(serverId, agentId));
  loading.clear();
  vi.restoreAllMocks();
});

describe("ensureAgentIsInitialized", () => {
  it("requests bounded projected catch-up after the current cursor when authoritative history is loaded", () => {
    const client = makeClient();
    void ensureAgentIsInitialized({
      serverId,
      agentId,
      client: client as never,
      setAgentInitializing: bindSetAgentInitializing(),
      timeline: {
        epoch: "epoch-1",
        entries: [],
        startCursor: { epoch: "epoch-1", seq: 1 },
        endCursor: { epoch: "epoch-1", seq: 42 },
        hasOlder: false,
        hasNewer: false,
        loadingTail: false,
        loadingOlder: false,
      },
    });

    expect(client.fetchAgentTimeline).toHaveBeenCalledWith(agentId, {
      direction: "after",
      cursor: { epoch: "epoch-1", seq: 42 },
      limit: TIMELINE_FETCH_PAGE_SIZE,
      projection: "projected",
    });
    expect(getInitDeferred(getInitKey(serverId, agentId))?.requestDirection).toBe("after");
  });

  it("requests a bounded projected tail when no authoritative cursor is available", () => {
    const client = makeClient();

    void ensureAgentIsInitialized({
      serverId,
      agentId,
      client: client as never,
      setAgentInitializing: bindSetAgentInitializing(),
    });

    expect(client.fetchAgentTimeline).toHaveBeenCalledWith(agentId, {
      direction: "tail",
      limit: TIMELINE_FETCH_PAGE_SIZE,
      projection: "projected",
    });
    expect(getInitDeferred(getInitKey(serverId, agentId))?.requestDirection).toBe("tail");
  });

  it("times out initialization after 65 seconds", async () => {
    vi.useFakeTimers();
    const client = makeClient();

    const promise = ensureAgentIsInitialized({
      serverId,
      agentId,
      client: client as never,
      setAgentInitializing: bindSetAgentInitializing(),
    });

    vi.advanceTimersByTime(64_999);
    expect(getInitDeferred(getInitKey(serverId, agentId))).toBeDefined();

    vi.advanceTimersByTime(1);

    await expect(promise).rejects.toThrow("History sync timed out after 65s");
    expect(getInitDeferred(getInitKey(serverId, agentId))).toBeUndefined();
    expect(loading.get(agentId)).toBe(false);
    vi.useRealTimers();
  });

  it("refreshes the initialization timeout after paged catch-up progress", async () => {
    vi.useFakeTimers();
    const client = makeClient();
    const setAgentInitializing = bindSetAgentInitializing();
    const key = getInitKey(serverId, agentId);

    const promise = ensureAgentIsInitialized({
      serverId,
      agentId,
      client: client as never,
      setAgentInitializing,
    });

    vi.advanceTimersByTime(64_999);
    refreshAgentInitializationTimeout({ key, agentId, setAgentInitializing });

    vi.advanceTimersByTime(1);
    expect(getInitDeferred(key)).toBeDefined();

    const rejection = expect(promise).rejects.toThrow("History sync timed out after 65s");

    vi.advanceTimersByTime(64_998);
    expect(getInitDeferred(key)).toBeDefined();

    vi.advanceTimersByTime(1);

    await rejection;
    expect(getInitDeferred(key)).toBeUndefined();
    vi.useRealTimers();
  });
});

describe("refreshAgent", () => {
  it("fetches a bounded projected tail after refreshing the agent", async () => {
    const client = makeClient();

    await refreshAgent({
      agentId,
      client: client as never,
      setAgentInitializing: bindSetAgentInitializing(),
    });

    expect(client.refreshAgent).toHaveBeenCalledWith(agentId);
    expect(client.fetchAgentTimeline).toHaveBeenCalledWith(agentId, {
      direction: "tail",
      limit: TIMELINE_FETCH_PAGE_SIZE,
      projection: "projected",
    });
  });
});
