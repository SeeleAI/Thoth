import { createHash, randomUUID } from "node:crypto";
import type { Logger } from "pino";
import type {
  ExecutionApprovalDecision,
  ExecutionApprovalProjection,
  ExecutionProjection,
  EvidenceRef,
  HumanDecisionRecord,
  ReviewDecisionProjection,
  TaskCommand,
  TaskContextEnvelope,
  TaskProjection,
  TaskStrength,
} from "@thoth/protocol/task-authority";
import type { IntentContractProjection } from "@thoth/protocol/intent-contract";
import type { ThothRuntimeLoopStrength } from "@thoth/protocol/thoth-runtime-contract";
import type { RuntimeAttachmentReceipt } from "@thoth/drivers/harness";
import type { ProviderRunModeReceipt } from "@thoth/protocol/provider-control";
import { createTaskAuthority } from "@thoth/core/authority";
import { ExecutionRuntimeRegistry } from "./execution-runtime-registry.js";
import {
  WorkspaceAuthorityConflictError,
  type WorkspaceAuthorityStore,
} from "./workspace-authority-store.js";
import type { WorkspaceAuthorityManager } from "./workspace-authority-manager.js";
import type { ToolGateway } from "./tool-gateway.js";

const QUICK_MUTATION_LEASE_TTL_MS = 30_000;

export interface TaskCommandScheduler {
  scheduleTask(input: { workspaceId: string; taskId: string }): Promise<void>;
  handleTaskCommand(input: {
    workspaceId: string;
    task: TaskProjection;
    execution: ExecutionProjection | null;
    command: TaskCommand;
  }): Promise<void>;
  continueAfterExecutionApproval(input: {
    workspaceId: string;
    task: TaskProjection;
    execution: ExecutionProjection;
    approval: ExecutionApprovalProjection;
  }): Promise<void>;
  handleTaskStopSettled(input: {
    workspaceId: string;
    task: TaskProjection;
    execution: ExecutionProjection | null;
  }): Promise<void>;
}

export interface TaskCommandResult {
  task: TaskProjection | null;
  execution: ExecutionProjection | null;
  conflict: boolean;
  duplicate: boolean;
  error: string | null;
}

export interface TaskClarifyHandoff {
  open(input: {
    sourceWorkspaceId: string;
    taskWorkspaceId: string;
    task: TaskProjection;
    decisionId: string;
  }): Promise<void>;
}

export interface TaskDecisionResult {
  task: TaskProjection | null;
  decision: HumanDecisionRecord | null;
  conflict: boolean;
  duplicate: boolean;
  error: string | null;
}

export interface ExecutionApprovalResult {
  task: TaskProjection | null;
  execution: ExecutionProjection | null;
  approval: ExecutionApprovalProjection | null;
  conflict: boolean;
  duplicate: boolean;
  error: string | null;
}

/** Public task authority facade. Session and UI code never manipulate SQLite. */
export class WorkspaceTaskCoordinator {
  readonly runtimes: ExecutionRuntimeRegistry;
  private gateway: ToolGateway | null = null;
  private clarifyHandoff: TaskClarifyHandoff | null = null;
  private readonly quickMutationSubscribers = new Map<string, Set<() => void>>();

  constructor(
    private readonly authority: WorkspaceAuthorityManager,
    private readonly logger: Logger,
    private scheduler: TaskCommandScheduler | null = null,
    runtimes = new ExecutionRuntimeRegistry(),
  ) {
    this.runtimes = runtimes;
  }

  setScheduler(scheduler: TaskCommandScheduler): void {
    this.scheduler = scheduler;
  }

  setToolGateway(gateway: ToolGateway): void {
    this.gateway = gateway;
  }

  setTaskClarifyHandoff(handoff: TaskClarifyHandoff): void {
    this.clarifyHandoff = handoff;
  }

  async openTaskClarify(input: {
    workspaceId: string;
    taskId: string;
    decisionId: string;
  }): Promise<void> {
    const task = this.store(input.workspaceId).getTask(input.taskId);
    if (!task || task.pendingDecision?.id !== input.decisionId) {
      throw new WorkspaceAuthorityConflictError("Task Clarify handoff is no longer current");
    }
    if (!this.clarifyHandoff) throw new Error("Task Clarify handoff is not configured");
    await this.clarifyHandoff.open({
      sourceWorkspaceId: task.sourceAgentWorkspaceId,
      taskWorkspaceId: input.workspaceId,
      task,
      decisionId: input.decisionId,
    });
  }

  commitClarifyContractRevision(input: {
    taskWorkspaceId: string;
    taskId: string;
    sourceAgentWorkspaceId: string;
    sourceAgentId: string;
    decisionRequestId: string;
    contract: IntentContractProjection;
    decisionRecordIds: string[];
    commandId: string;
  }): { task: TaskProjection; duplicate: boolean } {
    return this.store(input.taskWorkspaceId).applyTaskContractRevisionFromHandoff({
      taskId: input.taskId,
      sourceAgentWorkspaceId: input.sourceAgentWorkspaceId,
      sourceAgentId: input.sourceAgentId,
      decisionRequestId: input.decisionRequestId,
      contract: input.contract,
      decisionRecordIds: input.decisionRecordIds,
      commandId: input.commandId,
    });
  }

  async continueAfterContractRevision(input: {
    workspaceId: string;
    taskId: string;
  }): Promise<void> {
    const task = this.store(input.workspaceId).getTask(input.taskId);
    if (!task || task.status !== "reorienting" || task.pendingDecision) {
      throw new WorkspaceAuthorityConflictError(
        "Task is not ready for fresh reorientation after its contract revision",
      );
    }
    if (!this.scheduler) throw new Error("Task scheduler is not configured");
    await this.scheduler.scheduleTask(input);
  }

  get toolGateway(): ToolGateway {
    if (!this.gateway) throw new Error("ToolGateway is not configured");
    return this.gateway;
  }

  subscribeQuickMutationReady(workspaceId: string, subscriber: () => void): () => void {
    const subscribers = this.quickMutationSubscribers.get(workspaceId) ?? new Set<() => void>();
    subscribers.add(subscriber);
    this.quickMutationSubscribers.set(workspaceId, subscribers);
    return () => {
      subscribers.delete(subscriber);
      if (subscribers.size === 0) this.quickMutationSubscribers.delete(workspaceId);
    };
  }

  wakeQuickMutation(workspaceId: string): void {
    for (const subscriber of this.quickMutationSubscribers.get(workspaceId) ?? []) {
      queueMicrotask(subscriber);
    }
  }

  notifyMutationLeaseReleased(workspaceId: string): void {
    this.wakeQuickMutation(workspaceId);
    void this.scheduler
      ?.scheduleTask({ workspaceId, taskId: "workspace-mutation-ready" })
      .catch((error: unknown) => {
        this.logger.error({ err: error, workspaceId }, "Failed to resume Workspace mutation queue");
      });
  }

  register(input: {
    workspaceId: string;
    sourceAgentWorkspaceId?: string;
    sourceAgentId: string;
    sourceTurnId: string;
    sourceContractCardId: string;
    mode: "quick" | "loop";
    loopStrength: ThothRuntimeLoopStrength | null;
    intentContract: IntentContractProjection;
    providerProfile: { adapterId: string; config: Record<string, unknown> };
    origin?: TaskProjection["origin"];
  }): { task: TaskProjection; created: boolean } {
    const now = new Date().toISOString();
    const strength = normalizeStrength(input.loopStrength);
    const profileJson = JSON.stringify({
      adapterId: input.providerProfile.adapterId,
      config: input.providerProfile.config,
    });
    const providerProfileId = `provider-profile-${createHash("sha256")
      .update(profileJson)
      .digest("hex")}`;
    this.authority.catalog.upsertProviderProfile({
      id: providerProfileId,
      adapterId: input.providerProfile.adapterId,
      config: input.providerProfile.config,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
    const taskId = `task-${randomUUID()}`;
    const task = {
      ...createTaskAuthority({
        id: taskId,
        workspaceId: input.workspaceId,
        sourceAgentWorkspaceId:
          input.sourceAgentWorkspaceId ??
          this.authority.catalog.locateAgent(input.sourceAgentId) ??
          input.workspaceId,
        sourceAgentId: input.sourceAgentId,
        mode: input.mode,
        intentContract: input.intentContract,
        strength,
        now,
      }),
      origin: input.origin ?? null,
    };
    const registered = this.store(input.workspaceId).registerTask({
      task,
      sourceTurnId: input.sourceTurnId,
      sourceContractCardId: input.sourceContractCardId,
      providerProfileId,
    });
    if (registered.created && input.mode === "loop") {
      void this.scheduler
        ?.scheduleTask({ workspaceId: input.workspaceId, taskId: registered.task.id })
        .catch((error: unknown) => {
          this.logger.error(
            { err: error, workspaceId: input.workspaceId, taskId: registered.task.id },
            "Failed to schedule a registered task",
          );
        });
    }
    return registered;
  }

  beginQuickExecution(input: {
    workspaceId: string;
    taskId: string;
    executionId: string;
    generation: string;
    attachment: RuntimeAttachmentReceipt;
    runModeReceipt: ProviderRunModeReceipt | null;
  }): ExecutionProjection | null {
    const store = this.store(input.workspaceId);
    const task = store.getTask(input.taskId);
    if (!task || task.mode !== "quick" || task.status !== "queued") {
      throw new WorkspaceAuthorityConflictError("Quick Task is no longer queued for execution");
    }
    if (store.getNextMutationTask()?.id !== task.id) return null;
    if (
      !store.claimMutationLease({
        taskId: task.id,
        executionId: input.executionId,
        generation: input.generation,
        ttlMs: QUICK_MUTATION_LEASE_TTL_MS,
      })
    ) {
      return null;
    }
    try {
      const now = new Date().toISOString();
      const created = store.createExecution({
        execution: {
          id: input.executionId,
          taskId: task.id,
          workUnitId: null,
          cycleId: null,
          phase: "quick_exec",
          providerThreadId: input.attachment.threadId,
          status: "starting",
          generation: input.generation,
          attachment: null,
          runModeReceipt: input.runModeReceipt,
          pendingApproval: null,
          startedAt: now,
          lastActivityAt: now,
          completedAt: null,
          summary: null,
          revision: 1,
        },
        providerThread: {
          id: input.attachment.threadId,
          adapterId: input.attachment.adapterId,
          nativeHandle: input.attachment.threadId,
          persistence: null,
        },
      });
      store.recordAttachment({ executionId: created.id, receipt: input.attachment });
      const running = store.updateExecution({
        executionId: created.id,
        generation: created.generation,
        expectedRevision: created.revision,
        status: "running",
        summary: "Quick execution is running in the visible Provider thread.",
      });
      if (!running) throw new Error(`Quick execution ${created.id} could not enter running state`);
      return store.getExecution(created.id) ?? running;
    } catch (error) {
      store.releaseMutationLease({
        taskId: task.id,
        executionId: input.executionId,
        generation: input.generation,
      });
      throw error;
    }
  }

  renewQuickExecution(input: {
    workspaceId: string;
    taskId: string;
    executionId: string;
    generation: string;
  }): boolean {
    return this.store(input.workspaceId).renewMutationLease({
      taskId: input.taskId,
      executionId: input.executionId,
      generation: input.generation,
      ttlMs: QUICK_MUTATION_LEASE_TTL_MS,
    });
  }

  settleQuickExecution(input: {
    workspaceId: string;
    taskId: string;
    executionId: string;
    generation: string;
    status: "succeeded" | "failed";
    summary: string;
  }): void {
    const store = this.store(input.workspaceId);
    try {
      store.settleQuickExecution(input);
    } finally {
      store.releaseMutationLease({
        taskId: input.taskId,
        executionId: input.executionId,
        generation: input.generation,
      });
      this.notifyMutationLeaseReleased(input.workspaceId);
    }
  }

  list(workspaceId: string): TaskProjection[] {
    return this.store(workspaceId).listTasks();
  }

  get(
    workspaceId: string,
    taskId: string,
  ): {
    task: TaskProjection | null;
    executions: ExecutionProjection[];
    decisions: HumanDecisionRecord[];
    reviews: ReviewDecisionProjection[];
    evidence: EvidenceRef[];
  } {
    const store = this.store(workspaceId);
    const task = store.getTask(taskId);
    const context = task ? this.authority.getTaskContext(workspaceId, taskId) : null;
    return {
      task,
      executions: task ? store.listExecutions(taskId) : [],
      decisions: context?.decisions ?? [],
      reviews: task ? store.listReviewDecisions(taskId) : [],
      evidence: task ? store.listEvidence(taskId) : [],
    };
  }

  search(workspaceId: string, query: string, limit: number): TaskProjection[] {
    return this.store(workspaceId).searchTasks(query, limit);
  }

  context(workspaceId: string, taskId: string, revision?: number): TaskContextEnvelope | null {
    return this.authority.getTaskContext(workspaceId, taskId, revision);
  }

  timeline(input: {
    workspaceId: string;
    taskId: string;
    executionId: string;
    beforeSeq?: number;
    limit: number;
  }): {
    execution: ExecutionProjection | null;
    entries: Array<{ seq: number; occurredAt: string; item: unknown }>;
    nextBeforeSeq: number | null;
  } {
    const store = this.store(input.workspaceId);
    const execution = store.getExecution(input.executionId);
    if (!execution || execution.taskId !== input.taskId) {
      return { execution: null, entries: [], nextBeforeSeq: null };
    }
    const entries = store.readTimeline(input);
    return {
      execution,
      entries,
      nextBeforeSeq: entries.length === input.limit ? (entries[0]?.seq ?? null) : null,
    };
  }

  command(input: {
    workspaceId: string;
    taskId: string;
    command: TaskCommand;
    expectedRevision: number;
    commandId: string;
    actorId: string;
    clientId: string;
    deviceId?: string | null;
  }): TaskCommandResult {
    const store = this.store(input.workspaceId);
    try {
      const result = store.requestCommand(input);
      if (!result.duplicate) {
        void this.scheduler
          ?.handleTaskCommand({
            workspaceId: input.workspaceId,
            task: result.task,
            execution: result.execution,
            command: input.command,
          })
          .catch((error: unknown) => {
            this.logger.error(
              { err: error, workspaceId: input.workspaceId, taskId: input.taskId },
              "Task scheduler rejected a durable command",
            );
          });
        if (input.command === "stop") {
          void this.finishStop(store, result.task, result.execution);
        }
      }
      return { ...result, conflict: false, error: null };
    } catch (error) {
      const task = store.getTask(input.taskId);
      return {
        task,
        execution: task?.currentExecutionId ? store.getExecution(task.currentExecutionId) : null,
        conflict: error instanceof WorkspaceAuthorityConflictError,
        duplicate: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async resolveExecutionApproval(input: {
    workspaceId: string;
    taskId: string;
    executionId: string;
    approvalId: string;
    decision: ExecutionApprovalDecision;
    expectedRevision: number;
    commandId: string;
    actorId: string;
    clientId: string;
    deviceId?: string | null;
    recordHumanDecision: boolean;
  }): Promise<ExecutionApprovalResult> {
    const store = this.store(input.workspaceId);
    try {
      const result = store.resolveExecutionApproval(input);
      if (!result.duplicate) {
        await this.scheduler?.continueAfterExecutionApproval({
          workspaceId: input.workspaceId,
          task: result.task,
          execution: result.execution,
          approval: result.approval,
        });
      }
      const latestTask = store.getTask(input.taskId) ?? result.task;
      const latestExecution = store.getExecution(input.executionId) ?? result.execution;
      return {
        task: latestTask,
        execution: latestExecution,
        approval: store.getExecutionApproval(input.approvalId) ?? result.approval,
        conflict: false,
        duplicate: result.duplicate,
        error: null,
      };
    } catch (error) {
      const task = store.getTask(input.taskId);
      return {
        task,
        execution: task?.currentExecutionId
          ? store.getExecution(task.currentExecutionId)
          : store.getExecution(input.executionId),
        approval: store.getExecutionApproval(input.approvalId),
        conflict: error instanceof WorkspaceAuthorityConflictError,
        duplicate: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  answerDecision(input: {
    workspaceId: string;
    taskId: string;
    decisionId: string;
    optionId: string;
    note?: string;
    expectedRevision: number;
    commandId: string;
    actorId: string;
    clientId: string;
    deviceId?: string | null;
  }): TaskDecisionResult {
    const store = this.store(input.workspaceId);
    try {
      const result = store.answerTaskDecision(input);
      if (!result.duplicate) {
        void this.scheduler
          ?.scheduleTask({ workspaceId: input.workspaceId, taskId: input.taskId })
          .catch((error: unknown) => {
            this.logger.error(
              { err: error, workspaceId: input.workspaceId, taskId: input.taskId },
              "Task scheduler rejected a recorded user decision",
            );
          });
      }
      return { ...result, conflict: false, error: null };
    } catch (error) {
      return {
        task: store.getTask(input.taskId),
        decision: null,
        conflict: error instanceof WorkspaceAuthorityConflictError,
        duplicate: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  recordProviderPermission(input: {
    workspaceId: string;
    agentId: string;
    providerThreadId?: string | null;
    requestId: string;
    displayed: unknown;
    rawAnswer: unknown;
    actorId: string;
    clientId: string;
    deviceId?: string | null;
  }): HumanDecisionRecord {
    return this.store(input.workspaceId).recordProviderPermissionDecision(input).decision;
  }

  private store(workspaceId: string): WorkspaceAuthorityStore {
    return this.authority.forWorkspace(workspaceId);
  }

  private async finishStop(
    store: WorkspaceAuthorityStore,
    task: TaskProjection,
    execution: ExecutionProjection | null,
  ): Promise<void> {
    const active = execution?.status === "cancel_requested";
    const interruptResult = active
      ? await this.runtimes.interrupt({ workspaceId: task.workspaceId, execution })
      : "confirmed";
    try {
      const settled = store.settleStop({
        taskId: task.id,
        executionId: execution?.id ?? null,
        generation: execution?.generation,
        orphaned: active && interruptResult === "orphaned",
      });
      try {
        await this.scheduler?.handleTaskStopSettled({
          workspaceId: task.workspaceId,
          task: settled.task,
          execution: settled.execution,
        });
      } catch (error) {
        this.logger.warn(
          { err: error, workspaceId: task.workspaceId, taskId: task.id },
          "Stopped Task runtime cleanup failed",
        );
      }
    } catch (error) {
      this.logger.warn(
        { err: error, workspaceId: task.workspaceId, taskId: task.id },
        "Stop completion was fenced by newer authority",
      );
    }
  }
}

function normalizeStrength(strength: ThothRuntimeLoopStrength | null): TaskStrength {
  switch (strength) {
    case "light":
      return "light";
    case "balanced":
      return "balanced";
    case "run_until_stopped":
      return "infinite";
    case "auto":
    case "one_plan_one_do":
    case null:
      return "single";
  }
}
