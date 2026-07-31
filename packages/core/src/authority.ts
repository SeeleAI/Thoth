import type { IntentContractProjection } from "@thoth/protocol/intent-contract";
import type {
  ExecutionApprovalDecision,
  ExecutionApprovalProjection,
  ExecutionLifecycle,
  ExecutionProjection,
  HumanDecisionRecord,
  ReviewDecisionProjection,
  TaskCommand,
  TaskProjection,
  TaskStrength,
  TaskUserDecisionProjection,
  WorkUnitProjection,
} from "@thoth/protocol/task-authority";
import type {
  ThothLoopCheckpointInput,
  ThothLoopReportBlockedInput,
  ThothLoopRequestHumanDecisionInput,
  ThothLoopReviewDecisionInput,
} from "@thoth/protocol/thoth-runtime-contract";
import type { AgentThothLifecycle } from "@thoth/protocol/thoth/rpc-schemas";

const ACTIVE_EXECUTION_STATUSES = new Set<ExecutionLifecycle>([
  "created",
  "starting",
  "orienting",
  "planning",
  "awaiting_implementation",
  "implementing",
  "running",
  "reviewing",
  "awaiting_provider",
  "awaiting_user",
  "cancel_requested",
]);
const TERMINAL_EXECUTION_STATUSES = new Set<ExecutionLifecycle>([
  "canceled",
  "succeeded",
  "failed",
  "orphaned",
]);
const MAX_CONSECUTIVE_EXECUTION_FAILURES = 2;

export type AuthorityTransitionErrorKind = "conflict" | "invalid";

export class AuthorityTransitionError extends Error {
  constructor(
    readonly kind: AuthorityTransitionErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "AuthorityTransitionError";
  }
}

export interface AuthorityState {
  workspaceRevision: number;
  task: TaskProjection;
  execution: ExecutionProjection | null;
  approval?: ExecutionApprovalProjection | null;
  pendingDecision?: TaskUserDecisionProjection | null;
}

export interface ForegroundCardAuthorityState {
  workspaceId: string;
  workspaceRevision: number;
  agent: {
    id: string;
    revision: number;
    activeTurnId: string | null;
    lifecycle: AgentThothLifecycle;
  };
  turn: {
    id: string;
    agentId: string;
    generation: string;
    lifecycle: AgentThothLifecycle;
  };
  card: {
    id: string;
    turnId: string;
    agentId: string;
    kind: "clarify_card" | "intent_contract_card";
    status: "pending" | "answered" | "canceled" | "blocked";
    displayed: unknown;
  };
}

export interface DeterministicAuthorityInput {
  now: string;
  ids?: {
    decisionId?: string;
    decisionRequestId?: string;
    evidenceId?: string;
    reviewDecisionId?: string;
  };
}

interface ActorCommand {
  commandId: string;
  actorId: string;
  clientId: string;
  deviceId?: string | null;
}

export type ForegroundAuthorityCommand = {
  type: "card.answered";
  expectedRevision: number;
  answer: unknown;
  submittedCard: unknown;
  submittedSummary: string;
  nextLifecycle: AgentThothLifecycle;
} & ActorCommand;

export type AuthorityCommand =
  | ({
      type: "task.control";
      command: TaskCommand;
      expectedRevision: number;
    } & ActorCommand)
  | {
      type: "execution.created";
      execution: ExecutionProjection;
    }
  | {
      type: "execution.status.changed";
      generation: string;
      expectedRevision: number;
      status: ExecutionLifecycle;
      expectedStatus?: ExecutionLifecycle;
      summary?: string | null;
      runModeReceipt?: ExecutionProjection["runModeReceipt"];
    }
  | {
      type: "execution.quick.settled";
      generation: string;
      status: "succeeded" | "failed";
      summary: string;
    }
  | {
      type: "execution.approval.requested";
      approval: ExecutionApprovalProjection;
    }
  | ({
      type: "execution.approval.resolved";
      decision: ExecutionApprovalDecision;
      expectedRevision: number;
      recordHumanDecision: boolean;
    } & ActorCommand)
  | {
      type: "execution.checkpoint.completed";
      generation: string;
      checkpoint: ThothLoopCheckpointInput;
    }
  | {
      type: "execution.review.completed";
      generation: string;
      review: ThothLoopReviewDecisionInput;
    }
  | {
      type: "execution.human_decision.requested";
      generation: string;
      request: ThothLoopRequestHumanDecisionInput;
    }
  | {
      type: "execution.blocked";
      generation: string;
      report: ThothLoopReportBlockedInput;
    }
  | {
      type: "execution.interrupted";
      generation: string;
      summary: string;
    }
  | {
      type: "execution.stop.settled";
      generation?: string;
      orphaned: boolean;
    }
  | {
      type: "execution.restart.interrupted";
    }
  | ({
      type: "task.decision.answered";
      decisionId: string;
      optionId: string;
      note?: string;
      expectedRevision: number;
    } & ActorCommand)
  | {
      type: "task.contract.revised";
      decisionRequestId: string;
      decisionRecordId: string;
      expectedRevision: number;
      contract: IntentContractProjection;
    };

export interface AuthorityEvidenceAppend {
  id: string;
  taskId: string;
  executionId: string | null;
  workUnitId: string | null;
  kind: string;
  summary: string;
  content: unknown;
  artifactRef: string | null;
  createdAt: string;
}

export type AuthorityDecisionRequestMutation =
  | { type: "open"; request: TaskUserDecisionProjection }
  | { type: "answer"; requestId: string; decisionId: string; answeredAt: string };

export interface AuthorityProjectionDelta {
  workspaceRevision: number;
  changedTaskIds: readonly string[];
  changedExecutionIds: readonly string[];
}

export type AuthorityEffect =
  | { type: "interrupt_execution"; executionId: string; generation: string }
  | { type: "schedule_task"; taskId: string }
  | { type: "quarantine_execution"; executionId: string; generation: string }
  | { type: "release_task_runtime"; taskId: string }
  | { type: "open_task_clarify"; taskId: string; decisionRequestId: string };

export interface AuthorityMutation {
  task: TaskProjection;
  execution: ExecutionProjection | null;
  approval?: ExecutionApprovalProjection | null;
  decision?: HumanDecisionRecord;
  decisionRequest?: AuthorityDecisionRequestMutation;
  evidence: readonly AuthorityEvidenceAppend[];
  reviewDecision?: ReviewDecisionProjection;
  cancelPendingApprovals: boolean;
  quarantine: boolean;
  projectionDelta: AuthorityProjectionDelta;
  effects: readonly AuthorityEffect[];
}

export interface ForegroundAuthorityMutation {
  agent: ForegroundCardAuthorityState["agent"];
  turn: ForegroundCardAuthorityState["turn"];
  card: ForegroundCardAuthorityState["card"] & {
    status: "answered";
    answer: unknown;
    submittedCard: unknown;
    submittedSummary: string;
    updatedAt: string;
  };
  decision: HumanDecisionRecord;
  projectionDelta: AuthorityProjectionDelta;
}

export interface WorkspaceAuthoritySnapshot {
  workspaceId: string;
  revision: number;
  tasks: Readonly<Record<string, TaskProjection>>;
  executions: Readonly<Record<string, ExecutionProjection>>;
  approvals: Readonly<Record<string, ExecutionApprovalProjection>>;
}

export interface WorkspaceTimelineCursor {
  executionId: string;
  beforeSeq?: number;
  limit: number;
}

export interface WorkspaceTimelinePage {
  entries: readonly { seq: number; occurredAt: string; item: unknown }[];
  nextCursor: WorkspaceTimelineCursor | null;
}

export interface WorkspaceAuthorityRepository {
  readSnapshot(workspaceId: string): WorkspaceAuthoritySnapshot;
  readTimelinePage(workspaceId: string, cursor: WorkspaceTimelineCursor): WorkspaceTimelinePage;
  transact(
    workspaceId: string,
    expectedRevision: number,
    operation: (snapshot: WorkspaceAuthoritySnapshot) => AuthorityMutation,
  ): AuthorityMutation;
}

export interface CreateTaskAuthorityInput {
  id: string;
  workspaceId: string;
  sourceAgentWorkspaceId: string;
  sourceAgentId: string;
  mode: "quick" | "loop";
  intentContract: IntentContractProjection;
  strength: TaskStrength;
  now: string;
}

export function createTaskAuthority(input: CreateTaskAuthorityInput): TaskProjection {
  if (input.intentContract.workspaceId !== input.workspaceId) {
    invalid("Intent Contract belongs to another Workspace");
  }
  if (input.intentContract.sourceAgentId !== input.sourceAgentId) {
    invalid("Intent Contract belongs to another source Agent");
  }
  if (input.intentContract.status !== "confirmed") {
    invalid("Task registration requires a confirmed Intent Contract");
  }
  const contract: IntentContractProjection = {
    ...input.intentContract,
    taskId: input.id,
    updatedAt: input.now,
  };
  return {
    id: input.id,
    workspaceId: input.workspaceId,
    sourceAgentWorkspaceId: input.sourceAgentWorkspaceId,
    sourceAgentId: input.sourceAgentId,
    mode: input.mode,
    title: contract.title,
    intentContract: contract,
    status: "queued",
    summary: "Confirmed intent is queued for execution.",
    currentExecutionId: null,
    currentWorkUnitId: null,
    workingSet: {
      taskId: input.id,
      activeGap: contract.objective,
      currentUnderstanding: "Execution has not oriented against Workspace reality yet.",
      currentHypothesis: "",
      nextMove: "Orient against the Task Anchor and choose the first meaningful Work Unit.",
      relevantEvidenceRefs: [],
      rejectedRoutes: [],
      blockers: [],
      latestReviewDecisionId: null,
      noProgressCount: 0,
      revision: 1,
      updatedAt: input.now,
    },
    workUnits: [],
    latestReview: null,
    completionAuthority: "none",
    origin: null,
    pendingDecision: null,
    budget: {
      strength: input.strength,
      usedNonCompleteReviews: 0,
      maxNonCompleteReviews: nonCompleteReviewLimit(input.strength),
      activeDurationMs: 0,
      tokenCount: 0,
      toolCallCount: 0,
    },
    pendingControl: null,
    revision: 1,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function transitionAuthority(
  state: AuthorityState,
  command: AuthorityCommand,
  input: DeterministicAuthorityInput,
): AuthorityMutation;
export function transitionAuthority(
  state: ForegroundCardAuthorityState,
  command: ForegroundAuthorityCommand,
  input: DeterministicAuthorityInput,
): ForegroundAuthorityMutation;
export function transitionAuthority(
  state: AuthorityState | ForegroundCardAuthorityState,
  command: AuthorityCommand | ForegroundAuthorityCommand,
  input: DeterministicAuthorityInput,
): AuthorityMutation | ForegroundAuthorityMutation {
  if (command.type === "card.answered") {
    return transitionForegroundCard(state as ForegroundCardAuthorityState, command, input);
  }
  const authority = state as AuthorityState;
  switch (command.type) {
    case "task.control":
      return transitionTaskControl(authority, command, input);
    case "execution.created":
      return transitionExecutionCreated(authority, command, input);
    case "execution.status.changed":
      return transitionExecutionStatus(authority, command, input);
    case "execution.quick.settled":
      return transitionQuickSettled(authority, command, input);
    case "execution.approval.requested":
      return transitionApprovalRequested(authority, command, input);
    case "execution.approval.resolved":
      return transitionApprovalResolved(authority, command, input);
    case "execution.checkpoint.completed":
      return transitionCheckpoint(authority, command, input);
    case "execution.review.completed":
      return transitionReview(authority, command, input);
    case "execution.human_decision.requested":
      return transitionHumanDecisionRequest(authority, command, input);
    case "execution.blocked":
      return transitionBlocked(authority, command, input);
    case "execution.interrupted":
      return transitionInterrupted(authority, command, input);
    case "execution.stop.settled":
      return transitionStopSettled(authority, command, input);
    case "execution.restart.interrupted":
      return transitionRestartInterrupted(authority, input);
    case "task.decision.answered":
      return transitionTaskDecision(authority, command, input);
    case "task.contract.revised":
      return transitionContractRevised(authority, command, input);
  }
}

function transitionForegroundCard(
  state: ForegroundCardAuthorityState,
  command: ForegroundAuthorityCommand,
  input: DeterministicAuthorityInput,
): ForegroundAuthorityMutation {
  if (state.agent.revision !== command.expectedRevision)
    conflict("Agent authority revision changed");
  if (state.agent.activeTurnId !== state.turn.id || state.card.turnId !== state.turn.id) {
    conflict("Foreground Card is no longer attached to the active turn");
  }
  if (state.card.status !== "pending") conflict("Foreground Card is no longer pending");
  if (state.turn.generation.length === 0) invalid("Foreground turn has no generation fence");
  const revision = state.agent.revision + 1;
  const decision = humanDecision({
    id: requiredId(input.ids?.decisionId, "decisionId"),
    workspaceId: state.workspaceId,
    taskId: null,
    turnId: state.turn.id,
    cardId: state.card.id,
    kind: `card_${state.card.kind}`,
    displayed: state.card.displayed,
    rawAnswer: command.answer,
    normalized: command.submittedCard,
    actorId: command.actorId,
    clientId: command.clientId,
    deviceId: command.deviceId ?? null,
    commandId: command.commandId,
    expectedRevision: command.expectedRevision,
    resultRevision: revision,
    supersedesDecisionId: null,
    fidelity: "exact",
    decidedAt: input.now,
  });
  return {
    agent: { ...state.agent, revision, lifecycle: command.nextLifecycle },
    turn: { ...state.turn, lifecycle: command.nextLifecycle },
    card: {
      ...state.card,
      status: "answered",
      answer: command.answer,
      submittedCard: command.submittedCard,
      submittedSummary: command.submittedSummary,
      updatedAt: input.now,
    },
    decision,
    projectionDelta: {
      workspaceRevision: state.workspaceRevision + 1,
      changedTaskIds: [],
      changedExecutionIds: [],
    },
  };
}

function transitionExecutionCreated(
  state: AuthorityState,
  command: Extract<AuthorityCommand, { type: "execution.created" }>,
  input: DeterministicAuthorityInput,
): AuthorityMutation {
  if (command.execution.taskId !== state.task.id) invalid("Execution belongs to another Task");
  if (state.task.currentExecutionId) conflict("Task already has an active Execution");
  if (!["queued", "reorienting", "running"].includes(state.task.status)) {
    conflict(`Task cannot start an Execution while ${state.task.status}`);
  }
  if (command.execution.phase === "quick_exec" && state.task.mode !== "quick") {
    invalid("Only Quick Tasks can create quick_exec Executions");
  }
  if (command.execution.phase !== "quick_exec" && state.task.mode !== "loop") {
    invalid("Only Loop Tasks can create execute or review Executions");
  }
  if (command.execution.phase !== "quick_exec" && !command.execution.cycleId) {
    invalid("Loop Execution requires a cycle identity");
  }
  if (command.execution.phase === "execute" && !command.execution.workUnitId) {
    invalid("Execute requires a Work Unit identity");
  }
  if (
    command.execution.workUnitId &&
    !state.task.workUnits.some((workUnit) => workUnit.id === command.execution.workUnitId)
  ) {
    invalid(`Work Unit ${command.execution.workUnitId} is not part of Task ${state.task.id}`);
  }
  const task = updateTask(state.task, input.now, {
    status: "running",
    currentExecutionId: command.execution.id,
    currentWorkUnitId: command.execution.workUnitId,
    pendingControl: state.task.pendingControl === "review_only" ? null : state.task.pendingControl,
    summary:
      command.execution.phase === "review"
        ? "Fresh Review is inspecting Workspace reality."
        : "Executor is working on the current gap.",
  });
  return mutation(state, task, command.execution, input.now);
}

function transitionExecutionStatus(
  state: AuthorityState,
  command: Extract<AuthorityCommand, { type: "execution.status.changed" }>,
  input: DeterministicAuthorityInput,
): AuthorityMutation {
  const execution = requireExecutionGeneration(state, command.generation);
  if (execution.revision !== command.expectedRevision) conflict("Execution revision changed");
  if (command.expectedStatus && execution.status !== command.expectedStatus) {
    conflict(`Execution status changed from ${command.expectedStatus} to ${execution.status}`);
  }
  if (TERMINAL_EXECUTION_STATUSES.has(execution.status)) conflict("Execution is already terminal");
  const next = updateExecution(execution, input.now, {
    status: command.status,
    summary: command.summary === undefined ? execution.summary : command.summary,
    runModeReceipt:
      command.runModeReceipt === undefined ? execution.runModeReceipt : command.runModeReceipt,
  });
  return mutation(state, state.task, next, input.now);
}

function transitionQuickSettled(
  state: AuthorityState,
  command: Extract<AuthorityCommand, { type: "execution.quick.settled" }>,
  input: DeterministicAuthorityInput,
): AuthorityMutation {
  const execution = requireSemanticExecution(state, command.generation, "quick_exec");
  const evidenceId = requiredId(input.ids?.evidenceId, "evidenceId");
  const nextExecution = updateExecution(execution, input.now, {
    status: command.status,
    summary: command.summary,
    completedAt: input.now,
  });
  const task = updateTask(state.task, input.now, {
    status: command.status === "succeeded" ? "completed" : "interrupted",
    summary: command.summary,
    currentExecutionId: null,
    currentWorkUnitId: null,
    completionAuthority: command.status === "succeeded" ? "executor_unreviewed" : "none",
    workingSet: {
      ...state.task.workingSet,
      currentUnderstanding: command.summary,
      relevantEvidenceRefs: unique([...state.task.workingSet.relevantEvidenceRefs, evidenceId]),
      revision: state.task.workingSet.revision + 1,
      updatedAt: input.now,
    },
  });
  return mutation(state, task, nextExecution, input.now, {
    evidence: [
      {
        id: evidenceId,
        taskId: task.id,
        executionId: execution.id,
        workUnitId: null,
        kind: "quick_execution_result",
        summary: command.summary,
        content: { status: command.status, summary: command.summary },
        artifactRef: null,
        createdAt: input.now,
      },
    ],
    effects: [{ type: "release_task_runtime", taskId: task.id }],
  });
}

function transitionApprovalRequested(
  state: AuthorityState,
  command: Extract<AuthorityCommand, { type: "execution.approval.requested" }>,
  input: DeterministicAuthorityInput,
): AuthorityMutation {
  const execution = requireActiveExecution(state, command.approval.executionId);
  if (command.approval.taskId !== state.task.id || command.approval.status !== "pending") {
    invalid("Approval does not belong to this active Task Execution");
  }
  const status: ExecutionLifecycle =
    command.approval.kind === "implement" ? "awaiting_implementation" : "awaiting_provider";
  return mutation(
    state,
    updateTask(state.task, input.now, { status: "running" }),
    updateExecution(execution, input.now, { status }),
    input.now,
    { approval: command.approval },
  );
}

function transitionApprovalResolved(
  state: AuthorityState,
  command: Extract<AuthorityCommand, { type: "execution.approval.resolved" }>,
  input: DeterministicAuthorityInput,
): AuthorityMutation {
  const approval = state.approval;
  if (!approval || approval.status !== "pending")
    conflict("Execution approval is no longer pending");
  if (approval.revision !== command.expectedRevision)
    conflict("Execution approval revision changed");
  const execution = requireActiveExecution(state, approval.executionId);
  if (approval.kind === "implement" && !["implement", "deny"].includes(command.decision)) {
    invalid("Plan approval requires implement or deny");
  }
  if (approval.kind !== "implement" && command.decision === "implement") {
    invalid("Only a Plan approval accepts implement");
  }
  const allowed = command.decision !== "deny";
  const resolved: ExecutionApprovalProjection = {
    ...approval,
    status: allowed ? "allowed" : "denied",
    resolution: {
      decision: command.decision,
      actorId: command.actorId,
      resolvedAt: input.now,
    },
    revision: approval.revision + 1,
    updatedAt: input.now,
  };
  const nextExecution = updateExecution(execution, input.now, {
    status: allowed
      ? approval.kind === "implement"
        ? "implementing"
        : "awaiting_provider"
      : "failed",
    ...(allowed ? {} : { completedAt: input.now, summary: "Provider approval was denied." }),
  });
  const nextTask = updateTask(state.task, input.now, {
    status: allowed ? "running" : "interrupted",
    ...(allowed
      ? {}
      : {
          currentExecutionId: null,
          summary: "Provider approval was denied; execution did not continue.",
        }),
  });
  const decision = command.recordHumanDecision
    ? humanDecision({
        id: requiredId(input.ids?.decisionId, "decisionId"),
        workspaceId: state.task.workspaceId,
        taskId: state.task.id,
        turnId: null,
        cardId: null,
        kind: "execution_approval",
        displayed: approval.displayed,
        rawAnswer: command.decision,
        normalized: { approvalId: approval.id, decision: command.decision },
        actorId: command.actorId,
        clientId: command.clientId,
        deviceId: command.deviceId ?? null,
        commandId: command.commandId,
        expectedRevision: command.expectedRevision,
        resultRevision: nextTask.revision,
        supersedesDecisionId: null,
        fidelity: "exact",
        decidedAt: input.now,
      })
    : undefined;
  return mutation(state, nextTask, nextExecution, input.now, {
    approval: resolved,
    decision,
    effects: allowed ? [] : [{ type: "release_task_runtime", taskId: state.task.id }],
  });
}

function transitionCheckpoint(
  state: AuthorityState,
  command: Extract<AuthorityCommand, { type: "execution.checkpoint.completed" }>,
  input: DeterministicAuthorityInput,
): AuthorityMutation {
  const execution = requireSemanticExecution(state, command.generation, "execute");
  if (!execution.workUnitId) invalid("Execute checkpoint has no Work Unit identity");
  const workUnit = state.task.workUnits.find((candidate) => candidate.id === execution.workUnitId);
  if (!workUnit) invalid(`Work Unit ${execution.workUnitId} is missing`);
  const evidenceId = requiredId(input.ids?.evidenceId, "evidenceId");
  const evidenceRefs = unique([...command.checkpoint.evidenceRefs, evidenceId]);
  const pauseAtBoundary = state.task.pendingControl === "pause";
  const nextWorkUnit: WorkUnitProjection = {
    ...workUnit,
    title: command.checkpoint.title,
    activeGap: command.checkpoint.activeGap,
    progressClaim: command.checkpoint.progressClaim,
    unresolvedGap: command.checkpoint.unresolvedGap,
    evidenceRefs,
    status: "completed",
    revision: workUnit.revision + 1,
    updatedAt: input.now,
  };
  const task = updateTask(state.task, input.now, {
    status: pauseAtBoundary ? "paused" : "queued",
    summary: command.checkpoint.progressClaim,
    currentExecutionId: null,
    currentWorkUnitId: nextWorkUnit.id,
    pendingControl: pauseAtBoundary ? null : state.task.pendingControl,
    workUnits: replaceWorkUnit(state.task.workUnits, nextWorkUnit),
    workingSet: {
      ...state.task.workingSet,
      activeGap: command.checkpoint.unresolvedGap || state.task.workingSet.activeGap,
      currentUnderstanding: command.checkpoint.progressClaim,
      nextMove: pauseAtBoundary
        ? "Resume when ready; the next phase is a fresh independent Review."
        : "Run a fresh independent Review against Workspace reality.",
      relevantEvidenceRefs: unique([
        ...state.task.workingSet.relevantEvidenceRefs,
        ...evidenceRefs,
      ]),
      noProgressCount:
        command.checkpoint.evidenceRefs.length === 0 &&
        command.checkpoint.progressClaim.trim() === workUnit.progressClaim.trim()
          ? state.task.workingSet.noProgressCount + 1
          : 0,
      revision: state.task.workingSet.revision + 1,
      updatedAt: input.now,
    },
  });
  const nextExecution = updateExecution(execution, input.now, {
    status: "succeeded",
    summary: command.checkpoint.progressClaim,
    completedAt: input.now,
  });
  return mutation(state, task, nextExecution, input.now, {
    evidence: [
      {
        id: evidenceId,
        taskId: task.id,
        executionId: execution.id,
        workUnitId: nextWorkUnit.id,
        kind: "executor_checkpoint",
        summary: command.checkpoint.progressClaim,
        content: command.checkpoint,
        artifactRef: null,
        createdAt: input.now,
      },
    ],
    effects: [
      pauseAtBoundary
        ? { type: "release_task_runtime", taskId: task.id }
        : { type: "schedule_task", taskId: task.id },
    ],
  });
}

function transitionReview(
  state: AuthorityState,
  command: Extract<AuthorityCommand, { type: "execution.review.completed" }>,
  input: DeterministicAuthorityInput,
): AuthorityMutation {
  const execution = requireSemanticExecution(state, command.generation, "review");
  if (!execution.cycleId) invalid("Review has no Loop cycle identity");
  if (command.review.decision === "complete") assertCompleteEvidence(state.task, command.review);
  const reviewId = requiredId(input.ids?.reviewDecisionId, "reviewDecisionId");
  const review: ReviewDecisionProjection = {
    id: reviewId,
    taskId: state.task.id,
    cycleId: execution.cycleId,
    executionId: execution.id,
    decision: command.review.decision,
    reason: command.review.reason,
    evidenceRefs: command.review.evidenceRefs,
    nextFocus: command.review.nextFocus ?? null,
    rejectedRoutes: command.review.rejectedRoutes,
    acceptanceEvidence: command.review.acceptanceEvidence,
    createdAt: input.now,
  };
  const usedReviews =
    command.review.decision === "complete"
      ? state.task.budget.usedNonCompleteReviews
      : state.task.budget.usedNonCompleteReviews + 1;
  const budgetExhausted =
    command.review.decision !== "complete" &&
    state.task.budget.maxNonCompleteReviews !== null &&
    usedReviews >= state.task.budget.maxNonCompleteReviews;
  const requiresFinal =
    command.review.decision === "complete" &&
    state.task.intentContract.escalationPolicy.finalConfirmation === "required";
  const nextStatus: TaskProjection["status"] = budgetExhausted
    ? "budget_wait"
    : command.review.decision === "complete"
      ? requiresFinal
        ? "awaiting_user_final"
        : "completed"
      : command.review.decision === "need_human"
        ? "awaiting_user"
        : command.review.decision === "blocked"
          ? "blocked"
          : command.review.decision === "reorient"
            ? "reorienting"
            : "queued";
  const pauseAtBoundary =
    state.task.pendingControl === "pause" && ["queued", "reorienting"].includes(nextStatus);
  const effectiveStatus: TaskProjection["status"] = pauseAtBoundary ? "paused" : nextStatus;
  let pendingDecision: TaskUserDecisionProjection | null = state.task.pendingDecision;
  let decisionRequest: AuthorityDecisionRequestMutation | undefined;
  if (requiresFinal) {
    const request: TaskUserDecisionProjection = {
      id: requiredId(input.ids?.decisionRequestId, "decisionRequestId"),
      kind: "final_confirmation",
      title: "Final acceptance",
      question:
        "Review found evidence for every Acceptance Claim. Accept completion or reopen the Task?",
      affectedContractFields: [],
      options: [
        { id: "accept", label: "Accept completion" },
        { id: "reopen", label: "Reopen Task" },
      ],
      createdAt: input.now,
    };
    pendingDecision = request;
    decisionRequest = { type: "open", request };
  }
  const task = updateTask(state.task, input.now, {
    intentContract:
      command.review.decision === "complete"
        ? {
            ...state.task.intentContract,
            acceptanceClaims: state.task.intentContract.acceptanceClaims.map((claim) => ({
              ...claim,
              status: "satisfied" as const,
              evidenceRefs: command.review.acceptanceEvidence[claim.id] ?? [],
              revision: claim.revision + 1,
            })),
            updatedAt: input.now,
          }
        : state.task.intentContract,
    status: effectiveStatus,
    summary: command.review.reason,
    currentExecutionId: null,
    latestReview: review,
    completionAuthority: command.review.decision === "complete" ? "review_verified" : "none",
    pendingDecision,
    pendingControl: pauseAtBoundary ? null : state.task.pendingControl,
    budget: { ...state.task.budget, usedNonCompleteReviews: usedReviews },
    workingSet: {
      ...state.task.workingSet,
      activeGap:
        command.review.decision === "complete"
          ? "All Acceptance Claims are supported by Review evidence."
          : command.review.nextFocus?.trim() || state.task.workingSet.activeGap,
      currentUnderstanding: command.review.reason,
      currentHypothesis: command.review.nextFocus ?? state.task.workingSet.currentHypothesis,
      nextMove: pauseAtBoundary
        ? "Resume when ready and continue from the latest independent Review."
        : reviewNextMove(command.review.decision, budgetExhausted),
      relevantEvidenceRefs: unique([
        ...state.task.workingSet.relevantEvidenceRefs,
        ...command.review.evidenceRefs,
      ]),
      rejectedRoutes: unique([
        ...state.task.workingSet.rejectedRoutes,
        ...command.review.rejectedRoutes,
      ]),
      blockers:
        command.review.decision === "blocked"
          ? unique([...state.task.workingSet.blockers, command.review.reason])
          : state.task.workingSet.blockers,
      latestReviewDecisionId: review.id,
      noProgressCount:
        command.review.evidenceRefs.length === 0
          ? state.task.workingSet.noProgressCount + 1
          : state.task.workingSet.noProgressCount,
      revision: state.task.workingSet.revision + 1,
      updatedAt: input.now,
    },
  });
  const nextExecution = updateExecution(execution, input.now, {
    status: "succeeded",
    summary: command.review.reason,
    completedAt: input.now,
  });
  return mutation(state, task, nextExecution, input.now, {
    reviewDecision: review,
    decisionRequest,
    effects:
      effectiveStatus === "queued" || effectiveStatus === "reorienting"
        ? [{ type: "schedule_task", taskId: task.id }]
        : effectiveStatus === "completed" ||
            effectiveStatus === "blocked" ||
            effectiveStatus === "budget_wait" ||
            effectiveStatus === "paused"
          ? [{ type: "release_task_runtime", taskId: task.id }]
          : [],
  });
}

function transitionHumanDecisionRequest(
  state: AuthorityState,
  command: Extract<AuthorityCommand, { type: "execution.human_decision.requested" }>,
  input: DeterministicAuthorityInput,
): AuthorityMutation {
  const execution = requireSemanticExecution(state, command.generation);
  const request: TaskUserDecisionProjection = {
    id: requiredId(input.ids?.decisionRequestId, "decisionRequestId"),
    kind: "contract_change",
    title: command.request.title,
    question: command.request.question,
    affectedContractFields: [...command.request.affectedContractFields],
    options: command.request.options,
    ...(command.request.notePlaceholder
      ? { notePlaceholder: command.request.notePlaceholder }
      : {}),
    createdAt: input.now,
  };
  const task = updateTask(state.task, input.now, {
    status: "awaiting_user",
    summary: command.request.question,
    currentExecutionId: null,
    pendingDecision: request,
    workingSet: {
      ...state.task.workingSet,
      blockers: unique([...state.task.workingSet.blockers, command.request.question]),
      nextMove: "Return to the source Agent Clarify session for a Human-owned contract decision.",
      revision: state.task.workingSet.revision + 1,
      updatedAt: input.now,
    },
  });
  const nextExecution = updateExecution(execution, input.now, {
    status: "succeeded",
    summary: command.request.question,
    completedAt: input.now,
  });
  return mutation(state, task, nextExecution, input.now, {
    decisionRequest: { type: "open", request },
    effects: [{ type: "open_task_clarify", taskId: task.id, decisionRequestId: request.id }],
  });
}

function transitionBlocked(
  state: AuthorityState,
  command: Extract<AuthorityCommand, { type: "execution.blocked" }>,
  input: DeterministicAuthorityInput,
): AuthorityMutation {
  const execution = requireSemanticExecution(state, command.generation);
  const evidenceId = requiredId(input.ids?.evidenceId, "evidenceId");
  const workUnits = execution.workUnitId
    ? state.task.workUnits.map((workUnit) =>
        workUnit.id === execution.workUnitId
          ? {
              ...workUnit,
              status: "blocked" as const,
              unresolvedGap: command.report.reason,
              revision: workUnit.revision + 1,
              updatedAt: input.now,
            }
          : workUnit,
      )
    : state.task.workUnits;
  const task = updateTask(state.task, input.now, {
    status: "blocked",
    summary: command.report.reason,
    currentExecutionId: null,
    workUnits,
    workingSet: {
      ...state.task.workingSet,
      blockers: unique([...state.task.workingSet.blockers, command.report.reason]),
      nextMove: command.report.nextUserDecision ?? "Resolve the reported external blocker.",
      relevantEvidenceRefs: unique([...state.task.workingSet.relevantEvidenceRefs, evidenceId]),
      revision: state.task.workingSet.revision + 1,
      updatedAt: input.now,
    },
  });
  const nextExecution = updateExecution(execution, input.now, {
    status: "failed",
    summary: command.report.reason,
    completedAt: input.now,
  });
  return mutation(state, task, nextExecution, input.now, {
    evidence: [
      {
        id: evidenceId,
        taskId: task.id,
        executionId: execution.id,
        workUnitId: execution.workUnitId,
        kind: "reported_blocker",
        summary: command.report.reason,
        content: command.report,
        artifactRef: null,
        createdAt: input.now,
      },
    ],
    effects: [{ type: "release_task_runtime", taskId: task.id }],
  });
}

function transitionInterrupted(
  state: AuthorityState,
  command: Extract<AuthorityCommand, { type: "execution.interrupted" }>,
  input: DeterministicAuthorityInput,
): AuthorityMutation {
  const execution = requireExecutionGeneration(state, command.generation);
  if (TERMINAL_EXECUTION_STATUSES.has(execution.status)) conflict("Execution is already terminal");
  if (execution.status === "cancel_requested" || state.task.status === "stopping") {
    conflict("Stop authority owns this Execution");
  }
  const noProgressCount =
    state.task.mode === "loop"
      ? state.task.workingSet.noProgressCount + 1
      : state.task.workingSet.noProgressCount;
  const shouldReorient =
    state.task.mode === "loop" && noProgressCount < MAX_CONSECUTIVE_EXECUTION_FAILURES;
  const task = updateTask(state.task, input.now, {
    status: shouldReorient ? "reorienting" : "interrupted",
    summary: command.summary,
    currentExecutionId: null,
    workingSet: {
      ...state.task.workingSet,
      nextMove: shouldReorient
        ? "Freshly reorient because the Provider execution could not continue."
        : state.task.mode === "loop"
          ? "Two Executor attempts produced no semantic progress; explicit Resume is required."
          : "Quick execution was interrupted and will not replay automatically.",
      noProgressCount,
      revision: state.task.workingSet.revision + 1,
      updatedAt: input.now,
    },
  });
  const nextExecution = updateExecution(execution, input.now, {
    status: "failed",
    summary: command.summary,
    completedAt: input.now,
  });
  return mutation(state, task, nextExecution, input.now, {
    cancelPendingApprovals: true,
    effects: shouldReorient
      ? [{ type: "schedule_task", taskId: task.id }]
      : [{ type: "release_task_runtime", taskId: task.id }],
  });
}

function transitionStopSettled(
  state: AuthorityState,
  command: Extract<AuthorityCommand, { type: "execution.stop.settled" }>,
  input: DeterministicAuthorityInput,
): AuthorityMutation {
  if (state.task.status !== "stopping") conflict("Task is no longer stopping");
  const execution = state.execution;
  if (execution && command.generation && execution.generation !== command.generation) {
    conflict("Stop settlement belongs to an older Execution generation");
  }
  const nextExecution =
    execution?.status === "cancel_requested"
      ? updateExecution(execution, input.now, {
          status: command.orphaned ? "orphaned" : "canceled",
          completedAt: input.now,
          summary: command.orphaned
            ? "Provider interrupt could not be confirmed; late events remain fenced."
            : "Execution stopped by user command.",
        })
      : execution;
  const task = updateTask(state.task, input.now, {
    status: "stopped",
    pendingControl: null,
    currentExecutionId: null,
    summary: command.orphaned
      ? "Stopped with an orphaned Provider execution in cancel quarantine."
      : "Stopped by user command.",
  });
  return mutation(state, task, nextExecution ?? null, input.now, {
    cancelPendingApprovals: true,
    quarantine: command.orphaned,
    effects: command.orphaned
      ? nextExecution
        ? [
            {
              type: "quarantine_execution",
              executionId: nextExecution.id,
              generation: nextExecution.generation,
            },
          ]
        : []
      : [{ type: "release_task_runtime", taskId: task.id }],
  });
}

function transitionRestartInterrupted(
  state: AuthorityState,
  input: DeterministicAuthorityInput,
): AuthorityMutation {
  const execution = state.execution;
  if (!execution || TERMINAL_EXECUTION_STATUSES.has(execution.status)) {
    return mutation(state, state.task, execution, input.now);
  }
  const nextExecution = updateExecution(execution, input.now, {
    status: "canceled",
    completedAt: input.now,
    summary: "Daemon restarted before this Provider execution could be resumed.",
  });
  const task = updateTask(state.task, input.now, {
    status: state.task.mode === "loop" ? "reorienting" : "interrupted",
    currentExecutionId: null,
    summary:
      state.task.mode === "loop"
        ? "Provider context must be freshly reoriented after daemon restart."
        : "Quick execution was interrupted by daemon restart and was not replayed.",
  });
  return mutation(state, task, nextExecution, input.now, {
    cancelPendingApprovals: true,
    effects:
      task.mode === "loop"
        ? [{ type: "schedule_task", taskId: task.id }]
        : [{ type: "release_task_runtime", taskId: task.id }],
  });
}

function transitionTaskControl(
  state: AuthorityState,
  command: Extract<AuthorityCommand, { type: "task.control" }>,
  input: DeterministicAuthorityInput,
): AuthorityMutation {
  requireRevision(state.task, command.expectedRevision);
  const execution = state.execution;
  const active = execution !== null && ACTIVE_EXECUTION_STATUSES.has(execution.status);
  let task = state.task;
  let nextExecution = execution;
  let decision: HumanDecisionRecord | undefined;
  let effects: AuthorityEffect[] = [];
  let quarantine = false;

  if (command.command === "stop") {
    if (["stopped", "completed"].includes(task.status)) conflict(`Task is already ${task.status}`);
    task = updateTask(task, input.now, {
      status: "stopping",
      pendingControl: "stop",
      summary: active ? "Canceling the active Provider execution." : "Finalizing Task stop.",
    });
    if (active && execution) {
      nextExecution = updateExecution(execution, input.now, { status: "cancel_requested" });
      effects = [
        {
          type: "interrupt_execution",
          executionId: execution.id,
          generation: execution.generation,
        },
      ];
    }
  } else if (command.command === "pause") {
    if (["completed", "stopped"].includes(task.status)) conflict(`Task is already ${task.status}`);
    task = updateTask(task, input.now, {
      status: active ? task.status : "paused",
      pendingControl: active ? "pause" : null,
      summary: active
        ? "Pause is armed for the next safe phase boundary."
        : "Paused at a safe phase boundary.",
    });
  } else if (command.command === "resume") {
    if (task.mode !== "loop") invalid("Quick Tasks cannot resume after terminal execution");
    if (!["paused", "blocked", "interrupted", "budget_wait", "reorienting"].includes(task.status)) {
      conflict(`Task cannot resume while ${task.status}`);
    }
    task = updateTask(task, input.now, {
      status: "reorienting",
      pendingControl: null,
      summary: "Resume accepted; Task will freshly orient against current Workspace reality.",
      workingSet:
        task.status === "interrupted"
          ? {
              ...task.workingSet,
              noProgressCount: 0,
              revision: task.workingSet.revision + 1,
              updatedAt: input.now,
            }
          : task.workingSet,
    });
    effects = [{ type: "schedule_task", taskId: task.id }];
  } else if (command.command === "raise_budget") {
    const strength = raiseStrength(task.budget.strength);
    if (strength === task.budget.strength) conflict("Task already has unbounded Review budget");
    task = updateTask(task, input.now, {
      status: task.status === "budget_wait" ? "reorienting" : task.status,
      pendingControl: null,
      budget: {
        ...task.budget,
        strength,
        maxNonCompleteReviews: nonCompleteReviewLimit(strength),
      },
      summary: `Review budget raised to ${strength}.`,
    });
    if (task.status === "reorienting") effects = [{ type: "schedule_task", taskId: task.id }];
  } else {
    if (task.mode !== "loop") invalid("Review-only is available only for Loop Tasks");
    if (active) conflict("Review-only cannot replace an active Execution");
    task = updateTask(task, input.now, {
      status: "queued",
      pendingControl: "review_only",
      summary: "A fresh independent Review is queued without a new Executor attempt.",
    });
    effects = [{ type: "schedule_task", taskId: task.id }];
  }

  decision = humanDecision({
    id: requiredId(input.ids?.decisionId, "decisionId"),
    workspaceId: task.workspaceId,
    taskId: task.id,
    turnId: null,
    cardId: null,
    kind: `task_control_${command.command}`,
    displayed: { command: command.command, taskStatus: state.task.status },
    rawAnswer: command.command,
    normalized: { command: command.command, resultingStatus: task.status },
    actorId: command.actorId,
    clientId: command.clientId,
    deviceId: command.deviceId ?? null,
    commandId: command.commandId,
    expectedRevision: command.expectedRevision,
    resultRevision: task.revision,
    supersedesDecisionId: null,
    fidelity: "exact",
    decidedAt: input.now,
  });
  return mutation(state, task, nextExecution, input.now, {
    decision,
    effects,
    quarantine,
    cancelPendingApprovals: command.command === "stop",
  });
}

function transitionTaskDecision(
  state: AuthorityState,
  command: Extract<AuthorityCommand, { type: "task.decision.answered" }>,
  input: DeterministicAuthorityInput,
): AuthorityMutation {
  requireRevision(state.task, command.expectedRevision);
  const pending = state.pendingDecision ?? state.task.pendingDecision;
  if (!pending || pending.id !== command.decisionId) conflict("Task decision is no longer pending");
  if (pending.kind !== "final_confirmation") {
    invalid(
      "Contract-changing decisions must be resolved through the source Agent Clarify session",
    );
  }
  const selected = pending.options.find((option) => option.id === command.optionId);
  if (!selected) invalid(`Decision option ${command.optionId} does not belong to ${pending.id}`);
  if (!["accept", "reopen"].includes(selected.id))
    invalid("Final confirmation has invalid options");
  const task = updateTask(state.task, input.now, {
    status: selected.id === "accept" ? "completed" : "reorienting",
    completionAuthority: selected.id === "accept" ? "human_accepted" : "none",
    pendingDecision: null,
    summary:
      selected.id === "accept"
        ? "Human final acceptance recorded."
        : command.note?.trim() || "Human reopened the Task after final Review.",
    workingSet: {
      ...state.task.workingSet,
      nextMove:
        selected.id === "accept"
          ? "No next move; completion was accepted."
          : "Freshly reorient using the Human reopening note and current Workspace reality.",
      revision: state.task.workingSet.revision + 1,
      updatedAt: input.now,
    },
  });
  const decision = humanDecision({
    id: requiredId(input.ids?.decisionId, "decisionId"),
    workspaceId: task.workspaceId,
    taskId: task.id,
    turnId: null,
    cardId: null,
    kind: "task_final_confirmation",
    displayed: pending,
    rawAnswer: { optionId: command.optionId, note: command.note ?? null },
    normalized: { optionId: selected.id, label: selected.label, note: command.note ?? null },
    actorId: command.actorId,
    clientId: command.clientId,
    deviceId: command.deviceId ?? null,
    commandId: command.commandId,
    expectedRevision: command.expectedRevision,
    resultRevision: task.revision,
    supersedesDecisionId: null,
    fidelity: "exact",
    decidedAt: input.now,
  });
  return mutation(state, task, state.execution, input.now, {
    decision,
    decisionRequest: {
      type: "answer",
      requestId: pending.id,
      decisionId: decision.id,
      answeredAt: input.now,
    },
    effects:
      selected.id === "reopen"
        ? [{ type: "schedule_task", taskId: task.id }]
        : [{ type: "release_task_runtime", taskId: task.id }],
  });
}

function transitionContractRevised(
  state: AuthorityState,
  command: Extract<AuthorityCommand, { type: "task.contract.revised" }>,
  input: DeterministicAuthorityInput,
): AuthorityMutation {
  requireRevision(state.task, command.expectedRevision);
  const pending = state.pendingDecision ?? state.task.pendingDecision;
  if (!pending || pending.id !== command.decisionRequestId || pending.kind !== "contract_change") {
    conflict("Task contract decision is no longer pending");
  }
  if (
    command.contract.taskId !== state.task.id ||
    command.contract.workspaceId !== state.task.workspaceId ||
    command.contract.sourceAgentId !== state.task.sourceAgentId
  ) {
    invalid("Revised Intent Contract does not belong to this Task lineage");
  }
  if (command.contract.status !== "confirmed") invalid("Revised Intent Contract is not confirmed");
  if (command.contract.revision <= state.task.intentContract.revision) {
    invalid("Revised Intent Contract must advance the contract revision");
  }
  const task = updateTask(state.task, input.now, {
    title: command.contract.title,
    intentContract: command.contract,
    status: "reorienting",
    pendingDecision: null,
    completionAuthority: "none",
    summary: "Human-confirmed Intent Contract revision recorded; fresh reorientation is required.",
    workingSet: {
      ...state.task.workingSet,
      activeGap: command.contract.objective,
      currentUnderstanding: "Intent Contract changed through the source Agent Clarify session.",
      currentHypothesis: "",
      nextMove: "Freshly orient against the revised Task Anchor and current Workspace reality.",
      blockers: [],
      noProgressCount: 0,
      revision: state.task.workingSet.revision + 1,
      updatedAt: input.now,
    },
  });
  return mutation(state, task, state.execution, input.now, {
    decisionRequest: {
      type: "answer",
      requestId: pending.id,
      decisionId: command.decisionRecordId,
      answeredAt: input.now,
    },
    effects: [{ type: "schedule_task", taskId: task.id }],
  });
}

function assertCompleteEvidence(task: TaskProjection, review: ThothLoopReviewDecisionInput): void {
  const expected = new Set(task.intentContract.acceptanceClaims.map((claim) => claim.id));
  const actual = new Set(Object.keys(review.acceptanceEvidence));
  if (expected.size !== actual.size || [...expected].some((claimId) => !actual.has(claimId))) {
    invalid("Complete Review must map every Acceptance Claim to evidence");
  }
  for (const claimId of expected) {
    const evidence = review.acceptanceEvidence[claimId];
    if (!evidence || evidence.length === 0) {
      invalid(`Acceptance Claim ${claimId} has no evidence`);
    }
  }
}

function requireSemanticExecution(
  state: AuthorityState,
  generation: string,
  phase?: ExecutionProjection["phase"],
): ExecutionProjection {
  const execution = requireExecutionGeneration(state, generation);
  if (phase && execution.phase !== phase) invalid(`Expected ${phase}, received ${execution.phase}`);
  if (state.task.currentExecutionId !== execution.id || state.task.status === "stopping") {
    conflict("Execution no longer owns Task mutation authority");
  }
  if (!execution.attachment || execution.attachment.status !== "attached") {
    invalid("Execution has no durable RuntimeBundle attachment receipt");
  }
  if (!ACTIVE_EXECUTION_STATUSES.has(execution.status)) conflict("Execution is not active");
  return execution;
}

function requireExecutionGeneration(
  state: AuthorityState,
  generation: string,
): ExecutionProjection {
  const execution = state.execution;
  if (!execution || execution.generation !== generation) {
    conflict("Execution generation is stale");
  }
  return execution;
}

function requireActiveExecution(state: AuthorityState, executionId: string): ExecutionProjection {
  const execution = state.execution;
  if (
    !execution ||
    execution.id !== executionId ||
    !ACTIVE_EXECUTION_STATUSES.has(execution.status)
  ) {
    conflict("Execution is no longer active");
  }
  return execution;
}

function requireRevision(task: TaskProjection, expected: number): void {
  if (task.revision !== expected)
    conflict(`Task revision changed from ${expected} to ${task.revision}`);
}

function updateTask(
  task: TaskProjection,
  now: string,
  patch: Partial<TaskProjection>,
): TaskProjection {
  return { ...task, ...patch, revision: task.revision + 1, updatedAt: now };
}

function updateExecution(
  execution: ExecutionProjection,
  now: string,
  patch: Partial<ExecutionProjection>,
): ExecutionProjection {
  return {
    ...execution,
    ...patch,
    revision: execution.revision + 1,
    lastActivityAt: now,
    latestApproval: execution.latestApproval,
  };
}

function mutation(
  state: AuthorityState,
  task: TaskProjection,
  execution: ExecutionProjection | null,
  _now: string,
  options: {
    approval?: ExecutionApprovalProjection | null;
    decision?: HumanDecisionRecord;
    decisionRequest?: AuthorityDecisionRequestMutation;
    evidence?: AuthorityEvidenceAppend[];
    reviewDecision?: ReviewDecisionProjection;
    cancelPendingApprovals?: boolean;
    quarantine?: boolean;
    effects?: AuthorityEffect[];
  } = {},
): AuthorityMutation {
  return {
    task,
    execution,
    approval: options.approval,
    decision: options.decision,
    decisionRequest: options.decisionRequest,
    evidence: options.evidence ?? [],
    reviewDecision: options.reviewDecision,
    cancelPendingApprovals: options.cancelPendingApprovals ?? false,
    quarantine: options.quarantine ?? false,
    projectionDelta: {
      workspaceRevision: state.workspaceRevision + 1,
      changedTaskIds: [task.id],
      changedExecutionIds: execution ? [execution.id] : [],
    },
    effects: options.effects ?? [],
  };
}

function humanDecision(input: HumanDecisionRecord): HumanDecisionRecord {
  return input;
}

function replaceWorkUnit(
  workUnits: readonly WorkUnitProjection[],
  replacement: WorkUnitProjection,
): WorkUnitProjection[] {
  return workUnits.map((workUnit) => (workUnit.id === replacement.id ? replacement : workUnit));
}

function reviewNextMove(
  decision: ThothLoopReviewDecisionInput["decision"],
  budgetExhausted: boolean,
): string {
  if (budgetExhausted) return "Wait for a Human budget decision without claiming completion.";
  switch (decision) {
    case "continue":
      return "Choose the next meaningful Work Unit against the active gap.";
    case "reorient":
      return "Reset context and freshly orient against the Task Anchor and Review evidence.";
    case "complete":
      return "No next execution; completion evidence is recorded.";
    case "need_human":
      return "Resume only after the source Agent Clarify session records the Human-owned decision.";
    case "blocked":
      return "Resolve the external blocker before resuming execution.";
  }
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function raiseStrength(strength: TaskStrength): TaskStrength {
  switch (strength) {
    case "single":
      return "light";
    case "light":
      return "balanced";
    case "balanced":
    case "infinite":
      return "infinite";
  }
}

export function nonCompleteReviewLimit(strength: TaskStrength): number | null {
  switch (strength) {
    case "single":
      return 1;
    case "light":
      return 5;
    case "balanced":
      return 10;
    case "infinite":
      return null;
  }
}

function requiredId(value: string | undefined, name: string): string {
  if (!value) invalid(`Deterministic authority input is missing ${name}`);
  return value;
}

function conflict(message: string): never {
  throw new AuthorityTransitionError("conflict", message);
}

function invalid(message: string): never {
  throw new AuthorityTransitionError("invalid", message);
}
