import { randomUUID } from "node:crypto";
import type {
  HarnessAdapterHost,
  HarnessExecutionDescriptor,
  HarnessExecutionEvent,
  HarnessExecutionInput,
  HarnessRuntimeToolBinding,
  HarnessThreadDescriptor,
  HarnessThreadInput,
  LegacyHarnessThreadInspection,
  RuntimeAttachmentReceipt,
  RuntimeBundle,
} from "@thoth/drivers/harness";
import type { ProviderRunMode, ProviderRunModeReceipt } from "@thoth/protocol/provider-control";
import type { AgentManager } from "../agent/agent-manager.js";
import type {
  AgentPersistenceHandle,
  AgentPromptInput,
  AgentSessionConfig,
  AgentStreamEvent,
} from "@thoth/drivers/agent-runtime";
import {
  withThothRuntimeTools,
  type ThothRuntimeToolScope,
} from "../agent/thoth-runtime-tools-config.js";

interface HostedThreadState {
  descriptor: HarnessThreadDescriptor;
  input: HarnessThreadInput;
  agentId: string;
  bundle: RuntimeBundle | null;
  tools: HarnessRuntimeToolBinding | null;
  receipt: RuntimeAttachmentReceipt | null;
}

interface HostedExecutionState {
  descriptor: HarnessExecutionDescriptor;
  threadId: string;
  events: HarnessExecutionEvent[];
  subscribers: Set<(event: HarnessExecutionEvent) => void>;
  running: boolean;
  settled: Promise<void>;
  resolveSettled: () => void;
}

const TOOL_SCOPES = new Set<ThothRuntimeToolScope>([
  "clarify",
  "clarify_audit",
  "contract_audit",
  "loop_planexec",
  "loop_review",
]);

function readToolScope(binding: HarnessRuntimeToolBinding): ThothRuntimeToolScope {
  const catalog = binding.catalog;
  if (!catalog || typeof catalog !== "object") {
    throw new Error("Runtime tool binding is missing its phase scope");
  }
  const scope = (catalog as { scope?: unknown }).scope;
  if (typeof scope !== "string" || !TOOL_SCOPES.has(scope as ThothRuntimeToolScope)) {
    throw new Error(`Unsupported RuntimeBundle phase scope: ${String(scope)}`);
  }
  return scope as ThothRuntimeToolScope;
}

function toPrompt(input: unknown): AgentPromptInput {
  if (typeof input === "string" || Array.isArray(input)) {
    return input as AgentPromptInput;
  }
  throw new Error("Harness execution prompt must be provider-neutral text or content blocks");
}

/** Bridges existing provider transports into the provider-neutral HarnessAdapter contract. */
export class AgentManagerHarnessHost implements HarnessAdapterHost {
  private readonly threads = new Map<string, HostedThreadState>();
  private readonly executions = new Map<string, HostedExecutionState>();

  constructor(private readonly agentManager: AgentManager) {}

  async createThread(
    adapterId: string,
    input: HarnessThreadInput,
  ): Promise<HarnessThreadDescriptor> {
    const threadId = `provider-thread-${randomUUID()}`;
    const agentId = randomUUID();
    const descriptor: HarnessThreadDescriptor = {
      id: threadId,
      nativeHandle: null,
      adapterId,
      persistence: { agentId },
    };
    this.threads.set(threadId, {
      descriptor,
      input,
      agentId,
      bundle: null,
      tools: null,
      receipt: null,
    });
    return descriptor;
  }

  async resumeThread(
    adapterId: string,
    input: {
      descriptor: HarnessThreadDescriptor;
      workspaceId: string;
      workspacePath: string;
    },
  ): Promise<HarnessThreadDescriptor> {
    if (input.descriptor.adapterId !== adapterId) {
      throw new Error("Provider thread belongs to a different HarnessAdapter");
    }
    const current = this.threads.get(input.descriptor.id);
    if (current) {
      return current.descriptor;
    }
    const persistence = input.descriptor.persistence ?? {};
    const agentId = typeof persistence.agentId === "string" ? persistence.agentId : null;
    const profile =
      persistence.profile && typeof persistence.profile === "object"
        ? (persistence.profile as Record<string, unknown>)
        : null;
    if (!agentId || !profile) {
      throw new Error("Provider thread persistence is incomplete");
    }
    this.threads.set(input.descriptor.id, {
      descriptor: input.descriptor,
      input: {
        workspaceId: input.workspaceId,
        workspacePath: input.workspacePath,
        profile,
        internal: true,
      },
      agentId,
      bundle: null,
      tools: null,
      receipt: null,
    });
    return input.descriptor;
  }

  async attachRuntimeBundle(
    adapterId: string,
    input: {
      thread: HarnessThreadDescriptor;
      bundle: RuntimeBundle;
      tools: HarnessRuntimeToolBinding;
    },
  ): Promise<RuntimeAttachmentReceipt> {
    const thread = this.requireThread(adapterId, input.thread.id);
    readToolScope(input.tools);
    const receipt: RuntimeAttachmentReceipt = {
      id: `runtime-attachment-${randomUUID()}`,
      adapterId,
      threadId: thread.descriptor.id,
      bundleId: input.bundle.id,
      bundleDigest: input.bundle.digest,
      instructionAttachment: "system",
      toolAttachment: input.tools.transport,
      attachedAt: new Date().toISOString(),
    };
    thread.bundle = input.bundle;
    thread.tools = input.tools;
    thread.receipt = receipt;
    thread.descriptor.persistence = {
      ...thread.descriptor.persistence,
      agentId: thread.agentId,
      profile: thread.input.profile,
      workspaceId: thread.input.workspaceId,
      workspacePath: thread.input.workspacePath,
      bundleId: input.bundle.id,
      bundleDigest: input.bundle.digest,
      toolScope: readToolScope(input.tools),
    };
    return receipt;
  }

  async prepareRunMode(
    adapterId: string,
    input: { thread: HarnessThreadDescriptor; mode: ProviderRunMode },
  ): Promise<ProviderRunModeReceipt> {
    const thread = this.requireThread(adapterId, input.thread.id);
    await this.ensureAgent(thread);
    const result = await this.agentManager.prepareAgentRunMode(thread.agentId, input.mode);
    const failure =
      input.mode === "plan" && result.capability.kind !== "native" ? result.capability : null;
    return {
      id: `provider-mode-${randomUUID()}`,
      requestedMode: input.mode,
      status: failure ? failure.kind : "applied",
      nativeModeId: result.nativeModeId,
      reason: failure?.reason ?? null,
      appliedAt: new Date().toISOString(),
    };
  }

  async startExecution(
    adapterId: string,
    input: { thread: HarnessThreadDescriptor; execution: HarnessExecutionInput },
  ): Promise<HarnessExecutionDescriptor> {
    const thread = this.requireThread(adapterId, input.thread.id);
    await this.ensureAgent(thread);
    return this.startAgentRun(thread, input.execution);
  }

  async continueExecution(
    adapterId: string,
    input: { thread: HarnessThreadDescriptor; execution: HarnessExecutionInput },
  ): Promise<HarnessExecutionDescriptor> {
    const thread = this.requireThread(adapterId, input.thread.id);
    await this.ensureAgent(thread);
    const previous = this.executions.get(input.execution.executionId);
    if (previous) {
      if (previous.threadId !== thread.descriptor.id) {
        throw new Error(
          `Execution ${input.execution.executionId} belongs to a different provider thread`,
        );
      }
      await previous.settled;
    }
    return this.startAgentRun(thread, input.execution);
  }

  async resolveApproval(
    adapterId: string,
    input: {
      thread: HarnessThreadDescriptor;
      execution: HarnessExecutionDescriptor;
      approvalId: string;
      decision: "allow" | "deny" | "implement";
    },
  ): Promise<{ followUpPrompt: unknown | null }> {
    const thread = this.requireThread(adapterId, input.thread.id);
    const state = this.executions.get(input.execution.id);
    if (!state || state.threadId !== thread.descriptor.id) {
      throw new Error(`Execution ${input.execution.id} is not owned by this provider thread`);
    }
    const result = await this.agentManager.respondToPermission(thread.agentId, input.approvalId, {
      behavior: input.decision === "deny" ? "deny" : "allow",
      ...(input.decision === "implement" ? { selectedActionId: "implement" } : {}),
    });
    return { followUpPrompt: result?.followUpPrompt ?? null };
  }

  async interruptExecution(
    adapterId: string,
    execution: HarnessExecutionDescriptor,
  ): Promise<void> {
    const state = this.executions.get(execution.id);
    if (!state) {
      throw new Error(`Execution ${execution.id} is not active`);
    }
    const thread = this.requireThread(adapterId, state.threadId);
    const interrupted = await this.agentManager.cancelAgentRun(thread.agentId);
    if (!interrupted && state.running) {
      throw new Error(`Provider did not confirm interruption for ${execution.id}`);
    }
  }

  subscribeEvents(
    adapterId: string,
    execution: HarnessExecutionDescriptor,
    callback: (event: HarnessExecutionEvent) => void,
    cursor?: string,
  ): () => void {
    const state = this.executions.get(execution.id);
    if (!state) {
      throw new Error(`Execution ${execution.id} is not registered`);
    }
    this.requireThread(adapterId, state.threadId);
    const cursorIndex = cursor ? Number.parseInt(cursor, 10) : 0;
    for (const event of state.events.slice(Number.isFinite(cursorIndex) ? cursorIndex : 0)) {
      callback(event);
    }
    state.subscribers.add(callback);
    return () => state.subscribers.delete(callback);
  }

  async describePersistence(
    adapterId: string,
    thread: HarnessThreadDescriptor,
  ): Promise<Record<string, unknown> | null> {
    const state = this.requireThread(adapterId, thread.id);
    const agent = this.agentManager.getAgent(state.agentId);
    return {
      ...state.descriptor.persistence,
      ...(agent?.persistence ? { providerHandle: agent.persistence } : {}),
    };
  }

  async archiveThread(adapterId: string, thread: HarnessThreadDescriptor): Promise<void> {
    const state = this.requireThread(adapterId, thread.id);
    if (this.agentManager.getAgent(state.agentId)) {
      await this.agentManager.archiveAgent(state.agentId);
    }
  }

  async deleteOwnedThread(adapterId: string, thread: HarnessThreadDescriptor): Promise<void> {
    const state = this.requireThread(adapterId, thread.id);
    if (this.agentManager.getAgent(state.agentId)) {
      await this.agentManager.closeAgent(state.agentId);
    }
    this.threads.delete(thread.id);
  }

  async inspectLegacyThread(
    _adapterId: string,
    input: { legacyRoot: string; metadata: Record<string, unknown> },
  ): Promise<LegacyHarnessThreadInspection> {
    const nativeHandle =
      typeof input.metadata.nativeHandle === "string" ? input.metadata.nativeHandle : null;
    return { resumable: nativeHandle !== null, nativeHandle, metadata: input.metadata };
  }

  async adoptNativeThread(
    adapterId: string,
    input: {
      inspection: LegacyHarnessThreadInspection;
      workspaceId: string;
      workspacePath: string;
    },
  ): Promise<HarnessThreadDescriptor | null> {
    const handle = input.inspection.metadata.providerHandle as AgentPersistenceHandle | undefined;
    if (!input.inspection.resumable || !handle) {
      return null;
    }
    const agentId = randomUUID();
    const agent = await this.agentManager.resumeAgentFromPersistence(handle, undefined, agentId, {
      workspaceId: input.workspaceId,
      labels: { surface: "background-task" },
    });
    const descriptor: HarnessThreadDescriptor = {
      id: `provider-thread-${randomUUID()}`,
      adapterId,
      nativeHandle: agent.persistence?.nativeHandle ?? agent.persistence?.sessionId ?? null,
      persistence: {
        agentId,
        providerHandle: agent.persistence,
        profile: input.inspection.metadata.profile ?? {},
        workspaceId: input.workspaceId,
        workspacePath: input.workspacePath,
      },
    };
    this.threads.set(descriptor.id, {
      descriptor,
      input: {
        workspaceId: input.workspaceId,
        workspacePath: input.workspacePath,
        profile: (input.inspection.metadata.profile as Record<string, unknown>) ?? {},
        internal: true,
      },
      agentId,
      bundle: null,
      tools: null,
      receipt: null,
    });
    return descriptor;
  }

  async verifyResume(_adapterId: string, thread: HarnessThreadDescriptor): Promise<boolean> {
    const state = this.threads.get(thread.id);
    return state ? Boolean(this.agentManager.getAgent(state.agentId)) : false;
  }

  private requireThread(adapterId: string, threadId: string): HostedThreadState {
    const thread = this.threads.get(threadId);
    if (!thread || thread.descriptor.adapterId !== adapterId) {
      throw new Error(`Provider thread ${threadId} is not owned by adapter ${adapterId}`);
    }
    return thread;
  }

  private async ensureAgent(thread: HostedThreadState): Promise<void> {
    if (this.agentManager.getAgent(thread.agentId)) {
      return;
    }
    if (!thread.bundle || !thread.tools || !thread.receipt) {
      throw new Error(`Provider thread ${thread.descriptor.id} has no RuntimeBundle receipt`);
    }
    const profile = thread.input.profile as Partial<AgentSessionConfig>;
    const scope = readToolScope(thread.tools);
    const config = withThothRuntimeTools(
      {
        ...profile,
        provider: thread.descriptor.adapterId,
        cwd: thread.input.workspacePath,
        internal: true,
        systemPrompt: [profile.systemPrompt, thread.bundle.instructions]
          .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
          .join("\n\n"),
      } as AgentSessionConfig,
      { enabled: true, scope },
    );
    const providerHandle = thread.descriptor.persistence?.providerHandle as
      | AgentPersistenceHandle
      | null
      | undefined;
    const agent = providerHandle
      ? await this.agentManager.resumeAgentFromPersistence(providerHandle, config, thread.agentId, {
          workspaceId: thread.input.workspaceId,
          labels: {
            surface: "background-task",
            providerThreadId: thread.descriptor.id,
          },
        })
      : await this.agentManager.createAgent(config, thread.agentId, {
          labels: {
            surface: "background-task",
            providerThreadId: thread.descriptor.id,
          },
          workspaceId: thread.input.workspaceId,
          persistSession: true,
          persistInternal: true,
        });
    thread.descriptor.nativeHandle =
      agent.persistence?.nativeHandle ?? agent.persistence?.sessionId ?? null;
    thread.descriptor.persistence = {
      ...thread.descriptor.persistence,
      providerHandle: agent.persistence,
    };
  }

  private startAgentRun(
    thread: HostedThreadState,
    execution: HarnessExecutionInput,
  ): HarnessExecutionDescriptor {
    const descriptor: HarnessExecutionDescriptor = {
      id: execution.executionId,
      threadId: thread.descriptor.id,
      nativeTurnId: null,
    };
    let resolveSettled!: () => void;
    const settled = new Promise<void>((resolve) => {
      resolveSettled = resolve;
    });
    const state: HostedExecutionState = {
      descriptor,
      threadId: thread.descriptor.id,
      events: [],
      subscribers: new Set(),
      running: true,
      settled,
      resolveSettled,
    };
    this.executions.set(descriptor.id, state);
    const events = this.agentManager.streamAgent(thread.agentId, toPrompt(execution.prompt));
    void this.consumeAgentEvents(state, events);
    return descriptor;
  }

  private async consumeAgentEvents(
    state: HostedExecutionState,
    events: AsyncGenerator<AgentStreamEvent>,
  ): Promise<void> {
    try {
      for await (const payload of events) {
        if (payload.type === "turn_started") {
          state.descriptor.nativeTurnId = payload.providerTurnId ?? payload.turnId ?? null;
        }
        this.publishExecutionEvent(state, payload);
      }
    } catch (error) {
      this.publishExecutionEvent(state, {
        type: "turn_failed",
        provider: "harness",
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      state.running = false;
      state.resolveSettled();
    }
  }

  private publishExecutionEvent(state: HostedExecutionState, payload: unknown): void {
    const event: HarnessExecutionEvent = {
      id: `execution-event-${randomUUID()}`,
      executionId: state.descriptor.id,
      nativeCursor: String(state.events.length + 1),
      occurredAt: new Date().toISOString(),
      payload,
    };
    state.events.push(event);
    for (const subscriber of state.subscribers) {
      subscriber(event);
    }
  }
}
