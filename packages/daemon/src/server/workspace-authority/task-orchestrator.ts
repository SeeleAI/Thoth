import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import {
  HarnessAdapterRegistry,
  THOTH_RUNTIME_BUNDLE_CATALOG,
  loadRuntimeBundle,
  type HarnessAdapter,
  type HarnessExecutionDescriptor,
  type HarnessExecutionEvent,
  type HarnessThreadDescriptor,
  type RuntimeAttachmentReceipt,
} from "@thoth/drivers/harness";
import type {
  ExecutionProjection,
  TaskContextEnvelope,
  TaskProjection,
} from "@thoth/protocol/task-authority";
import type {
  ThothLoopPlanExecResultInput,
  ThothLoopReportBlockedInput,
  ThothLoopReviewIndependentAssessmentInput,
  ThothLoopReviewVerdictInput,
} from "@thoth/protocol/thoth-runtime-contract";
import { RuntimeBundleStore } from "./runtime-bundle-store.js";
import type { WorkspaceAuthorityManager } from "./workspace-authority-manager.js";
import type { WorkspaceAuthorityStore } from "./workspace-authority-store.js";
import type { TaskCommandScheduler, WorkspaceTaskCoordinator } from "./task-coordinator.js";
import {
  TaskToolGateway,
  type TaskSemanticResultSink,
  type TaskToolExecutionBinding,
} from "./task-tool-gateway.js";

const LEASE_TTL_MS = 2 * 60 * 1000;
const LEASE_HEARTBEAT_MS = Math.floor(LEASE_TTL_MS / 3);

interface ActivePhase {
  workspaceId: string;
  taskId: string;
  goalId: string;
  executionId: string;
  generation: string;
  phase: "planexec" | "review";
  adapter: HarnessAdapter;
  thread: HarnessThreadDescriptor;
  descriptor: HarnessExecutionDescriptor | null;
  unsubscribeEvents: (() => void) | null;
  unbindGateway: (() => void) | null;
  unregisterRuntime: (() => void) | null;
  heartbeat: ReturnType<typeof setInterval> | null;
  repairUsed: boolean;
  semanticAccepted: boolean;
  receipt: RuntimeAttachmentReceipt;
  eventTail: Promise<void>;
}

function isTerminalEvent(payload: unknown): "completed" | "failed" | "canceled" | null {
  if (!payload || typeof payload !== "object" || !("type" in payload)) {
    return null;
  }
  switch ((payload as { type?: unknown }).type) {
    case "turn_completed":
      return "completed";
    case "turn_failed":
      return "failed";
    case "turn_canceled":
      return "canceled";
    default:
      return null;
  }
}

function chooseToolTransport(adapter: HarnessAdapter): "native" | "mcp" | "acp" {
  const supported = adapter.capabilities().toolAttachment;
  if (supported.includes("native")) {
    return "native";
  }
  if (supported.includes("acp")) {
    return "acp";
  }
  if (supported.includes("mcp")) {
    return "mcp";
  }
  throw new Error(`HarnessAdapter ${adapter.id} cannot attach Thoth semantic tools`);
}

function semanticContext(context: TaskContextEnvelope, goalId: string): string {
  const goal = context.task.goals.find((candidate) => candidate.id === goalId);
  if (!goal) {
    throw new Error(`Task context is missing Goal ${goalId}`);
  }
  return JSON.stringify(
    {
      task: {
        title: context.task.title,
        goal: context.task.goal,
        constraints: context.task.constraints,
        acceptance: context.task.acceptance,
      },
      currentGoal: {
        title: goal.title,
        goal: goal.goal,
        constraints: goal.constraints,
        acceptance: goal.acceptance,
      },
      humanDecisions: context.decisions.map((decision) => ({
        kind: decision.kind,
        displayed: decision.displayed,
        answer: decision.rawAnswer,
        normalized: decision.normalized,
        decidedAt: decision.decidedAt,
      })),
      taskMemory: context.blackboard.map((entry) => ({
        kind: entry.kind,
        producer: entry.producer,
        content: entry.content,
        createdAt: entry.createdAt,
      })),
    },
    null,
    2,
  );
}

function planExecPrompt(context: TaskContextEnvelope, goalId: string): string {
  return [
    "Act as PlanExec for the current approved Goal.",
    "Inspect workspace reality, plan, implement, validate, and then submit exactly one semantic PlanExec result through the attached Thoth tool.",
    "Do not ask the user about implementation choices you can own or discover. Report only a real external or user-owned blocker.",
    "Task Blackboard context:",
    semanticContext(context, goalId),
  ].join("\n\n");
}

function reviewPrompt(context: TaskContextEnvelope, goalId: string): string {
  const reviewContext: TaskContextEnvelope = {
    ...context,
    blackboard: context.blackboard.filter((entry) => entry.kind !== "planexec_report"),
  };
  return [
    "Act as the independent Review for the current approved Goal.",
    "Inspect workspace reality first. Before receiving PlanExec's semantic account, submit your independent assessment through the attached assessment tool.",
    "After the tool returns PlanExec's account, compare it with reality and submit exactly one of the six Review outcomes.",
    "Do not mutate the workspace and do not expose runtime mechanics.",
    "Task Blackboard context available before independent assessment:",
    semanticContext(reviewContext, goalId),
  ].join("\n\n");
}

/** Workspace-serial Task scheduler and provider-neutral Loop state machine. */
export class WorkspaceTaskOrchestrator implements TaskCommandScheduler, TaskSemanticResultSink {
  readonly toolGateway: TaskToolGateway;

  private readonly loopBundle = loadRuntimeBundle("thoth.loop", THOTH_RUNTIME_BUNDLE_CATALOG);
  private readonly activeByWorkspace = new Map<string, ActivePhase>();
  private readonly activeByExecution = new Map<string, ActivePhase>();
  private readonly workspaceTails = new Map<string, Promise<void>>();

  constructor(
    private readonly authority: WorkspaceAuthorityManager,
    private readonly coordinator: WorkspaceTaskCoordinator,
    private readonly adapters: HarnessAdapterRegistry,
    private readonly bundleStore: RuntimeBundleStore,
    private readonly logger: Logger,
  ) {
    this.toolGateway = new TaskToolGateway(this);
    this.bundleStore.persist(this.loopBundle);
    this.coordinator.setScheduler(this);
  }

  initialize(): void {
    for (const workspace of this.authority.catalog.listWorkspaces()) {
      const store = this.authority.forWorkspace(workspace.id);
      store.recoverInterruptedExecutionsAfterRestart();
      if (store.listTasks().some((task) => task.mode === "loop" && task.status === "queued")) {
        void this.scheduleTask({ workspaceId: workspace.id, taskId: "startup" });
      }
    }
  }

  async scheduleTask(input: { workspaceId: string; taskId: string }): Promise<void> {
    const previous = this.workspaceTails.get(input.workspaceId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(() => this.runWorkspace(input.workspaceId))
      .finally(() => {
        if (this.workspaceTails.get(input.workspaceId) === next) {
          this.workspaceTails.delete(input.workspaceId);
        }
      });
    this.workspaceTails.set(input.workspaceId, next);
    await next;
  }

  async handleTaskCommand(input: {
    workspaceId: string;
    task: TaskProjection;
    execution: ExecutionProjection | null;
    command: "pause" | "resume" | "raise_budget" | "review_only";
  }): Promise<void> {
    if (
      input.command === "resume" ||
      input.command === "raise_budget" ||
      input.command === "review_only"
    ) {
      await this.scheduleTask({ workspaceId: input.workspaceId, taskId: input.task.id });
    }
  }

  submitPlanExec(input: {
    binding: TaskToolExecutionBinding;
    result: ThothLoopPlanExecResultInput;
    providerTurnId?: string;
    callId: string;
  }): boolean {
    try {
      const accepted = this.authority.forWorkspace(input.binding.workspaceId).acceptPlanExecResult({
        executionId: input.binding.executionId,
        generation: input.binding.generation,
        result: input.result,
        callId: input.callId,
      });
      if (accepted) {
        const active = this.activeByExecution.get(input.binding.executionId);
        if (active) active.semanticAccepted = true;
      }
      return accepted;
    } catch (error) {
      this.logger.warn({ err: error, binding: input.binding }, "Rejected stale PlanExec result");
      return false;
    }
  }

  submitReviewAssessment(input: {
    binding: TaskToolExecutionBinding;
    assessment: ThothLoopReviewIndependentAssessmentInput;
    providerTurnId?: string;
  }): string | null {
    try {
      return this.authority.forWorkspace(input.binding.workspaceId).acceptReviewAssessment({
        executionId: input.binding.executionId,
        generation: input.binding.generation,
        assessment: input.assessment,
      });
    } catch (error) {
      this.logger.warn({ err: error, binding: input.binding }, "Rejected stale Review assessment");
      return null;
    }
  }

  submitReviewVerdict(input: {
    binding: TaskToolExecutionBinding;
    verdict: ThothLoopReviewVerdictInput;
    providerTurnId?: string;
    callId: string;
  }): boolean {
    try {
      const accepted = this.authority.forWorkspace(input.binding.workspaceId).acceptReviewVerdict({
        executionId: input.binding.executionId,
        generation: input.binding.generation,
        verdict: input.verdict,
        callId: input.callId,
      });
      if (accepted) {
        const active = this.activeByExecution.get(input.binding.executionId);
        if (active) active.semanticAccepted = true;
      }
      return accepted;
    } catch (error) {
      this.logger.warn({ err: error, binding: input.binding }, "Rejected stale Review verdict");
      return false;
    }
  }

  reportBlocked(input: {
    binding: TaskToolExecutionBinding;
    report: ThothLoopReportBlockedInput;
    providerTurnId?: string;
  }): boolean {
    try {
      const accepted = this.authority
        .forWorkspace(input.binding.workspaceId)
        .acceptExecutionBlocker({
          executionId: input.binding.executionId,
          generation: input.binding.generation,
          report: input.report,
        });
      if (accepted) {
        const active = this.activeByExecution.get(input.binding.executionId);
        if (active) active.semanticAccepted = true;
      }
      return accepted;
    } catch (error) {
      this.logger.warn({ err: error, binding: input.binding }, "Rejected stale blocker report");
      return false;
    }
  }

  private async runWorkspace(workspaceId: string): Promise<void> {
    if (this.activeByWorkspace.has(workspaceId)) {
      return;
    }
    const store = this.authority.forWorkspace(workspaceId);
    if (store.hasMutationQuarantine()) {
      return;
    }
    const task = store
      .listTasks()
      .filter((candidate) => candidate.mode === "loop" && candidate.status === "queued")
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0];
    if (!task?.currentGoalId) {
      return;
    }
    await this.launchPhase(store, task, task.currentGoalId);
  }

  private async launchPhase(
    store: WorkspaceAuthorityStore,
    task: TaskProjection,
    goalId: string,
  ): Promise<void> {
    const phase = this.nextPhase(store, task, goalId);
    const executionId = `execution-${randomUUID()}`;
    const generation = randomUUID();
    const phaseRunId = `phase-run-${randomUUID()}`;
    if (
      !store.claimMutationLease({
        taskId: task.id,
        executionId,
        generation,
        ttlMs: LEASE_TTL_MS,
      })
    ) {
      return;
    }

    try {
      const metadata = store.getTaskRuntimeMetadata(task.id);
      if (!metadata) {
        throw new Error(`Task ${task.id} is missing provider runtime metadata`);
      }
      const profile = this.authority.catalog.getProviderProfile(metadata.providerProfileId);
      if (!profile?.enabled) {
        throw new Error(`Provider profile ${metadata.providerProfileId} is unavailable`);
      }
      const adapter = this.adapters.get(profile.adapterId);
      const workspace = this.authority.catalog.getWorkspace(task.workspaceId);
      if (!workspace) {
        throw new Error(`Workspace ${task.workspaceId} is missing from catalog`);
      }
      const reusable =
        phase === "planexec" ? store.findLatestPlanExecThread(task.id, goalId) : null;
      const lineageParent =
        phase === "planexec" && !reusable
          ? store.findLatestPlanExecLineageThread(task.id, goalId)
          : null;
      let thread: HarnessThreadDescriptor;
      let continuation = false;
      if (reusable) {
        thread = await adapter.resumeThread({
          descriptor: {
            id: reusable.id,
            adapterId: reusable.adapterId,
            nativeHandle: reusable.nativeHandle,
            persistence: reusable.persistence,
          },
          workspaceId: task.workspaceId,
          workspacePath: workspace.canonicalPath,
        });
        continuation = true;
      } else {
        thread = await adapter.createThread({
          workspaceId: task.workspaceId,
          workspacePath: workspace.canonicalPath,
          profile: profile.config,
          internal: true,
        });
      }
      const now = new Date().toISOString();
      const execution = store.createExecution({
        execution: {
          id: executionId,
          taskId: task.id,
          goalId,
          phaseRunId,
          phase,
          providerThreadId: thread.id,
          status: "starting",
          generation,
          attachment: null,
          startedAt: now,
          lastActivityAt: now,
          completedAt: null,
          summary: null,
          revision: 1,
        },
        providerThread: {
          id: thread.id,
          adapterId: thread.adapterId,
          nativeHandle: thread.nativeHandle,
          persistence: thread.persistence,
          lineageParentId: lineageParent?.id ?? null,
        },
      });
      const transport = chooseToolTransport(adapter);
      const receipt = await adapter.attachRuntimeBundle({
        thread,
        bundle: this.loopBundle,
        tools: {
          transport,
          catalog: { scope: phase === "planexec" ? "loop_planexec" : "loop_review" },
        },
      });
      store.recordAttachment({ executionId, receipt });
      const context = store.getTaskContext(task.id);
      if (!context) {
        throw new Error(`Task ${task.id} context could not be built`);
      }
      const agentId =
        thread.persistence && typeof thread.persistence.agentId === "string"
          ? thread.persistence.agentId
          : null;
      if (!agentId) {
        throw new Error(
          `Harness thread ${thread.id} did not disclose its daemon-owned Agent binding`,
        );
      }
      const active: ActivePhase = {
        workspaceId: task.workspaceId,
        taskId: task.id,
        goalId,
        executionId,
        generation,
        phase,
        adapter,
        thread,
        descriptor: null,
        unsubscribeEvents: null,
        unbindGateway: null,
        unregisterRuntime: null,
        heartbeat: null,
        repairUsed: false,
        semanticAccepted: false,
        receipt,
        eventTail: Promise.resolve(),
      };
      this.activeByWorkspace.set(task.workspaceId, active);
      this.activeByExecution.set(executionId, active);
      active.unbindGateway = this.toolGateway.bind(agentId, {
        workspaceId: task.workspaceId,
        taskId: task.id,
        goalId,
        executionId,
        generation,
        phase,
      });
      const executionInput = {
        executionId,
        generation,
        prompt:
          phase === "planexec" ? planExecPrompt(context, goalId) : reviewPrompt(context, goalId),
        attachment: receipt,
      };
      const descriptor = continuation
        ? await adapter.continueExecution({ thread, execution: executionInput })
        : await adapter.startExecution({ thread, execution: executionInput });
      active.descriptor = descriptor;
      active.unregisterRuntime = this.coordinator.runtimes.register({
        workspaceId: task.workspaceId,
        taskId: task.id,
        generation,
        adapter,
        thread,
        execution: descriptor,
      });
      active.unsubscribeEvents = adapter.subscribeEvents(descriptor, (event) => {
        active.eventTail = active.eventTail
          .then(() => this.handleExecutionEvent(active, event))
          .catch((error: unknown) => {
            this.logger.error(
              { err: error, executionId: active.executionId },
              "Failed to process Harness execution event",
            );
          });
      });
      active.heartbeat = setInterval(() => {
        const renewed = store.renewMutationLease({
          taskId: task.id,
          executionId,
          generation,
          ttlMs: LEASE_TTL_MS,
        });
        if (!renewed) {
          void this.interruptForLostLease(active);
        }
      }, LEASE_HEARTBEAT_MS);
      active.heartbeat.unref();
      const current = store.getExecution(execution.id);
      if (current?.status === "starting") {
        store.updateExecution({
          executionId,
          generation,
          expectedRevision: current.revision,
          status: "running",
        });
      }
    } catch (error) {
      store.interruptExecution({
        executionId,
        generation,
        summary: error instanceof Error ? error.message : String(error),
      });
      store.releaseMutationLease({ taskId: task.id, executionId, generation });
      this.cleanupActive(executionId);
      throw error;
    }
  }

  private nextPhase(
    store: WorkspaceAuthorityStore,
    task: TaskProjection,
    goalId: string,
  ): "planexec" | "review" {
    if (task.pendingControl === "review_only") {
      return "review";
    }
    const latest = store
      .listExecutions(task.id)
      .filter((execution) => execution.goalId === goalId)
      .at(-1);
    return latest?.phase === "planexec" && latest.status === "succeeded" ? "review" : "planexec";
  }

  private async handleExecutionEvent(
    active: ActivePhase,
    event: HarnessExecutionEvent,
  ): Promise<void> {
    const store = this.authority.forWorkspace(active.workspaceId);
    store.appendTimeline({
      executionId: active.executionId,
      occurredAt: event.occurredAt,
      item: event.payload,
    });
    const payloadType =
      event.payload && typeof event.payload === "object" && "type" in event.payload
        ? (event.payload as { type?: unknown }).type
        : null;
    if (payloadType === "turn_started") {
      store.markExecutionAwaitingProvider({
        executionId: active.executionId,
        generation: active.generation,
      });
    }
    const terminal = isTerminalEvent(event.payload);
    if (!terminal) {
      return;
    }
    const execution = store.getExecution(active.executionId);
    if (
      active.semanticAccepted ||
      execution?.status === "succeeded" ||
      execution?.status === "failed"
    ) {
      await this.finishPhase(active);
      return;
    }
    if (terminal === "completed" && !active.repairUsed) {
      active.repairUsed = true;
      await this.launchRepairContinuation(active);
      return;
    }
    const summary =
      terminal === "completed"
        ? "Provider completed twice without submitting the required semantic phase result."
        : terminal === "canceled"
          ? "Provider execution was canceled before a semantic phase result was submitted."
          : "Provider execution failed before a semantic phase result was submitted.";
    store.interruptExecution({
      executionId: active.executionId,
      generation: active.generation,
      summary,
    });
    await this.finishPhase(active);
  }

  private async launchRepairContinuation(active: ActivePhase): Promise<void> {
    if (!active.descriptor) {
      throw new Error(`Execution ${active.executionId} has no provider descriptor`);
    }
    active.unsubscribeEvents?.();
    const descriptor = await active.adapter.continueExecution({
      thread: active.thread,
      execution: {
        executionId: active.executionId,
        generation: active.generation,
        prompt:
          active.phase === "planexec"
            ? "Your provider turn ended without the required PlanExec semantic result. Preserve completed work and submit thoth_loop_submit_planexec_result exactly once now."
            : "Your provider turn ended without the required Review verdict. Preserve your independent assessment and submit thoth_loop_submit_review_verdict exactly once now.",
        attachment: active.receipt,
      },
    });
    active.descriptor = descriptor;
    active.unregisterRuntime?.();
    active.unregisterRuntime = this.coordinator.runtimes.register({
      workspaceId: active.workspaceId,
      taskId: active.taskId,
      generation: active.generation,
      adapter: active.adapter,
      thread: active.thread,
      execution: descriptor,
    });
    active.unsubscribeEvents = active.adapter.subscribeEvents(descriptor, (event) => {
      active.eventTail = active.eventTail
        .then(() => this.handleExecutionEvent(active, event))
        .catch((error: unknown) => {
          this.logger.error(
            { err: error, executionId: active.executionId },
            "Failed to process repair continuation event",
          );
        });
    });
  }

  private async interruptForLostLease(active: ActivePhase): Promise<void> {
    if (active.descriptor) {
      await active.adapter.interruptExecution(active.descriptor).catch(() => undefined);
    }
    this.authority.forWorkspace(active.workspaceId).interruptExecution({
      executionId: active.executionId,
      generation: active.generation,
      summary: "Workspace mutation lease was lost while the provider execution was active.",
    });
    await this.finishPhase(active);
  }

  private async finishPhase(active: ActivePhase): Promise<void> {
    const store = this.authority.forWorkspace(active.workspaceId);
    const persistence = await active.adapter.describePersistence(active.thread).catch(() => null);
    store.updateProviderThread({
      threadId: active.thread.id,
      nativeHandle: active.thread.nativeHandle,
      persistence,
    });
    store.releaseMutationLease({
      taskId: active.taskId,
      executionId: active.executionId,
      generation: active.generation,
    });
    this.cleanupActive(active.executionId);
    const task = store.getTask(active.taskId);
    if (task?.mode === "loop" && task.status === "queued") {
      await this.scheduleTask({ workspaceId: active.workspaceId, taskId: active.taskId });
    }
  }

  private cleanupActive(executionId: string): void {
    const active = this.activeByExecution.get(executionId);
    if (!active) {
      return;
    }
    active.unsubscribeEvents?.();
    active.unbindGateway?.();
    active.unregisterRuntime?.();
    if (active.heartbeat) {
      clearInterval(active.heartbeat);
    }
    this.activeByExecution.delete(executionId);
    if (this.activeByWorkspace.get(active.workspaceId) === active) {
      this.activeByWorkspace.delete(active.workspaceId);
    }
  }
}
