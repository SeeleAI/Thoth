import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  AgentPermissionRequest,
  AgentPermissionResponse,
  AgentPromptInput,
  AgentRunResult,
  AgentSessionConfig,
  AgentStreamEvent,
  HarnessAdapter,
  HarnessThread,
} from "@thoth/drivers/agent-runtime";
import {
  defineHarnessCapabilities,
  type HarnessExecutionDescriptor,
  type HarnessExecutionEvent,
  type HarnessExecutionInput,
  type HarnessThreadDescriptor,
  type RuntimeAttachmentReceipt,
  type RuntimeBundle,
} from "@thoth/drivers/harness";
import type { ProviderRunMode } from "@thoth/protocol/provider-control";

import { createTestLogger } from "../../test-utils/test-logger.js";
import { ExecutionService } from "./execution-service.js";

const CAPABILITIES = {
  supportsStreaming: true,
  supportsSessionPersistence: true,
  supportsDynamicModes: true,
  supportsMcpServers: true,
  supportsReasoningStream: true,
  supportsToolInvocations: true,
  supportsRewindConversation: false,
  supportsRewindFiles: false,
  supportsRewindBoth: false,
} as const;

const HARNESS_CAPABILITIES = defineHarnessCapabilities({
  toolAttachment: ["native"],
  plan: { kind: "native" },
});

const RUNTIME_BUNDLE: RuntimeBundle = {
  id: "thoth.loop",
  digest: `sha256:${"a".repeat(64)}`,
  instructions: "Use the daemon-owned Loop tool contract.",
  tools: [],
  scopes: ["loop_planexec"],
  sourceName: "fixture/SKILL.md",
};

class ScriptedHarnessThread implements HarnessThread {
  readonly provider = "codex" as const;
  readonly id = "native-thread-1";
  readonly capabilities = CAPABILITIES;
  readonly prompts: AgentPromptInput[] = [];
  readonly modeCalls: ProviderRunMode[] = [];
  readonly permissionResponses: Array<{
    requestId: string;
    response: AgentPermissionResponse;
  }> = [];
  interruptCount = 0;
  permissionFollowUpPrompt: AgentPromptInput | undefined;

  private readonly subscribers = new Set<(event: AgentStreamEvent) => void>();
  private readonly permissions = new Map<string, AgentPermissionRequest>();
  private currentMode: ProviderRunMode = "default";
  private activeTurnId: string | null = null;
  private turnCounter = 0;

  async run(): Promise<AgentRunResult> {
    return { sessionId: this.id, finalText: "", timeline: [] };
  }

  async startTurn(prompt: AgentPromptInput): Promise<{ turnId: string }> {
    this.prompts.push(prompt);
    this.activeTurnId = `native-turn-${++this.turnCounter}`;
    return { turnId: this.activeTurnId };
  }

  subscribe(callback: (event: AgentStreamEvent) => void): () => void {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  async *streamHistory(): AsyncGenerator<AgentStreamEvent> {}

  async getRuntimeInfo() {
    return {
      provider: this.provider,
      sessionId: this.id,
      modeId: this.currentMode === "plan" ? "native-plan" : "native-default",
    };
  }

  async getAvailableModes() {
    return [];
  }

  async getCurrentMode(): Promise<string> {
    return this.currentMode === "plan" ? "native-plan" : "native-default";
  }

  async setMode(modeId: string): Promise<void> {
    this.currentMode = modeId === "native-plan" || modeId === "plan" ? "plan" : "default";
  }

  async getProviderRunModeCapability() {
    return { kind: "native" as const };
  }

  async applyProviderRunMode(mode: ProviderRunMode) {
    this.currentMode = mode;
    this.modeCalls.push(mode);
    return {
      capability: { kind: "native" as const },
      nativeModeId: mode === "plan" ? "native-plan" : "native-default",
    };
  }

  getPendingPermissions(): AgentPermissionRequest[] {
    return [...this.permissions.values()];
  }

  async respondToPermission(requestId: string, response: AgentPermissionResponse) {
    this.permissionResponses.push({ requestId, response });
    this.permissions.delete(requestId);
    return this.permissionFollowUpPrompt
      ? { followUpPrompt: this.permissionFollowUpPrompt }
      : undefined;
  }

  describePersistence() {
    return { provider: this.provider, sessionId: this.id, nativeHandle: this.id };
  }

  async interrupt(): Promise<void> {
    this.interruptCount += 1;
    if (this.activeTurnId) {
      this.emit({
        type: "turn_canceled",
        provider: this.provider,
        reason: "interrupted",
        turnId: this.activeTurnId,
      });
    }
  }

  async close(): Promise<void> {}

  emit(event: AgentStreamEvent): void {
    if (event.type === "permission_requested") {
      this.permissions.set(event.request.id, event.request);
    }
    for (const subscriber of this.subscribers) subscriber(event);
  }

  emitTimeline(item: Extract<AgentStreamEvent, { type: "timeline" }>["item"]): void {
    this.emit({
      type: "timeline",
      provider: this.provider,
      item,
      turnId: this.requireActiveTurn(),
    });
  }

  emitPermission(request: Omit<AgentPermissionRequest, "provider">): void {
    this.emit({
      type: "permission_requested",
      provider: this.provider,
      request: { ...request, provider: this.provider },
      turnId: this.requireActiveTurn(),
    });
  }

  emitCompleted(): void {
    const turnId = this.requireActiveTurn();
    this.emit({ type: "turn_completed", provider: this.provider, turnId });
    this.activeTurnId = null;
  }

  private requireActiveTurn(): string {
    if (!this.activeTurnId) throw new Error("No active scripted provider turn");
    return this.activeTurnId;
  }
}

class ScriptedHarnessAdapter implements HarnessAdapter {
  readonly provider = "codex" as const;
  readonly capabilities = CAPABILITIES;
  readonly harnessCapabilities = HARNESS_CAPABILITIES;
  createCount = 0;

  constructor(readonly thread: ScriptedHarnessThread) {}

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async fetchCatalog() {
    return { models: [], modes: [], planCapability: { kind: "native" as const } };
  }

  async createSession(_config: AgentSessionConfig): Promise<HarnessThread> {
    this.createCount += 1;
    return this.thread;
  }

  async resumeSession(): Promise<HarnessThread> {
    return this.thread;
  }
}

interface HarnessFixture {
  service: ExecutionService;
  adapter: ScriptedHarnessAdapter;
  session: ScriptedHarnessThread;
  thread: HarnessThreadDescriptor;
  attachment: RuntimeAttachmentReceipt;
  workdir: string;
}

const fixtures: HarnessFixture[] = [];

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    await fixture.service.deleteHarnessThread("codex", fixture.thread).catch(() => undefined);
    rmSync(fixture.workdir, { recursive: true, force: true });
  }
});

async function createFixture(): Promise<HarnessFixture> {
  const workdir = mkdtempSync(join(tmpdir(), "thoth-execution-harness-"));
  const session = new ScriptedHarnessThread();
  const adapter = new ScriptedHarnessAdapter(session);
  const service = new ExecutionService({
    adapters: { codex: adapter },
    logger: createTestLogger(),
    thothToolsEnabled: false,
    agentStreamCoalesceWindowMs: 0,
  });
  const thread = await service.createHarnessThread("codex", {
    workspaceId: "workspace-1",
    workspacePath: workdir,
    profile: { provider: "codex" },
    internal: true,
  });
  const attachment = await service.attachHarnessRuntimeBundle("codex", {
    thread,
    bundle: RUNTIME_BUNDLE,
    tools: { transport: "native", catalog: { scope: "loop_planexec" } },
  });
  const fixture = { service, adapter, session, thread, attachment, workdir };
  fixtures.push(fixture);
  return fixture;
}

async function startExecution(
  fixture: HarnessFixture,
  runMode: ProviderRunMode,
  executionId: string,
): Promise<HarnessExecutionDescriptor> {
  const runModeReceipt = await fixture.service.prepareHarnessRunMode("codex", {
    thread: fixture.thread,
    mode: runMode,
  });
  const execution: HarnessExecutionInput = {
    executionId,
    generation: `generation-${executionId}`,
    prompt: "Execute the approved task.",
    attachment: fixture.attachment,
    runMode,
    runModeReceipt,
  };
  const descriptor = await fixture.service.startHarnessExecution("codex", {
    thread: fixture.thread,
    execution,
  });
  await waitForTurn(fixture.session, 1);
  return descriptor;
}

async function waitForTurn(session: ScriptedHarnessThread, count: number): Promise<void> {
  await vi.waitFor(() => expect(session.prompts).toHaveLength(count));
  await new Promise<void>((resolvePromise) => setImmediate(resolvePromise));
}

async function waitForControl(
  events: HarnessExecutionEvent[],
  type: NonNullable<HarnessExecutionEvent["control"]>["type"],
): Promise<NonNullable<HarnessExecutionEvent["control"]>> {
  await vi.waitFor(() => expect(events.some((event) => event.control?.type === type)).toBe(true));
  const control = events.find((event) => event.control?.type === type)?.control;
  if (!control) throw new Error(`Missing ${type} control event`);
  return control;
}

describe("ExecutionService Harness conformance", () => {
  it("captures native Plan, creates one Implement approval, replays events and continues on the same thread", async () => {
    const fixture = await createFixture();
    const descriptor = await startExecution(fixture, "plan", "execution-plan");
    const received: HarnessExecutionEvent[] = [];
    fixture.service.subscribeHarnessEvents("codex", descriptor, (event) => received.push(event));

    fixture.session.emitTimeline({
      type: "assistant_message",
      text: "1. Inspect reality\n2. Implement and verify",
    });
    fixture.session.emitCompleted();

    const control = await waitForControl(received, "plan_ready");
    expect(control).toMatchObject({
      type: "plan_ready",
      plan: "1. Inspect reality\n2. Implement and verify",
      approval: { kind: "implement", autoApproveEligible: true },
    });
    if (control.type !== "plan_ready") throw new Error("Expected native Plan control");

    const replayed: HarnessExecutionEvent[] = [];
    fixture.service.subscribeHarnessEvents("codex", descriptor, (event) => replayed.push(event));
    expect(replayed).toEqual(received);
    const afterFirstCursor: HarnessExecutionEvent[] = [];
    fixture.service.subscribeHarnessEvents(
      "codex",
      descriptor,
      (event) => afterFirstCursor.push(event),
      "1",
    );
    expect(afterFirstCursor).toEqual(received.slice(1));

    const resolution = await fixture.service.resolveHarnessApproval("codex", {
      thread: fixture.thread,
      execution: descriptor,
      approvalId: control.approval.id,
      decision: "implement",
    });
    expect(resolution.runModeReceipt).toMatchObject({
      requestedMode: "default",
      status: "applied",
    });
    expect(resolution.followUpPrompt).toContain("Implement the approved native plan now");
    expect(resolution.followUpPrompt).toContain("Inspect reality");
    expect(fixture.session.modeCalls).toEqual(["plan", "default"]);

    const continuation = await fixture.service.continueHarnessExecution("codex", {
      thread: fixture.thread,
      execution: {
        executionId: descriptor.id,
        generation: "generation-execution-plan",
        prompt: resolution.followUpPrompt,
        attachment: fixture.attachment,
        runMode: "default",
        runModeReceipt: resolution.runModeReceipt!,
      },
    });
    await waitForTurn(fixture.session, 2);
    expect(continuation.threadId).toBe(fixture.thread.id);
    expect(fixture.adapter.createCount).toBe(1);
    expect(fixture.session.prompts[1]).toContain("Implement the approved native plan now");
    fixture.session.emitCompleted();
  });

  it("binds an id-only provider Implement approval to the captured native Plan", async () => {
    const fixture = await createFixture();
    const descriptor = await startExecution(fixture, "plan", "execution-explicit-plan");
    const received: HarnessExecutionEvent[] = [];
    fixture.service.subscribeHarnessEvents("codex", descriptor, (event) => received.push(event));

    fixture.session.emitTimeline({
      type: "tool_call",
      status: "completed",
      callId: "plan-call",
      name: "plan",
      title: "Plan",
      input: {},
      output: null,
      detail: { type: "plan", text: "Inspect authority, then implement and verify." },
    });
    fixture.session.emitPermission({
      id: "implement-plan-1",
      name: "Plan",
      kind: "plan",
      title: "Plan",
      input: { planId: "plan-1" },
      metadata: { planId: "plan-1" },
    });

    const control = await waitForControl(received, "plan_ready");
    expect(control).toMatchObject({
      type: "plan_ready",
      plan: "Inspect authority, then implement and verify.",
      approval: { id: "implement-plan-1", kind: "implement" },
    });
    if (control.type !== "plan_ready") throw new Error("Expected explicit Plan control");

    const resolution = await fixture.service.resolveHarnessApproval("codex", {
      thread: fixture.thread,
      execution: descriptor,
      approvalId: control.approval.id,
      decision: "implement",
    });
    expect(fixture.session.permissionResponses).toEqual([
      {
        requestId: "implement-plan-1",
        response: { behavior: "allow", selectedActionId: "implement" },
      },
    ]);
    expect(resolution.followUpPrompt).toContain("Inspect authority, then implement and verify.");
    expect(fixture.session.modeCalls).toEqual(["plan", "default"]);
    fixture.session.emitCompleted();
  });

  it("reports an empty native Plan as invalid", async () => {
    const fixture = await createFixture();
    const descriptor = await startExecution(fixture, "plan", "execution-empty-plan");
    const received: HarnessExecutionEvent[] = [];
    fixture.service.subscribeHarnessEvents("codex", descriptor, (event) => received.push(event));

    fixture.session.emitCompleted();

    await expect(waitForControl(received, "plan_invalid")).resolves.toMatchObject({
      type: "plan_invalid",
      reason: "Native Plan completed without usable plan content.",
    });
  });

  it("normalizes Provider questions and approvals without making questions auto-approvable", async () => {
    const fixture = await createFixture();
    fixture.session.permissionFollowUpPrompt = "provider continuation";
    const descriptor = await startExecution(fixture, "default", "execution-permission");
    const received: HarnessExecutionEvent[] = [];
    fixture.service.subscribeHarnessEvents("codex", descriptor, (event) => received.push(event));

    fixture.session.emitPermission({
      id: "question-1",
      name: "Question",
      kind: "question",
      title: "Choose a product direction",
    });
    fixture.session.emitPermission({
      id: "tool-1",
      name: "Shell",
      kind: "tool",
      title: "Run tests",
    });
    fixture.session.emitPermission({
      id: "mode-1",
      name: "Mode",
      kind: "mode",
      title: "Switch provider mode",
    });

    await vi.waitFor(() => expect(received.filter((event) => event.control)).toHaveLength(3));
    expect(received.map((event) => event.control?.type)).toEqual([
      "provider_question",
      "approval_requested",
      "approval_requested",
    ]);
    expect(received[1]?.control).toMatchObject({
      type: "approval_requested",
      approval: { id: "tool-1", kind: "tool", autoApproveEligible: true },
    });
    expect(received[2]?.control).toMatchObject({
      type: "approval_requested",
      approval: { id: "mode-1", kind: "mode", autoApproveEligible: true },
    });

    const approval = received[1]?.control;
    if (approval?.type !== "approval_requested") throw new Error("Expected tool approval");
    await expect(
      fixture.service.resolveHarnessApproval("codex", {
        thread: fixture.thread,
        execution: descriptor,
        approvalId: approval.approval.id,
        decision: "allow",
      }),
    ).resolves.toMatchObject({
      followUpPrompt: "provider continuation",
      runModeReceipt: null,
    });
    await expect(
      fixture.service.resolveHarnessApproval("codex", {
        thread: fixture.thread,
        execution: descriptor,
        approvalId: "question-1",
        decision: "allow",
      }),
    ).rejects.toThrow("is not pending");
    fixture.session.emitCompleted();
  });

  it("drops pending approvals when Stop interrupts an active execution", async () => {
    const fixture = await createFixture();
    const descriptor = await startExecution(fixture, "default", "execution-stop");
    const received: HarnessExecutionEvent[] = [];
    fixture.service.subscribeHarnessEvents("codex", descriptor, (event) => received.push(event));
    fixture.session.emitPermission({
      id: "tool-stop",
      name: "Shell",
      kind: "tool",
      title: "Run a mutating command",
    });
    await waitForControl(received, "approval_requested");

    await fixture.service.interruptHarnessExecution("codex", descriptor);

    expect(fixture.session.interruptCount).toBe(1);
    await expect(
      fixture.service.resolveHarnessApproval("codex", {
        thread: fixture.thread,
        execution: descriptor,
        approvalId: "tool-stop",
        decision: "allow",
      }),
    ).rejects.toThrow("is not pending");
  });
});
