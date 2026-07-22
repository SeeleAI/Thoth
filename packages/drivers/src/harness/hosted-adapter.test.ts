import { describe, expect, it, vi } from "vitest";
import { defineHarnessCapabilities } from "./capabilities.js";
import { HostedHarnessAdapter, type HarnessAdapterHost } from "./hosted-adapter.js";
import type {
  HarnessExecutionDescriptor,
  HarnessExecutionEvent,
  HarnessExecutionInput,
  HarnessThreadDescriptor,
} from "./types.js";

const THREAD: HarnessThreadDescriptor = {
  id: "thread-1",
  adapterId: "fixture",
  nativeHandle: "native-thread-1",
};

function createHost() {
  const subscribers = new Map<string, (event: HarnessExecutionEvent) => void>();
  const modeCalls: Array<"default" | "plan"> = [];
  const resolveApproval = vi.fn(async () => ({ followUpPrompt: null }));
  const host: HarnessAdapterHost = {
    createThread: vi.fn(async () => THREAD),
    resumeThread: vi.fn(async () => THREAD),
    attachRuntimeBundle: vi.fn(async () => ({
      id: "attachment-1",
      adapterId: "fixture",
      threadId: THREAD.id,
      bundleId: "thoth.loop",
      bundleDigest: `sha256:${"a".repeat(64)}`,
      instructionAttachment: "system",
      toolAttachment: "native",
      attachedAt: "2026-07-22T00:00:00.000Z",
    })),
    prepareRunMode: vi.fn(async (_adapterId, input) => {
      modeCalls.push(input.mode);
      return {
        id: `mode-${input.mode}-${modeCalls.length}`,
        requestedMode: input.mode,
        status: "applied" as const,
        nativeModeId: input.mode === "plan" ? "native-plan" : "native-default",
        reason: null,
        appliedAt: "2026-07-22T00:00:00.000Z",
      };
    }),
    startExecution: vi.fn(async (_adapterId, input) => ({
      id: input.execution.executionId,
      threadId: input.thread.id,
      nativeTurnId: "native-turn-1",
    })),
    continueExecution: vi.fn(async (_adapterId, input) => ({
      id: input.execution.executionId,
      threadId: input.thread.id,
      nativeTurnId: "native-turn-2",
    })),
    resolveApproval,
    interruptExecution: vi.fn(async () => undefined),
    subscribeEvents: vi.fn((_adapterId, execution, callback) => {
      subscribers.set(execution.id, callback);
      return () => subscribers.delete(execution.id);
    }),
    describePersistence: vi.fn(async () => null),
    archiveThread: vi.fn(async () => undefined),
    deleteOwnedThread: vi.fn(async () => undefined),
    inspectLegacyThread: vi.fn(async () => ({
      resumable: false,
      nativeHandle: null,
      metadata: {},
    })),
    adoptNativeThread: vi.fn(async () => null),
    verifyResume: vi.fn(async () => true),
  };
  return {
    host,
    modeCalls,
    resolveApproval,
    emit(executionId: string, event: HarnessExecutionEvent) {
      const subscriber = subscribers.get(executionId);
      if (!subscriber) throw new Error(`Execution ${executionId} has no subscriber`);
      subscriber(event);
    },
  };
}

function executionInput(runMode: "default" | "plan"): HarnessExecutionInput {
  return {
    executionId: "execution-1",
    generation: "generation-1",
    prompt: "Execute the approved task.",
    attachment: null,
    runMode,
    runModeReceipt: {
      id: `mode-${runMode}`,
      requestedMode: runMode,
      status: "applied",
      nativeModeId: runMode,
      reason: null,
      appliedAt: "2026-07-22T00:00:00.000Z",
    },
  };
}

function event(id: string, payload: unknown): HarnessExecutionEvent {
  return {
    id,
    executionId: "execution-1",
    nativeCursor: id,
    occurredAt: "2026-07-22T00:00:00.000Z",
    payload,
  };
}

describe("HostedHarnessAdapter provider control", () => {
  it("turns a native Plan terminal into one Implement approval and resumes default mode", async () => {
    const fixture = createHost();
    const adapter = new HostedHarnessAdapter(
      "fixture",
      defineHarnessCapabilities({ toolAttachment: ["native"], plan: { kind: "native" } }),
      fixture.host,
    );
    const descriptor = await adapter.startExecution({
      thread: THREAD,
      execution: executionInput("plan"),
    });
    const received: HarnessExecutionEvent[] = [];
    adapter.subscribeEvents(descriptor, (next) => received.push(next));

    fixture.emit(
      descriptor.id,
      event("1", {
        type: "timeline",
        item: { type: "assistant_message", text: "1. Inspect reality\n2. Implement and verify" },
      }),
    );
    fixture.emit(descriptor.id, event("2", { type: "turn_completed" }));

    const planReady = received.find((candidate) => candidate.control?.type === "plan_ready");
    expect(planReady?.control).toMatchObject({
      type: "plan_ready",
      plan: "1. Inspect reality\n2. Implement and verify",
      approval: { kind: "implement", autoApproveEligible: true },
    });
    expect(received.at(-1)?.payload).toEqual({ type: "turn_completed" });
    if (planReady?.control?.type !== "plan_ready") {
      throw new Error("Expected a normalized Plan-ready control event");
    }

    const resolution = await adapter.resolveApproval({
      thread: THREAD,
      execution: descriptor,
      approvalId: planReady.control.approval.id,
      decision: "implement",
    });

    expect(fixture.resolveApproval).not.toHaveBeenCalled();
    expect(fixture.modeCalls).toEqual(["default"]);
    expect(resolution.runModeReceipt).toMatchObject({
      requestedMode: "default",
      status: "applied",
    });
    expect(resolution.followUpPrompt).toContain("Implement the approved native plan now");
    expect(resolution.followUpPrompt).toContain("Inspect reality");
  });

  it("binds an id-only provider Implement approval to the captured Plan result", async () => {
    const fixture = createHost();
    const adapter = new HostedHarnessAdapter(
      "fixture",
      defineHarnessCapabilities({ toolAttachment: ["native"], plan: { kind: "native" } }),
      fixture.host,
    );
    const descriptor = await adapter.startExecution({
      thread: THREAD,
      execution: executionInput("plan"),
    });
    const received: HarnessExecutionEvent[] = [];
    adapter.subscribeEvents(descriptor, (next) => received.push(next));

    fixture.emit(
      descriptor.id,
      event("plan", {
        type: "timeline",
        item: {
          type: "tool_call",
          detail: { type: "plan", text: "Inspect the authority, then implement and verify." },
        },
      }),
    );
    fixture.emit(
      descriptor.id,
      event("implement", {
        type: "permission_requested",
        request: {
          id: "implement-plan-1",
          kind: "plan",
          title: "Plan",
          input: { planId: "plan-1" },
          metadata: { planId: "plan-1" },
        },
      }),
    );

    const planReady = received.find((candidate) => candidate.control?.type === "plan_ready");
    expect(planReady?.control).toMatchObject({
      type: "plan_ready",
      plan: "Inspect the authority, then implement and verify.",
      approval: { id: "implement-plan-1", kind: "implement" },
    });
    if (planReady?.control?.type !== "plan_ready") {
      throw new Error("Expected the provider Implement approval to retain the captured Plan");
    }

    const resolution = await adapter.resolveApproval({
      thread: THREAD,
      execution: descriptor,
      approvalId: planReady.control.approval.id,
      decision: "implement",
    });

    expect(fixture.resolveApproval).toHaveBeenCalledWith(
      "fixture",
      expect.objectContaining({ approvalId: "implement-plan-1", decision: "implement" }),
    );
    expect(fixture.modeCalls).toEqual(["default"]);
    expect(resolution.followUpPrompt).toContain(
      "Inspect the authority, then implement and verify.",
    );
  });

  it("normalizes provider permissions but never makes provider questions auto-approvable", async () => {
    const fixture = createHost();
    fixture.resolveApproval.mockResolvedValueOnce({ followUpPrompt: "provider continuation" });
    const adapter = new HostedHarnessAdapter(
      "fixture",
      defineHarnessCapabilities({ toolAttachment: ["native"], plan: { kind: "native" } }),
      fixture.host,
    );
    const descriptor = (await adapter.startExecution({
      thread: THREAD,
      execution: executionInput("default"),
    })) as HarnessExecutionDescriptor;
    const received: HarnessExecutionEvent[] = [];
    adapter.subscribeEvents(descriptor, (next) => received.push(next));

    fixture.emit(
      descriptor.id,
      event("question", {
        type: "permission_requested",
        request: { id: "question-1", kind: "question", title: "Choose a product direction" },
      }),
    );
    fixture.emit(
      descriptor.id,
      event("command", {
        type: "permission_requested",
        request: { id: "command-1", kind: "command", title: "Run tests" },
      }),
    );
    fixture.emit(
      descriptor.id,
      event("mode", {
        type: "permission_requested",
        request: { id: "mode-1", kind: "mode", title: "Switch provider mode" },
      }),
    );

    expect(received.map((candidate) => candidate.control?.type)).toEqual([
      "provider_question",
      "approval_requested",
      "approval_requested",
    ]);
    const approval = received[1]?.control;
    if (approval?.type !== "approval_requested") {
      throw new Error("Expected a normalized command approval");
    }
    expect(approval.approval.autoApproveEligible).toBe(true);
    expect(received[2]?.control).toMatchObject({
      type: "approval_requested",
      approval: { id: "mode-1", kind: "mode", autoApproveEligible: true },
    });
    const resolution = await adapter.resolveApproval({
      thread: THREAD,
      execution: descriptor,
      approvalId: approval.approval.id,
      decision: "allow",
    });
    expect(fixture.resolveApproval).toHaveBeenCalledWith(
      "fixture",
      expect.objectContaining({ approvalId: "command-1", decision: "allow" }),
    );
    expect(resolution).toMatchObject({
      followUpPrompt: "provider continuation",
      runModeReceipt: null,
    });
    await expect(
      adapter.resolveApproval({
        thread: THREAD,
        execution: descriptor,
        approvalId: "question-1",
        decision: "allow",
      }),
    ).rejects.toThrow("is not pending");
  });

  it("drops pending provider approvals when Stop interrupts the execution", async () => {
    const fixture = createHost();
    const adapter = new HostedHarnessAdapter(
      "fixture",
      defineHarnessCapabilities({ toolAttachment: ["native"], plan: { kind: "native" } }),
      fixture.host,
    );
    const descriptor = await adapter.startExecution({
      thread: THREAD,
      execution: executionInput("default"),
    });
    adapter.subscribeEvents(descriptor, () => undefined);
    fixture.emit(
      descriptor.id,
      event("command", {
        type: "permission_requested",
        request: { id: "command-stop", kind: "command", title: "Run a mutating command" },
      }),
    );

    await adapter.interruptExecution(descriptor);

    await expect(
      adapter.resolveApproval({
        thread: THREAD,
        execution: descriptor,
        approvalId: "command-stop",
        decision: "allow",
      }),
    ).rejects.toThrow("is not pending");
  });
});
