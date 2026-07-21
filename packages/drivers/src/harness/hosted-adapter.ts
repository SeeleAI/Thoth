import type {
  HarnessAdapter,
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
  startExecution(
    adapterId: string,
    input: { thread: HarnessThreadDescriptor; execution: HarnessExecutionInput },
  ): Promise<HarnessExecutionDescriptor>;
  continueExecution(
    adapterId: string,
    input: { thread: HarnessThreadDescriptor; execution: HarnessExecutionInput },
  ): Promise<HarnessExecutionDescriptor>;
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

  startExecution(input: {
    thread: HarnessThreadDescriptor;
    execution: HarnessExecutionInput;
  }): Promise<HarnessExecutionDescriptor> {
    return this.host.startExecution(this.id, input);
  }

  continueExecution(input: {
    thread: HarnessThreadDescriptor;
    execution: HarnessExecutionInput;
  }): Promise<HarnessExecutionDescriptor> {
    return this.host.continueExecution(this.id, input);
  }

  interruptExecution(execution: HarnessExecutionDescriptor): Promise<void> {
    return this.host.interruptExecution(this.id, execution);
  }

  subscribeEvents(
    execution: HarnessExecutionDescriptor,
    callback: (event: HarnessExecutionEvent) => void,
    cursor?: string,
  ): () => void {
    return this.host.subscribeEvents(this.id, execution, callback, cursor);
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
}
