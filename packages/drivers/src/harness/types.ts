import type {
  ProviderPlanCapability,
  ProviderRunMode,
  ProviderRunModeReceipt,
} from "@thoth/protocol/provider-control";

export type HarnessInstructionAttachment = "developer" | "system" | "session_prompt";

export type HarnessToolAttachment = "native" | "mcp" | "acp";

export interface HarnessCapabilities {
  instructionAttachment: readonly HarnessInstructionAttachment[];
  toolAttachment: readonly HarnessToolAttachment[];
  continuation: "same_thread" | "replacement_thread";
  interrupt: "cooperative" | "forceful";
  eventReplay: "cursor" | "live_only";
  permissions: "interactive" | "unattended";
  threadPersistence: "native" | "adapter_owned" | "none";
  nativeRetention: "provider_owned" | "adapter_owned";
  plan: ProviderPlanCapability;
}

export interface RuntimeBundleTool {
  name: string;
  title?: string;
  description: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
}

export interface RuntimeBundle {
  id: "thoth.clarify" | "thoth.loop";
  digest: `sha256:${string}`;
  instructions: string;
  tools: readonly RuntimeBundleTool[];
  scopes: readonly string[];
  sourceName: string;
}

export interface HarnessThreadDescriptor {
  id: string;
  nativeHandle: string | null;
  adapterId: string;
  persistence: Record<string, unknown> | null;
}

export interface HarnessRuntimeToolBinding {
  transport: HarnessToolAttachment;
  endpoint?: string;
  headers?: Readonly<Record<string, string>>;
  catalog?: unknown;
}

export interface RuntimeAttachmentReceipt {
  id: string;
  adapterId: string;
  threadId: string;
  bundleId: RuntimeBundle["id"];
  bundleDigest: RuntimeBundle["digest"];
  instructionAttachment: HarnessInstructionAttachment;
  toolAttachment: HarnessToolAttachment;
  attachedAt: string;
}

export interface HarnessExecutionDescriptor {
  id: string;
  threadId: string;
  nativeTurnId: string | null;
}

export interface HarnessExecutionEvent {
  id: string;
  executionId: string;
  nativeCursor?: string;
  occurredAt: string;
  payload: unknown;
  control?: HarnessExecutionControlEvent;
}

export interface HarnessApprovalRequest {
  id: string;
  kind: "implement" | "command" | "file" | "tool" | "mode" | "permission" | "question";
  title: string;
  description: string | null;
  displayed: unknown;
  autoApproveEligible: boolean;
}

export type HarnessExecutionControlEvent =
  | { type: "plan_ready"; plan: string; approval: HarnessApprovalRequest }
  | { type: "plan_invalid"; reason: string }
  | { type: "approval_requested"; approval: HarnessApprovalRequest }
  | { type: "provider_question"; request: unknown };

export interface HarnessApprovalResolution {
  approvalId: string;
  decision: "allow" | "deny" | "implement";
  followUpPrompt: unknown | null;
  runModeReceipt: ProviderRunModeReceipt | null;
}

export interface HarnessThreadInput {
  workspaceId: string;
  workspacePath: string;
  profile: Record<string, unknown>;
  internal: boolean;
}

export interface HarnessExecutionInput {
  executionId: string;
  generation: string;
  prompt: unknown;
  attachment: RuntimeAttachmentReceipt | null;
  runMode: ProviderRunMode;
  runModeReceipt: ProviderRunModeReceipt;
}

export interface LegacyHarnessThreadInspection {
  resumable: boolean;
  nativeHandle: string | null;
  metadata: Record<string, unknown>;
}

/**
 * The only provider-facing contract used by Thoth orchestration. Provider
 * names, home layouts and native event shapes are private to implementations.
 */
export interface HarnessAdapter {
  readonly id: string;
  capabilities(): HarnessCapabilities;
  createThread(input: HarnessThreadInput): Promise<HarnessThreadDescriptor>;
  resumeThread(input: {
    descriptor: HarnessThreadDescriptor;
    workspaceId: string;
    workspacePath: string;
  }): Promise<HarnessThreadDescriptor>;
  attachRuntimeBundle(input: {
    thread: HarnessThreadDescriptor;
    bundle: RuntimeBundle;
    tools: HarnessRuntimeToolBinding;
  }): Promise<RuntimeAttachmentReceipt>;
  prepareRunMode(input: {
    thread: HarnessThreadDescriptor;
    mode: ProviderRunMode;
  }): Promise<ProviderRunModeReceipt>;
  startExecution(input: {
    thread: HarnessThreadDescriptor;
    execution: HarnessExecutionInput;
  }): Promise<HarnessExecutionDescriptor>;
  continueExecution(input: {
    thread: HarnessThreadDescriptor;
    execution: HarnessExecutionInput;
  }): Promise<HarnessExecutionDescriptor>;
  resolveApproval(input: {
    thread: HarnessThreadDescriptor;
    execution: HarnessExecutionDescriptor;
    approvalId: string;
    decision: "allow" | "deny" | "implement";
  }): Promise<HarnessApprovalResolution>;
  interruptExecution(execution: HarnessExecutionDescriptor): Promise<void>;
  subscribeEvents(
    execution: HarnessExecutionDescriptor,
    callback: (event: HarnessExecutionEvent) => void,
    cursor?: string,
  ): () => void;
  describePersistence(thread: HarnessThreadDescriptor): Promise<Record<string, unknown> | null>;
  archiveThread(thread: HarnessThreadDescriptor): Promise<void>;
  deleteOwnedThread(thread: HarnessThreadDescriptor): Promise<void>;
  inspectLegacyThread(input: {
    legacyRoot: string;
    metadata: Record<string, unknown>;
  }): Promise<LegacyHarnessThreadInspection>;
  adoptNativeThread(input: {
    inspection: LegacyHarnessThreadInspection;
    workspaceId: string;
    workspacePath: string;
  }): Promise<HarnessThreadDescriptor | null>;
  verifyResume(thread: HarnessThreadDescriptor): Promise<boolean>;
}
