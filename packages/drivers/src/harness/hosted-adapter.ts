import type {
  HarnessAdapter,
  HarnessApprovalRequest,
  HarnessApprovalResolution,
  HarnessCapabilities,
  HarnessExecutionDescriptor,
  HarnessExecutionEvent,
  HarnessExecutionInput,
  HarnessRuntimeToolBinding,
  HarnessThreadDescriptor,
  HarnessThreadInput,
  LegacyHarnessThreadInspection,
  RuntimeAttachmentReceipt,
  RuntimeBundle,
} from "./types.js";
import type { ProviderRunMode, ProviderRunModeReceipt } from "@thoth/protocol/provider-control";

/** Process/session operations supplied by the daemon without exposing task authority. */
export interface HarnessAdapterHost {
  createThread(adapterId: string, input: HarnessThreadInput): Promise<HarnessThreadDescriptor>;
  resumeThread(
    adapterId: string,
    input: {
      descriptor: HarnessThreadDescriptor;
      workspaceId: string;
      workspacePath: string;
    },
  ): Promise<HarnessThreadDescriptor>;
  attachRuntimeBundle(
    adapterId: string,
    input: {
      thread: HarnessThreadDescriptor;
      bundle: RuntimeBundle;
      tools: HarnessRuntimeToolBinding;
    },
  ): Promise<RuntimeAttachmentReceipt>;
  prepareRunMode(
    adapterId: string,
    input: { thread: HarnessThreadDescriptor; mode: ProviderRunMode },
  ): Promise<ProviderRunModeReceipt>;
  startExecution(
    adapterId: string,
    input: { thread: HarnessThreadDescriptor; execution: HarnessExecutionInput },
  ): Promise<HarnessExecutionDescriptor>;
  continueExecution(
    adapterId: string,
    input: { thread: HarnessThreadDescriptor; execution: HarnessExecutionInput },
  ): Promise<HarnessExecutionDescriptor>;
  resolveApproval(
    adapterId: string,
    input: {
      thread: HarnessThreadDescriptor;
      execution: HarnessExecutionDescriptor;
      approvalId: string;
      decision: "allow" | "deny" | "implement";
    },
  ): Promise<{ followUpPrompt: unknown | null }>;
  interruptExecution(adapterId: string, execution: HarnessExecutionDescriptor): Promise<void>;
  subscribeEvents(
    adapterId: string,
    execution: HarnessExecutionDescriptor,
    callback: (event: HarnessExecutionEvent) => void,
    cursor?: string,
  ): () => void;
  describePersistence(
    adapterId: string,
    thread: HarnessThreadDescriptor,
  ): Promise<Record<string, unknown> | null>;
  archiveThread(adapterId: string, thread: HarnessThreadDescriptor): Promise<void>;
  deleteOwnedThread(adapterId: string, thread: HarnessThreadDescriptor): Promise<void>;
  inspectLegacyThread(
    adapterId: string,
    input: { legacyRoot: string; metadata: Record<string, unknown> },
  ): Promise<LegacyHarnessThreadInspection>;
  adoptNativeThread(
    adapterId: string,
    input: {
      inspection: LegacyHarnessThreadInspection;
      workspaceId: string;
      workspacePath: string;
    },
  ): Promise<HarnessThreadDescriptor | null>;
  verifyResume(adapterId: string, thread: HarnessThreadDescriptor): Promise<boolean>;
}

/**
 * Final provider-neutral adapter implementation. Provider-specific transport
 * code implements HarnessAdapterHost; orchestration only receives this class.
 */
export class HostedHarnessAdapter implements HarnessAdapter {
  private readonly executionControls = new Map<
    string,
    {
      mode: ProviderRunMode;
      planParts: string[];
      planReady: boolean;
    }
  >();
  private readonly approvals = new Map<
    string,
    { threadId: string; executionId: string; request: HarnessApprovalRequest; synthetic: boolean }
  >();

  constructor(
    readonly id: string,
    private readonly capabilityReceipt: HarnessCapabilities,
    private readonly host: HarnessAdapterHost,
  ) {}

  capabilities(): HarnessCapabilities {
    return this.capabilityReceipt;
  }

  createThread(input: HarnessThreadInput): Promise<HarnessThreadDescriptor> {
    return this.host.createThread(this.id, input);
  }

  resumeThread(input: {
    descriptor: HarnessThreadDescriptor;
    workspaceId: string;
    workspacePath: string;
  }): Promise<HarnessThreadDescriptor> {
    return this.host.resumeThread(this.id, input);
  }

  attachRuntimeBundle(input: {
    thread: HarnessThreadDescriptor;
    bundle: RuntimeBundle;
    tools: HarnessRuntimeToolBinding;
  }): Promise<RuntimeAttachmentReceipt> {
    return this.host.attachRuntimeBundle(this.id, input);
  }

  prepareRunMode(input: {
    thread: HarnessThreadDescriptor;
    mode: ProviderRunMode;
  }): Promise<ProviderRunModeReceipt> {
    return this.host.prepareRunMode(this.id, input);
  }

  startExecution(input: {
    thread: HarnessThreadDescriptor;
    execution: HarnessExecutionInput;
  }): Promise<HarnessExecutionDescriptor> {
    this.rememberExecution(input.execution);
    return this.host.startExecution(this.id, input);
  }

  continueExecution(input: {
    thread: HarnessThreadDescriptor;
    execution: HarnessExecutionInput;
  }): Promise<HarnessExecutionDescriptor> {
    this.rememberExecution(input.execution);
    return this.host.continueExecution(this.id, input);
  }

  async resolveApproval(input: {
    thread: HarnessThreadDescriptor;
    execution: HarnessExecutionDescriptor;
    approvalId: string;
    decision: "allow" | "deny" | "implement";
  }): Promise<HarnessApprovalResolution> {
    const approval = this.approvals.get(input.approvalId);
    if (
      !approval ||
      approval.threadId !== input.thread.id ||
      approval.executionId !== input.execution.id
    ) {
      throw new Error(`Harness approval ${input.approvalId} is not pending for this execution`);
    }

    let followUpPrompt: unknown | null = null;
    if (approval.synthetic) {
      if (input.decision !== "deny") {
        const plan = readPlanText(approval.request.displayed);
        followUpPrompt = buildPlanImplementationPrompt(plan);
      }
    } else {
      const resolved = await this.host.resolveApproval(this.id, input);
      followUpPrompt = resolved.followUpPrompt;
    }

    let runModeReceipt: ProviderRunModeReceipt | null = null;
    if (approval.request.kind === "implement" && input.decision !== "deny") {
      runModeReceipt = await this.prepareRunMode({ thread: input.thread, mode: "default" });
      if (followUpPrompt === null && approval.synthetic) {
        followUpPrompt = buildPlanImplementationPrompt(readPlanText(approval.request.displayed));
      }
    }
    this.approvals.delete(input.approvalId);
    return {
      approvalId: input.approvalId,
      decision: input.decision,
      followUpPrompt,
      runModeReceipt,
    };
  }

  async interruptExecution(execution: HarnessExecutionDescriptor): Promise<void> {
    try {
      await this.host.interruptExecution(this.id, execution);
    } finally {
      this.executionControls.delete(execution.id);
      for (const [approvalId, approval] of this.approvals) {
        if (approval.executionId === execution.id) {
          this.approvals.delete(approvalId);
        }
      }
    }
  }

  subscribeEvents(
    execution: HarnessExecutionDescriptor,
    callback: (event: HarnessExecutionEvent) => void,
    cursor?: string,
  ): () => void {
    return this.host.subscribeEvents(
      this.id,
      execution,
      (event) => this.forwardNormalizedEvent(execution, event, callback),
      cursor,
    );
  }

  describePersistence(thread: HarnessThreadDescriptor): Promise<Record<string, unknown> | null> {
    return this.host.describePersistence(this.id, thread);
  }

  archiveThread(thread: HarnessThreadDescriptor): Promise<void> {
    return this.host.archiveThread(this.id, thread);
  }

  deleteOwnedThread(thread: HarnessThreadDescriptor): Promise<void> {
    return this.host.deleteOwnedThread(this.id, thread);
  }

  inspectLegacyThread(input: {
    legacyRoot: string;
    metadata: Record<string, unknown>;
  }): Promise<LegacyHarnessThreadInspection> {
    return this.host.inspectLegacyThread(this.id, input);
  }

  adoptNativeThread(input: {
    inspection: LegacyHarnessThreadInspection;
    workspaceId: string;
    workspacePath: string;
  }): Promise<HarnessThreadDescriptor | null> {
    return this.host.adoptNativeThread(this.id, input);
  }

  verifyResume(thread: HarnessThreadDescriptor): Promise<boolean> {
    return this.host.verifyResume(this.id, thread);
  }

  private rememberExecution(execution: HarnessExecutionInput): void {
    this.executionControls.set(execution.executionId, {
      mode: execution.runMode,
      planParts: [],
      planReady: false,
    });
  }

  private forwardNormalizedEvent(
    execution: HarnessExecutionDescriptor,
    event: HarnessExecutionEvent,
    callback: (event: HarnessExecutionEvent) => void,
  ): void {
    const control = this.executionControls.get(execution.id);
    if (!control) {
      callback(event);
      return;
    }
    const payload = asRecord(event.payload);
    const payloadType = readString(payload?.type);
    if (payloadType === "timeline") {
      const text = readPlanText(payload?.item);
      if (text) {
        control.planParts.push(text);
      }
    }
    if (payloadType === "permission_requested") {
      const request = asRecord(payload?.request);
      const kind = readString(request?.kind);
      if (kind === "question") {
        callback({ ...event, control: { type: "provider_question", request: payload?.request } });
        return;
      }
      const approval = toHarnessApproval(request);
      this.approvals.set(approval.id, {
        threadId: execution.threadId,
        executionId: execution.id,
        request: approval,
        synthetic: false,
      });
      if (approval.kind === "implement") {
        const plan = readPlanText(approval.displayed);
        control.planReady = Boolean(plan);
        if (!plan) {
          this.approvals.delete(approval.id);
        }
        callback({
          ...event,
          control: plan
            ? { type: "plan_ready", plan, approval }
            : {
                type: "plan_invalid",
                reason: "Native Plan completed without usable plan content.",
              },
        });
        return;
      }
      callback({ ...event, control: { type: "approval_requested", approval } });
      return;
    }
    if (payloadType === "turn_completed" && control.mode === "plan" && !control.planReady) {
      const plan = control.planParts
        .map((part) => part.trim())
        .filter(Boolean)
        .join("\n\n");
      if (!plan) {
        callback({
          ...event,
          control: {
            type: "plan_invalid",
            reason: "Native Plan completed without usable plan content.",
          },
        });
        return;
      }
      const approval = syntheticPlanApproval(execution.id, plan);
      control.planReady = true;
      this.approvals.set(approval.id, {
        threadId: execution.threadId,
        executionId: execution.id,
        request: approval,
        synthetic: true,
      });
      callback({
        id: `${event.id}:plan-ready`,
        executionId: event.executionId,
        nativeCursor: event.nativeCursor,
        occurredAt: event.occurredAt,
        payload: { type: "harness_plan_ready" },
        control: { type: "plan_ready", plan, approval },
      });
    }
    callback(event);
    if (["turn_completed", "turn_failed", "turn_canceled"].includes(payloadType ?? "")) {
      this.executionControls.delete(execution.id);
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readPlanText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  const record = asRecord(value);
  if (!record) return "";
  if (record.type === "assistant_message") return readString(record.text) ?? "";
  const detail = asRecord(record.detail);
  if (detail?.type === "plan") return readString(detail.text) ?? "";
  const input = asRecord(record.input);
  const metadata = asRecord(record.metadata);
  return (
    readString(record.plan) ??
    readString(input?.plan) ??
    readString(metadata?.planText) ??
    readString(record.text) ??
    ""
  );
}

function toHarnessApproval(request: Record<string, unknown> | null): HarnessApprovalRequest {
  const id = readString(request?.id);
  if (!id) throw new Error("Provider approval request is missing its identity");
  const providerKind = readString(request?.kind);
  const kind: HarnessApprovalRequest["kind"] =
    providerKind === "plan"
      ? "implement"
      : providerKind === "command" ||
          providerKind === "file" ||
          providerKind === "tool" ||
          providerKind === "mode"
        ? providerKind
        : providerKind === "question"
          ? "question"
          : "permission";
  return {
    id,
    kind,
    title: readString(request?.title) ?? readString(request?.name) ?? "Provider approval",
    description: readString(request?.description),
    displayed: request ?? {},
    autoApproveEligible: kind !== "question",
  };
}

function syntheticPlanApproval(executionId: string, plan: string): HarnessApprovalRequest {
  return {
    id: `harness-plan-${executionId}`,
    kind: "implement",
    title: "Implement plan",
    description: "The provider completed its native Plan and is ready to implement it.",
    displayed: { plan },
    autoApproveEligible: true,
  };
}

function buildPlanImplementationPrompt(plan: string): string {
  return [
    "Implement the approved native plan now in this same provider thread.",
    "Preserve the approved task contract, inspect current workspace reality, and verify the result.",
    plan ? `Approved plan:\n${plan}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
