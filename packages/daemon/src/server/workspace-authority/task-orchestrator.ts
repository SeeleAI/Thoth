import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import {
  THOTH_RUNTIME_BUNDLE_CATALOG,
  loadRuntimeBundle,
  type HarnessApprovalRequest,
  type HarnessCapabilities,
  type HarnessExecutionDescriptor,
  type HarnessExecutionEvent,
  type HarnessExecutionInput,
  type HarnessThreadDescriptor,
  type RuntimeAttachmentReceipt,
} from "@thoth/drivers/harness";
import type {
  ExecutionApprovalProjection,
  ExecutionProjection,
  TaskContextEnvelope,
  TaskProjection,
  WorkUnitProjection,
} from "@thoth/protocol/task-authority";
import type { ProviderRunModeReceipt } from "@thoth/protocol/provider-control";
import type { ProviderPlanCompleted } from "@thoth/protocol/agent-types";
import type {
  ThothLoopCheckpointInput,
  ThothLoopReportBlockedInput,
  ThothLoopRequestHumanDecisionInput,
  ThothLoopReviewDecisionInput,
} from "@thoth/protocol/thoth-runtime-contract";
import type { ExecutionService } from "../agent/execution-service.js";
import { RuntimeBundleStore } from "./runtime-bundle-store.js";
import type { WorkspaceAuthorityManager } from "./workspace-authority-manager.js";
import type { WorkspaceAuthorityStore } from "./workspace-authority-store.js";
import type { TaskCommandScheduler, WorkspaceTaskCoordinator } from "./task-coordinator.js";
import { ToolGateway, type ExecutionToolBinding, type ToolResultSink } from "./tool-gateway.js";
import {
  ExecutionApprovalController,
  type ApprovalClock,
} from "./execution-approval-controller.js";

const LEASE_TTL_MS = 2 * 60 * 1000;
const LEASE_HEARTBEAT_MS = Math.floor(LEASE_TTL_MS / 3);
const BACKGROUND_APPROVAL_TIMEOUT_MS = 20_000;

interface ActivePhase {
  workspaceId: string;
  taskId: string;
  workUnitId: string | null;
  cycleId: string;
  executionId: string;
  generation: string;
  phase: "execute" | "review";
  nativePlan: boolean;
  adapterId: string;
  thread: HarnessThreadDescriptor;
  descriptor: HarnessExecutionDescriptor | null;
  unsubscribeEvents: (() => void) | null;
  unbindGateway: (() => void) | null;
  unregisterRuntime: (() => void) | null;
  heartbeat: ReturnType<typeof setInterval> | null;
  repairUsed: boolean;
  semanticAccepted: boolean;
  receipt: RuntimeAttachmentReceipt;
  runModeReceipt: ProviderRunModeReceipt;
  completedPlan: ProviderPlanCompleted | null;
  providerSegmentRevision: number;
  eventTail: Promise<void>;
}

function isTerminalEvent(payload: unknown): "completed" | "failed" | "canceled" | null {
  if (!payload || typeof payload !== "object" || !("type" in payload)) return null;
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

function chooseToolTransport(
  adapterId: string,
  capabilities: HarnessCapabilities,
): "native" | "mcp" | "acp" {
  if (capabilities.toolAttachment.includes("native")) return "native";
  if (capabilities.toolAttachment.includes("acp")) return "acp";
  if (capabilities.toolAttachment.includes("mcp")) return "mcp";
  throw new Error(`HarnessAdapter ${adapterId} cannot attach Thoth semantic tools`);
}

function taskAnchor(context: TaskContextEnvelope): unknown {
  return {
    title: context.task.intentContract.title,
    objective: context.task.intentContract.objective,
    nonGoals: context.task.intentContract.nonGoals,
    invariants: context.task.intentContract.invariants,
    acceptanceClaims: context.task.intentContract.acceptanceClaims.map((claim) => ({
      id: claim.id,
      statement: claim.statement,
      status: claim.status,
    })),
    riskBoundary: context.task.intentContract.riskBoundary,
    escalationPolicy: context.task.intentContract.escalationPolicy,
  };
}

function workingContext(context: TaskContextEnvelope): unknown {
  return {
    activeGap: context.task.workingSet.activeGap,
    currentUnderstanding: context.task.workingSet.currentUnderstanding,
    currentHypothesis: context.task.workingSet.currentHypothesis,
    nextMove: context.task.workingSet.nextMove,
    rejectedRoutes: context.task.workingSet.rejectedRoutes,
    blockers: context.task.workingSet.blockers,
    latestReview: context.task.latestReview
      ? {
          decision: context.task.latestReview.decision,
          reason: context.task.latestReview.reason,
          nextFocus: context.task.latestReview.nextFocus,
        }
      : null,
    evidenceIndex: context.evidence.map((evidence) => ({
      ref: evidence.id,
      kind: evidence.kind,
      summary: evidence.summary,
      artifactRef: evidence.artifactRef,
    })),
  };
}

function executePrompt(context: TaskContextEnvelope, nativePlan: boolean): string {
  return [
    "Act as the Executor for one meaningful real increment toward this stable Task Anchor.",
    nativePlan
      ? "Use the Provider's native Plan mode to investigate and choose a coherent Work Unit. After Plan approval, implement in this same Provider thread."
      : "The Provider has no native Plan capability. Deliberate using its normal Agent cognition, then implement; do not claim native Plan authority.",
    "Own discoverable and implementation decisions. Ask a Human only when the Task Anchor genuinely requires Human ownership.",
    "Do not mechanically restate the contract. Inspect Workspace reality, make a meaningful external increment, collect evidence, then submit exactly one thoth_loop_checkpoint.",
    "Task Anchor:",
    JSON.stringify(taskAnchor(context), null, 2),
    "Current Working Set:",
    JSON.stringify(workingContext(context), null, 2),
  ].join("\n\n");
}

function reviewPrompt(context: TaskContextEnvelope): string {
  return [
    "Act as a fresh independent Reviewer of the stable Task Anchor.",
    "Inspect Workspace reality yourself. You may read files, run read-only checks, and inspect the Evidence Index, but you must not modify the Workspace.",
    "Do not assume the Executor is correct and do not request its private transcript. Judge whether reality advanced, drifted, stalled, needs reorientation, needs a Human-owned decision, is blocked, or proves every Acceptance Claim.",
    "Submit exactly one thoth_loop_review_decision. Use complete only when every Acceptance Claim maps to concrete evidence refs.",
    "Task Anchor:",
    JSON.stringify(taskAnchor(context), null, 2),
    "Review Working Set and Evidence Index:",
    JSON.stringify(workingContext(context), null, 2),
  ].join("\n\n");
}

/** Workspace-serial, target-anchored Loop scheduler. Provider cognition remains inside Harness sessions. */
export class WorkspaceTaskOrchestrator implements TaskCommandScheduler, ToolResultSink {
  readonly toolGateway: ToolGateway;

  private readonly loopBundle = loadRuntimeBundle("thoth.loop", THOTH_RUNTIME_BUNDLE_CATALOG);
  private readonly activeByWorkspace = new Map<string, ActivePhase>();
  private readonly activeByExecution = new Map<string, ActivePhase>();
  private readonly workspaceTails = new Map<string, Promise<void>>();
  private readonly approvalController: ExecutionApprovalController;
  private readonly approvalTimeoutMs: number;
  private closed = false;

  constructor(
    private readonly authority: WorkspaceAuthorityManager,
    private readonly coordinator: WorkspaceTaskCoordinator,
    private readonly executionService: ExecutionService,
    private readonly bundleStore: RuntimeBundleStore,
    private readonly logger: Logger,
    providerControl: { approvalTimeoutMs?: number; approvalClock?: ApprovalClock } = {},
  ) {
    this.toolGateway = new ToolGateway(this);
    this.bundleStore.persist(this.loopBundle);
    this.approvalTimeoutMs = providerControl.approvalTimeoutMs ?? BACKGROUND_APPROVAL_TIMEOUT_MS;
    this.approvalController = new ExecutionApprovalController(providerControl.approvalClock);
    this.coordinator.setScheduler(this);
    this.coordinator.setToolGateway(this.toolGateway);
  }

  initialize(): void {
    if (this.closed) return;
    for (const workspace of this.authority.catalog.listWorkspaces()) {
      const store = this.authority.forWorkspace(workspace.id);
      store.recoverInterruptedExecutionsAfterRestart();
      if (
        store
          .listTasks()
          .some((task) => task.mode === "loop" && ["queued", "reorienting"].includes(task.status))
      ) {
        void this.scheduleTask({ workspaceId: workspace.id, taskId: "startup" });
      }
    }
  }

  /**
   * Fences process-local callbacks before Workspace authority closes. Durable
   * executions remain recoverable on the next daemon start; no shutdown timer
   * may mutate a closed SQLite shard.
   */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.approvalController.clear();
    for (const executionId of [...this.activeByExecution.keys()]) {
      this.cleanupActive(executionId);
    }
    this.workspaceTails.clear();
    this.coordinator.runtimes.clear();
  }

  async scheduleTask(input: { workspaceId: string; taskId: string }): Promise<void> {
    if (this.closed) return;
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
    command: "pause" | "resume" | "stop" | "raise_budget" | "review_only";
  }): Promise<void> {
    if (this.closed) return;
    if (input.command === "stop") {
      if (input.execution) this.approvalController.cancelExecution(input.execution.id);
      return;
    }
    if (["resume", "raise_budget", "review_only"].includes(input.command)) {
      await this.scheduleTask({ workspaceId: input.workspaceId, taskId: input.task.id });
    }
  }

  async handleTaskStopSettled(input: {
    workspaceId: string;
    task: TaskProjection;
    execution: ExecutionProjection | null;
  }): Promise<void> {
    if (this.closed) return;
    const active = input.execution ? this.activeByExecution.get(input.execution.id) : null;
    if (
      active &&
      active.workspaceId === input.workspaceId &&
      active.taskId === input.task.id &&
      active.generation === input.execution?.generation
    ) {
      this.cleanupActive(active.executionId);
    }
    await this.scheduleTask({ workspaceId: input.workspaceId, taskId: input.task.id });
  }

  async continueAfterExecutionApproval(input: {
    workspaceId: string;
    task: TaskProjection;
    execution: ExecutionProjection;
    approval: ExecutionApprovalProjection;
  }): Promise<void> {
    if (this.closed) return;
    this.approvalController.cancel(input.approval.id);
    const active = this.activeByExecution.get(input.execution.id);
    if (
      !active ||
      active.workspaceId !== input.workspaceId ||
      active.taskId !== input.task.id ||
      active.generation !== input.execution.generation ||
      !active.descriptor
    ) {
      this.authority.forWorkspace(input.workspaceId).interruptExecution({
        executionId: input.execution.id,
        generation: input.execution.generation,
        summary:
          "The Provider approval callback is no longer recoverable; this phase will reorient.",
      });
      return;
    }
    const decision = input.approval.resolution?.decision;
    if (!decision) return;
    const store = this.authority.forWorkspace(input.workspaceId);
    const providerRequestId = store.getProviderApprovalRequestId(input.approval.id);
    if (!providerRequestId) {
      store.interruptExecution({
        executionId: active.executionId,
        generation: active.generation,
        summary: "The Provider approval binding is missing; this phase will reorient.",
      });
      await this.finishPhase(active);
      return;
    }
    try {
      if (input.approval.kind === "implement") {
        if (!active.nativePlan || !active.completedPlan) {
          throw new Error("The completed native Plan receipt is unavailable");
        }
        this.executionService.resolveHarnessPlanInteraction(active.descriptor, decision);
        if (decision === "deny") {
          await this.finishPhase(active);
          return;
        }
        const runModeReceipt = await this.executionService.prepareHarnessRunMode(active.adapterId, {
          thread: active.thread,
          mode: "default",
        });
        if (runModeReceipt.status !== "applied") {
          throw new Error(runModeReceipt.reason ?? "Provider did not enter implementation mode");
        }
        active.runModeReceipt = runModeReceipt;
        store.appendTimeline({
          executionId: active.executionId,
          item: { type: "provider_mode_receipt", receipt: runModeReceipt },
        });
        if (!this.stillOwnsExecution(active, "implementing")) {
          await this.executionService
            .interruptHarnessExecution(active.adapterId, active.descriptor)
            .catch(() => undefined);
          return;
        }
        await this.launchProviderContinuation(active, {
          prompt: [
            "Implement the completed native Plan now in this same Provider thread.",
            "Stay anchored to the Intent Contract and current Working Set. Inspect reality, validate one meaningful increment, then submit thoth_loop_checkpoint exactly once.",
            `Completed native Plan:\n${active.completedPlan.text}`,
          ].join("\n\n"),
          runModeReceipt,
          purpose: "implementation",
        });
        return;
      }

      const resolution = await this.executionService.resolveHarnessApproval(active.adapterId, {
        thread: active.thread,
        execution: active.descriptor,
        approvalId: providerRequestId,
        decision,
      });
      if (decision === "deny") {
        await this.finishPhase(active);
        return;
      }
      if (!this.stillOwnsExecution(active, "awaiting_provider")) {
        await this.executionService
          .interruptHarnessExecution(active.adapterId, active.descriptor)
          .catch(() => undefined);
        return;
      }
      if (resolution.runModeReceipt) {
        active.runModeReceipt = resolution.runModeReceipt;
        store.appendTimeline({
          executionId: active.executionId,
          item: { type: "provider_mode_receipt", receipt: resolution.runModeReceipt },
        });
      }
      if (resolution.followUpPrompt !== null) {
        await this.launchProviderContinuation(active, {
          prompt: resolution.followUpPrompt,
          runModeReceipt: resolution.runModeReceipt ?? active.runModeReceipt,
          purpose: "continuation",
        });
      }
    } catch (error) {
      store.interruptExecution({
        executionId: active.executionId,
        generation: active.generation,
        summary: `Provider approval resolution failed: ${error instanceof Error ? error.message : String(error)}`,
      });
      await this.finishPhase(active);
    }
  }

  submitCheckpoint(input: {
    binding: ExecutionToolBinding;
    checkpoint: ThothLoopCheckpointInput;
    providerTurnId?: string;
    callId: string;
  }): boolean {
    try {
      const accepted = this.authority
        .forWorkspace(input.binding.workspaceId)
        .acceptExecutorCheckpoint({
          executionId: input.binding.executionId,
          generation: input.binding.generation,
          checkpoint: input.checkpoint,
          callId: input.callId,
        });
      if (accepted) this.markSemanticAccepted(input.binding.executionId);
      return accepted;
    } catch (error) {
      this.logger.warn(
        { err: error, binding: input.binding },
        "Rejected stale Executor checkpoint",
      );
      return false;
    }
  }

  submitReviewDecision(input: {
    binding: ExecutionToolBinding;
    review: ThothLoopReviewDecisionInput;
    providerTurnId?: string;
    callId: string;
  }): boolean {
    try {
      const accepted = this.authority.forWorkspace(input.binding.workspaceId).acceptReviewDecision({
        executionId: input.binding.executionId,
        generation: input.binding.generation,
        review: input.review,
        callId: input.callId,
      });
      if (accepted) this.markSemanticAccepted(input.binding.executionId);
      return accepted;
    } catch (error) {
      this.logger.warn({ err: error, binding: input.binding }, "Rejected stale Review decision");
      return false;
    }
  }

  requestHumanDecision(input: {
    binding: ExecutionToolBinding;
    request: ThothLoopRequestHumanDecisionInput;
    providerTurnId?: string;
    callId: string;
  }): boolean {
    try {
      const accepted = this.authority
        .forWorkspace(input.binding.workspaceId)
        .requestExecutionHumanDecision({
          executionId: input.binding.executionId,
          generation: input.binding.generation,
          request: input.request,
          callId: input.callId,
        });
      if (accepted) {
        this.markSemanticAccepted(input.binding.executionId);
        const active = this.activeByExecution.get(input.binding.executionId);
        const task = this.authority
          .forWorkspace(input.binding.workspaceId)
          .getTask(input.binding.taskId);
        if (task?.pendingDecision) {
          const decisionId = task.pendingDecision.id;
          const openClarify = async (): Promise<void> => {
            await this.coordinator.openTaskClarify({
              workspaceId: input.binding.workspaceId,
              taskId: task.id,
              decisionId,
            });
          };
          const handoff = active
            ? this.settleForHumanDecision(active).then(openClarify)
            : openClarify();
          void handoff.catch((error: unknown) => {
            this.logger.error(
              { err: error, workspaceId: input.binding.workspaceId, taskId: task.id },
              "Failed to settle and hand a Loop decision to source Agent Clarify",
            );
          });
        }
      }
      return accepted;
    } catch (error) {
      this.logger.warn(
        { err: error, binding: input.binding },
        "Rejected stale Human decision request",
      );
      return false;
    }
  }

  reportBlocked(input: {
    binding: ExecutionToolBinding;
    report: ThothLoopReportBlockedInput;
    providerTurnId?: string;
    callId: string;
  }): boolean {
    try {
      const accepted = this.authority
        .forWorkspace(input.binding.workspaceId)
        .acceptExecutionBlocker({
          executionId: input.binding.executionId,
          generation: input.binding.generation,
          report: input.report,
        });
      if (accepted) this.markSemanticAccepted(input.binding.executionId);
      return accepted;
    } catch (error) {
      this.logger.warn({ err: error, binding: input.binding }, "Rejected stale blocker report");
      return false;
    }
  }

  private markSemanticAccepted(executionId: string): void {
    const active = this.activeByExecution.get(executionId);
    if (active) active.semanticAccepted = true;
  }

  private async runWorkspace(workspaceId: string): Promise<void> {
    if (this.closed) return;
    if (this.activeByWorkspace.has(workspaceId)) return;
    const store = this.authority.forWorkspace(workspaceId);
    if (store.hasMutationQuarantine()) return;
    const task = store.getNextMutationTask();
    if (!task) return;
    if (task.mode === "quick") {
      this.coordinator.wakeQuickMutation(workspaceId);
      return;
    }
    await this.launchPhase(store, task);
  }

  private async launchPhase(store: WorkspaceAuthorityStore, task: TaskProjection): Promise<void> {
    if (this.closed) return;
    const phase = this.nextPhase(store, task);
    const executionId = `execution-${randomUUID()}`;
    const generation = randomUUID();
    const cycleId =
      phase === "review" ? this.reviewCycle(store, task) : `loop-cycle-${randomUUID()}`;
    const workUnit =
      phase === "execute" ? this.createWorkUnit(task, cycleId) : this.reviewWorkUnit(task, cycleId);
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
    if (this.closed) {
      store.releaseMutationLease({ taskId: task.id, executionId, generation });
      return;
    }

    try {
      const metadata = store.getTaskRuntimeMetadata(task.id);
      if (!metadata) throw new Error(`Task ${task.id} is missing Provider runtime metadata`);
      const profile = this.authority.catalog.getProviderProfile(metadata.providerProfileId);
      if (!profile?.enabled)
        throw new Error(`Provider profile ${metadata.providerProfileId} is unavailable`);
      const adapterId = profile.adapterId;
      const capabilities = await this.executionService.getHarnessCapabilities(adapterId);
      if (capabilities.runtimeBundleActivation !== "native_skill") {
        throw new Error(`HarnessAdapter ${adapterId} cannot activate the thoth.loop RuntimeBundle`);
      }
      const workspace = this.authority.catalog.getWorkspace(task.workspaceId);
      if (!workspace) throw new Error(`Workspace ${task.workspaceId} is missing from catalog`);

      const reset = this.requiresFreshExecutorContext(task, phase);
      const reusable =
        phase === "execute" && !reset ? store.findLatestExecuteThread(task.id) : null;
      const lineageParent =
        phase === "execute" && !reusable ? store.findLatestExecuteLineageThread(task.id) : null;
      let thread: HarnessThreadDescriptor;
      let continuation = false;
      if (reusable) {
        thread = await this.executionService.resumeHarnessThread(adapterId, {
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
        thread = await this.executionService.createHarnessThread(adapterId, {
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
          workUnitId: workUnit?.id ?? null,
          cycleId,
          phase,
          providerThreadId: thread.id,
          status: "starting",
          generation,
          attachment: null,
          runModeReceipt: null,
          pendingApproval: null,
          startedAt: now,
          lastActivityAt: now,
          completedAt: null,
          summary: null,
          revision: 1,
        },
        ...(phase === "execute"
          ? { cycle: { id: cycleId, status: "active" as const, startedAt: now } }
          : {}),
        ...(workUnit && !task.workUnits.some((candidate) => candidate.id === workUnit.id)
          ? { workUnit }
          : {}),
        providerThread: {
          id: thread.id,
          adapterId: thread.adapterId,
          nativeHandle: thread.nativeHandle,
          persistence: thread.persistence,
          lineageParentId: lineageParent?.id ?? null,
        },
      });
      const transport = chooseToolTransport(adapterId, capabilities);
      const receipt = await this.executionService.attachHarnessRuntimeBundle(adapterId, {
        thread,
        bundle: this.loopBundle,
        tools: {
          transport,
          catalog: { scope: phase === "execute" ? "loop_execute" : "loop_review" },
        },
      });
      store.recordAttachment({ executionId, receipt });
      const nativePlan = phase === "execute" && capabilities.plan.kind === "native";
      const runMode = nativePlan ? "plan" : "default";
      const runModeReceipt = await this.executionService.prepareHarnessRunMode(adapterId, {
        thread,
        mode: runMode,
      });
      if (runModeReceipt.status !== "applied") {
        throw new Error(
          runModeReceipt.reason ?? `HarnessAdapter ${adapterId} did not apply ${runMode}`,
        );
      }
      const executionWithMode = store.recordExecutionRunModeReceipt({
        executionId,
        generation,
        expectedRevision: store.getExecution(executionId)?.revision ?? execution.revision,
        receipt: runModeReceipt,
        status: nativePlan ? "planning" : "running",
      });
      if (!executionWithMode) throw new Error(`Execution ${executionId} changed during mode setup`);
      const context = this.authority.getTaskContext(task.workspaceId, task.id);
      if (!context) throw new Error(`Task ${task.id} context could not be built`);
      const agentId =
        thread.persistence && typeof thread.persistence.agentId === "string"
          ? thread.persistence.agentId
          : null;
      if (!agentId)
        throw new Error(`Harness thread ${thread.id} has no daemon-owned Agent binding`);
      const active: ActivePhase = {
        workspaceId: task.workspaceId,
        taskId: task.id,
        workUnitId: workUnit?.id ?? null,
        cycleId,
        executionId,
        generation,
        phase,
        nativePlan,
        adapterId,
        thread,
        descriptor: null,
        unsubscribeEvents: null,
        unbindGateway: null,
        unregisterRuntime: null,
        heartbeat: null,
        repairUsed: false,
        semanticAccepted: false,
        receipt,
        runModeReceipt,
        completedPlan: null,
        providerSegmentRevision: 1,
        eventTail: Promise.resolve(),
      };
      this.activeByWorkspace.set(task.workspaceId, active);
      this.activeByExecution.set(executionId, active);
      active.unbindGateway = this.toolGateway.bind(agentId, {
        workspaceId: task.workspaceId,
        taskId: task.id,
        workUnitId: workUnit?.id ?? null,
        cycleId,
        executionId,
        generation,
        phase,
      });
      const executionInput: HarnessExecutionInput = {
        executionId,
        generation,
        prompt: phase === "execute" ? executePrompt(context, nativePlan) : reviewPrompt(context),
        attachment: receipt,
        activation: {
          bundleId: this.loopBundle.id,
          bundleDigest: this.loopBundle.digest,
          scope: phase === "execute" ? "loop_execute" : "loop_review",
          generation,
        },
        runMode,
        runModeReceipt,
      };
      const descriptor = continuation
        ? await this.executionService.continueHarnessExecution(adapterId, {
            thread,
            execution: executionInput,
          })
        : await this.executionService.startHarnessExecution(adapterId, {
            thread,
            execution: executionInput,
          });
      if (this.closed) {
        await this.executionService
          .interruptHarnessExecution(adapterId, descriptor)
          .catch(() => undefined);
        return;
      }
      active.descriptor = descriptor;
      active.unregisterRuntime = this.coordinator.runtimes.register({
        workspaceId: task.workspaceId,
        taskId: task.id,
        generation,
        execution: descriptor,
        interrupt: () => this.executionService.interruptHarnessExecution(adapterId, descriptor),
      });
      this.subscribeActive(active, nativePlan ? "planning" : "execution");
      active.heartbeat = setInterval(() => {
        const renewed = store.renewMutationLease({
          taskId: task.id,
          executionId,
          generation,
          ttlMs: LEASE_TTL_MS,
        });
        if (!renewed) void this.interruptForLostLease(active);
      }, LEASE_HEARTBEAT_MS);
      active.heartbeat.unref();
    } catch (error) {
      if (this.closed) return;
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

  private nextPhase(store: WorkspaceAuthorityStore, task: TaskProjection): "execute" | "review" {
    if (task.pendingControl === "review_only") return "review";
    if (task.status === "reorienting") return "execute";
    const latest = store.listExecutions(task.id).at(-1);
    if (latest?.phase === "execute" && latest.status === "succeeded") {
      const reviewed = store
        .listExecutions(task.id)
        .some(
          (execution) =>
            execution.phase === "review" &&
            execution.cycleId === latest.cycleId &&
            execution.status === "succeeded",
        );
      if (!reviewed) return "review";
    }
    return "execute";
  }

  private reviewCycle(store: WorkspaceAuthorityStore, task: TaskProjection): string {
    const execute = store
      .listExecutions(task.id)
      .filter((execution) => execution.phase === "execute" && execution.cycleId)
      .at(-1);
    if (!execute?.cycleId) throw new Error(`Task ${task.id} has no executed cycle to Review`);
    return execute.cycleId;
  }

  private reviewWorkUnit(task: TaskProjection, cycleId: string): WorkUnitProjection | null {
    return task.workUnits.filter((workUnit) => workUnit.cycleId === cycleId).at(-1) ?? null;
  }

  private createWorkUnit(task: TaskProjection, cycleId: string): WorkUnitProjection {
    const now = new Date().toISOString();
    return {
      id: `work-unit-${randomUUID()}`,
      taskId: task.id,
      cycleId,
      title: "Current gap",
      activeGap: task.workingSet.activeGap,
      progressClaim: "No Executor checkpoint has been submitted yet.",
      unresolvedGap: task.workingSet.activeGap,
      evidenceRefs: [],
      status: "active",
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };
  }

  private requiresFreshExecutorContext(task: TaskProjection, phase: "execute" | "review"): boolean {
    if (phase === "review") return true;
    return (
      task.status === "reorienting" ||
      task.workingSet.noProgressCount >= 2 ||
      task.latestReview?.decision === "reorient"
    );
  }

  private async handleExecutionEvent(
    active: ActivePhase,
    event: HarnessExecutionEvent,
    providerSegmentRevision: number,
    purpose: "planning" | "implementation" | "execution" | "repair" | "continuation",
  ): Promise<void> {
    if (this.closed) return;
    const store = this.authority.forWorkspace(active.workspaceId);
    store.appendTimeline({
      executionId: active.executionId,
      occurredAt: event.occurredAt,
      item: event.payload,
    });
    if (providerSegmentRevision !== active.providerSegmentRevision) return;
    if (event.control) {
      switch (event.control.type) {
        case "plan_completed":
          if (active.phase !== "execute" || !active.nativePlan) {
            store.interruptExecution({
              executionId: active.executionId,
              generation: active.generation,
              summary: "A native Plan transition appeared outside a native-plan Execute attempt.",
            });
            await this.finishPhase(active);
            return;
          }
          active.completedPlan = event.control.plan;
          await this.openBackgroundApproval(active, {
            id: `daemon-plan:${active.executionId}:${event.control.plan.itemId}`,
            kind: "implement",
            title: "Implement plan",
            description: "The Provider completed its native Plan and is ready to implement it.",
            displayed: { plan: event.control.plan.text, receipt: event.control.plan },
            autoApproveEligible: true,
          });
          return;
        case "plan_invalid":
          store.interruptExecution({
            executionId: active.executionId,
            generation: active.generation,
            summary: event.control.reason,
          });
          await this.finishPhase(active);
          return;
        case "approval_requested":
          await this.openBackgroundApproval(active, event.control.approval);
          return;
        case "provider_question":
          store.interruptExecution({
            executionId: active.executionId,
            generation: active.generation,
            summary:
              "The Provider requested a Human answer outside the Task decision tool. The attempt was fenced and will reorient.",
          });
          await this.finishPhase(active);
          return;
      }
    }
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
    if (!terminal) return;
    if (purpose === "planning" && active.completedPlan) return;
    const execution = store.getExecution(active.executionId);
    if (execution?.pendingApproval || execution?.status === "awaiting_implementation") {
      return;
    }
    if (execution?.status === "awaiting_user") {
      await this.finishPhase(active);
      return;
    }
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
        ? "Provider completed twice without the required semantic Loop tool call."
        : terminal === "canceled"
          ? "Provider execution was canceled before a semantic Loop result."
          : "Provider execution failed before a semantic Loop result.";
    store.interruptExecution({
      executionId: active.executionId,
      generation: active.generation,
      summary,
    });
    await this.finishPhase(active);
  }

  private async launchRepairContinuation(active: ActivePhase): Promise<void> {
    await this.launchProviderContinuation(active, {
      prompt:
        active.phase === "execute"
          ? "Your turn ended without the required semantic checkpoint. Preserve real completed work and call thoth_loop_checkpoint exactly once now; do not perform more implementation."
          : "Your Review turn ended without a decision. Preserve your independent findings and call thoth_loop_review_decision exactly once now; do not modify the Workspace.",
      runModeReceipt: active.runModeReceipt,
      purpose: "repair",
    });
  }

  private async openBackgroundApproval(
    active: ActivePhase,
    request: HarnessApprovalRequest,
  ): Promise<void> {
    if (this.closed) return;
    const store = this.authority.forWorkspace(active.workspaceId);
    try {
      if (request.kind === "question" || !request.autoApproveEligible) {
        throw new Error("Provider questions are not background runtime approvals");
      }
      const deadlineAt = this.approvalController.deadlineAfter(this.approvalTimeoutMs);
      const approval = store.createExecutionApproval({
        executionId: active.executionId,
        generation: active.generation,
        request,
        deadlineAt,
      });
      this.approvalController.schedule({
        approvalId: approval.id,
        executionId: active.executionId,
        deadlineAt,
        onDeadline: async () => {
          try {
            const current = store.getExecutionApproval(approval.id);
            if (!current || current.status !== "pending") return;
            const result = await this.coordinator.resolveExecutionApproval({
              workspaceId: active.workspaceId,
              taskId: active.taskId,
              executionId: active.executionId,
              approvalId: approval.id,
              decision: approval.kind === "implement" ? "implement" : "allow",
              expectedRevision: current.revision,
              commandId: `daemon-auto-approval:${approval.id}`,
              actorId: "daemon:auto-approval-timeout",
              clientId: "daemon",
              recordHumanDecision: false,
            });
            if (result.error && !result.conflict) throw new Error(result.error);
          } catch (error) {
            store.interruptExecution({
              executionId: active.executionId,
              generation: active.generation,
              summary: `Automatic Provider approval failed: ${error instanceof Error ? error.message : String(error)}`,
            });
            await this.finishPhase(active);
          }
        },
      });
    } catch (error) {
      store.interruptExecution({
        executionId: active.executionId,
        generation: active.generation,
        summary: `Provider approval could not be opened: ${error instanceof Error ? error.message : String(error)}`,
      });
      await this.finishPhase(active);
    }
  }

  private async launchProviderContinuation(
    active: ActivePhase,
    input: {
      prompt: unknown;
      runModeReceipt: ProviderRunModeReceipt;
      purpose: "implementation" | "repair" | "continuation";
    },
  ): Promise<void> {
    if (this.closed) return;
    active.providerSegmentRevision += 1;
    active.unsubscribeEvents?.();
    const descriptor = await this.executionService.continueHarnessExecution(active.adapterId, {
      thread: active.thread,
      execution: {
        executionId: active.executionId,
        generation: active.generation,
        prompt: input.prompt,
        attachment: active.receipt,
        activation: {
          bundleId: this.loopBundle.id,
          bundleDigest: this.loopBundle.digest,
          scope: active.phase === "execute" ? "loop_execute" : "loop_review",
          generation: active.generation,
        },
        runMode: "default",
        runModeReceipt: input.runModeReceipt,
      },
    });
    active.descriptor = descriptor;
    active.unregisterRuntime?.();
    active.unregisterRuntime = this.coordinator.runtimes.register({
      workspaceId: active.workspaceId,
      taskId: active.taskId,
      generation: active.generation,
      execution: descriptor,
      interrupt: () =>
        this.executionService.interruptHarnessExecution(active.adapterId, descriptor),
    });
    this.subscribeActive(active, input.purpose);
  }

  private subscribeActive(
    active: ActivePhase,
    purpose: "planning" | "implementation" | "execution" | "repair" | "continuation",
  ): void {
    if (!active.descriptor) throw new Error(`Execution ${active.executionId} has no descriptor`);
    const revision = active.providerSegmentRevision;
    active.unsubscribeEvents = this.executionService.subscribeHarnessEvents(
      active.adapterId,
      active.descriptor,
      (event) => {
        if (this.closed) return;
        active.eventTail = active.eventTail
          .then(() => this.handleExecutionEvent(active, event, revision, purpose))
          .catch((error: unknown) => {
            this.logger.error(
              { err: error, executionId: active.executionId },
              "Failed to process Harness execution event",
            );
          });
      },
    );
  }

  private stillOwnsExecution(
    active: ActivePhase,
    expectedStatus: ExecutionProjection["status"],
  ): boolean {
    const store = this.authority.forWorkspace(active.workspaceId);
    const task = store.getTask(active.taskId);
    const execution = store.getExecution(active.executionId);
    return Boolean(
      task &&
      execution &&
      task.currentExecutionId === active.executionId &&
      task.status === "running" &&
      execution.generation === active.generation &&
      execution.status === expectedStatus,
    );
  }

  private async interruptForLostLease(active: ActivePhase): Promise<void> {
    if (this.closed) return;
    if (active.descriptor) {
      await this.executionService
        .interruptHarnessExecution(active.adapterId, active.descriptor)
        .catch(() => undefined);
    }
    this.authority.forWorkspace(active.workspaceId).interruptExecution({
      executionId: active.executionId,
      generation: active.generation,
      summary: "Workspace mutation lease was lost while the Provider execution was active.",
    });
    await this.finishPhase(active);
  }

  private async finishPhase(active: ActivePhase): Promise<void> {
    if (this.closed) return;
    if (this.activeByExecution.get(active.executionId) !== active) return;
    const store = this.authority.forWorkspace(active.workspaceId);
    const persistence = await this.executionService
      .describeHarnessPersistence(active.adapterId, active.thread)
      .catch(() => null);
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
    this.coordinator.notifyMutationLeaseReleased(active.workspaceId);
  }

  private async settleForHumanDecision(active: ActivePhase): Promise<void> {
    if (this.closed) return;
    if (this.activeByExecution.get(active.executionId) !== active) return;
    if (active.descriptor) {
      await this.executionService
        .interruptHarnessExecution(active.adapterId, active.descriptor)
        .catch(() => undefined);
    }
    await this.finishPhase(active);
  }

  private cleanupActive(executionId: string): void {
    const active = this.activeByExecution.get(executionId);
    if (!active) return;
    this.approvalController.cancelExecution(executionId);
    active.unsubscribeEvents?.();
    active.unbindGateway?.();
    active.unregisterRuntime?.();
    if (active.heartbeat) clearInterval(active.heartbeat);
    this.activeByExecution.delete(executionId);
    if (this.activeByWorkspace.get(active.workspaceId) === active) {
      this.activeByWorkspace.delete(active.workspaceId);
    }
  }
}
