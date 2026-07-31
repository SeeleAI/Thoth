import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceTaskOrchestrator } from "./task-orchestrator.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("WorkspaceTaskOrchestrator shutdown", () => {
  it("fences pending schedules and clears every active phase callback before authority closes", async () => {
    vi.useFakeTimers();
    const heartbeatTick = vi.fn();
    const heartbeat = setInterval(heartbeatTick, 10_000);
    const approvalClear = vi.fn();
    const cancelExecution = vi.fn();
    const unsubscribeEvents = vi.fn();
    const unbindGateway = vi.fn();
    const unregisterRuntime = vi.fn();
    const runtimeClear = vi.fn();
    const forWorkspace = vi.fn(() => {
      throw new Error("A closed scheduler must not reopen Workspace authority");
    });
    const orchestrator = Object.create(
      WorkspaceTaskOrchestrator.prototype,
    ) as WorkspaceTaskOrchestrator;
    const runtime = orchestrator as unknown as {
      closed: boolean;
      approvalController: { clear: typeof approvalClear; cancelExecution: typeof cancelExecution };
      activeByExecution: Map<string, unknown>;
      activeByWorkspace: Map<string, unknown>;
      workspaceTails: Map<string, Promise<void>>;
      coordinator: { runtimes: { clear: typeof runtimeClear } };
      authority: { forWorkspace: typeof forWorkspace };
    };
    const active = {
      executionId: "execution-1",
      workspaceId: "workspace-1",
      heartbeat,
      unsubscribeEvents,
      unbindGateway,
      unregisterRuntime,
    };
    runtime.closed = false;
    runtime.approvalController = { clear: approvalClear, cancelExecution };
    runtime.activeByExecution = new Map([["execution-1", active]]);
    runtime.activeByWorkspace = new Map([["workspace-1", active]]);
    runtime.workspaceTails = new Map([["workspace-1", Promise.resolve()]]);
    runtime.coordinator = { runtimes: { clear: runtimeClear } };
    runtime.authority = { forWorkspace };

    orchestrator.close();
    await orchestrator.scheduleTask({ workspaceId: "workspace-1", taskId: "task-1" });
    vi.advanceTimersByTime(20_000);

    expect(approvalClear).toHaveBeenCalledOnce();
    expect(cancelExecution).toHaveBeenCalledWith("execution-1");
    expect(unsubscribeEvents).toHaveBeenCalledOnce();
    expect(unbindGateway).toHaveBeenCalledOnce();
    expect(unregisterRuntime).toHaveBeenCalledOnce();
    expect(runtimeClear).toHaveBeenCalledOnce();
    expect(heartbeatTick).not.toHaveBeenCalled();
    expect(runtime.activeByExecution.size).toBe(0);
    expect(runtime.activeByWorkspace.size).toBe(0);
    expect(runtime.workspaceTails.size).toBe(0);
    expect(forWorkspace).not.toHaveBeenCalled();
  });
});
