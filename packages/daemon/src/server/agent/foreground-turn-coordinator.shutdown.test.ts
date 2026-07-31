import { afterEach, describe, expect, it, vi } from "vitest";
import { ForegroundTurnCoordinator } from "./foreground-turn-coordinator.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("ForegroundTurnCoordinator shutdown", () => {
  it("fences Quick heartbeats, deferred continuations, and runtime bindings", () => {
    vi.useFakeTimers();
    const heartbeatTick = vi.fn();
    const retryTick = vi.fn();
    const heartbeat = setInterval(heartbeatTick, 10_000);
    const retryTimer = setTimeout(retryTick, 1_000);
    const unregisterRuntime = vi.fn();
    const unsubscribe = vi.fn();
    const endForegroundTurn = vi.fn();
    const coordinator = Object.create(
      ForegroundTurnCoordinator.prototype,
    ) as ForegroundTurnCoordinator;
    const runtime = coordinator as unknown as {
      activeRunTokens: Map<string, string>;
      deferredRunTokens: Map<string, string>;
      queueDrains: Set<string>;
      activeQuickExecutions: Map<string, unknown>;
      activeQuickWaits: Map<string, unknown>;
      options: { toolGateway: { endForegroundTurn: typeof endForegroundTurn } };
    };
    runtime.activeRunTokens = new Map([["agent-1", "run-token"]]);
    runtime.deferredRunTokens = new Map([["agent-1", "deferred-token"]]);
    runtime.queueDrains = new Set(["agent-1"]);
    runtime.activeQuickExecutions = new Map([
      [
        "agent-1",
        {
          generation: "generation-1",
          heartbeat,
          unregisterRuntime,
        },
      ],
    ]);
    runtime.activeQuickWaits = new Map([["agent-2", { unsubscribe, retryTimer }]]);
    runtime.options = { toolGateway: { endForegroundTurn } };

    coordinator.close();
    vi.advanceTimersByTime(20_000);

    expect(heartbeatTick).not.toHaveBeenCalled();
    expect(retryTick).not.toHaveBeenCalled();
    expect(unregisterRuntime).toHaveBeenCalledOnce();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(endForegroundTurn).toHaveBeenCalledWith({
      agentId: "agent-1",
      generation: "generation-1",
    });
    expect(runtime.activeRunTokens.size).toBe(0);
    expect(runtime.deferredRunTokens.size).toBe(0);
    expect(runtime.queueDrains.size).toBe(0);
    expect(runtime.activeQuickExecutions.size).toBe(0);
    expect(runtime.activeQuickWaits.size).toBe(0);
  });
});
