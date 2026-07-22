import { createHash, randomUUID } from "node:crypto";
import type { Logger } from "pino";
import type {
  ExecutionApprovalDecision,
  ExecutionApprovalProjection,
  ExecutionProjection,
  HumanDecisionRecord,
  TaskCommand,
  TaskContextEnvelope,
  TaskProjection,
  TaskStrength,
} from "@thoth/protocol/task-authority";
import type { ThothGoalsCardModel, ThothTaskCardModel } from "@thoth/protocol/thoth/rpc-schemas";
import type { ThothRuntimeLoopStrength } from "@thoth/protocol/thoth-runtime-contract";
import { ExecutionRuntimeRegistry } from "./execution-runtime-registry.js";
import {
  WorkspaceAuthorityConflictError,
  type WorkspaceAuthorityStore,
} from "./workspace-authority-store.js";
import type { WorkspaceAuthorityManager } from "./workspace-authority-manager.js";
import { deriveDurableGoalId } from "./task-identity.js";

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

  register(input: {
    workspaceId: string;
    sourceAgentId: string;
    sourceTurnId: string;
    sourceGoalsCardId: string;
    mode: "quick" | "loop";
    loopStrength: ThothRuntimeLoopStrength | null;
    taskCard: ThothTaskCardModel;
    goalsCard: ThothGoalsCardModel;
    providerProfile: { adapterId: string; config: Record<string, unknown> };
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
    const goals = input.goalsCard.goals
      .slice()
      .sort((left, right) => left.order - right.order)
      .map((goal) => ({
        id: deriveDurableGoalId({
          taskId,
          sourceGoalId: goal.id,
          order: goal.order,
          lineage: "approved-goals",
        }),
        order: goal.order,
        title: goal.title,
        goal: goal.goal,
        constraints: goal.constraints,
        acceptance: goal.acceptance,
        status: "queued" as const,
        revision: 1,
      }));
    const firstGoal = goals[0];
    if (!firstGoal) {
      throw new Error("Task registration requires at least one approved goal");
    }
    const task: TaskProjection = {
      id: taskId,
      workspaceId: input.workspaceId,
      sourceAgentId: input.sourceAgentId,
      mode: input.mode,
      title: input.taskCard.title,
      goal: input.taskCard.goal,
      constraints: input.taskCard.constraints,
      acceptance: input.taskCard.acceptance,
      status: "queued",
      summary: "Approved task queued for execution.",
      currentGoalId: firstGoal.id,
      currentExecutionId: null,
      goals,
      latestReviewDirection: null,
      pendingDecision: null,
      budget: {
        strength,
        usedFailedReviews: 0,
        maxFailedReviews: failedReviewLimit(strength),
        activeDurationMs: 0,
        tokenCount: 0,
        toolCallCount: 0,
      },
      pendingControl: null,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };
    const registered = this.store(input.workspaceId).registerTask({
      task,
      sourceTurnId: input.sourceTurnId,
      sourceGoalsCardId: input.sourceGoalsCardId,
      providerProfileId,
      taskContract: input.taskCard,
      goalsContract: input.goalsCard,
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
  } {
    const store = this.store(workspaceId);
    const task = store.getTask(taskId);
    return {
      task,
      executions: task ? store.listExecutions(taskId) : [],
      decisions: task ? store.listDecisions(taskId) : [],
    };
  }

  search(workspaceId: string, query: string, limit: number): TaskProjection[] {
    return this.store(workspaceId).searchTasks(query, limit);
  }

  context(workspaceId: string, taskId: string, revision?: number): TaskContextEnvelope | null {
    return this.store(workspaceId).getTaskContext(taskId, revision);
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

function failedReviewLimit(strength: TaskStrength): number {
  switch (strength) {
    case "single":
      return 1;
    case "light":
      return 5;
    case "balanced":
      return 10;
    case "infinite":
      return 30;
  }
}
