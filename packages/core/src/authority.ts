import { createHash } from "node:crypto";
import type {
  ExecutionApprovalDecision,
  ExecutionApprovalProjection,
  ExecutionLifecycle,
  ExecutionProjection,
  HumanDecisionRecord,
  TaskBlackboardEntry,
  TaskCommand,
  TaskProjection,
  TaskStrength,
  TaskUserDecisionProjection,
} from "@thoth/protocol/task-authority";
import type {
  ThothLoopPlanExecResultInput,
  ThothLoopReportBlockedInput,
  ThothLoopReviewIndependentAssessmentInput,
  ThothLoopReviewVerdictInput,
} from "@thoth/protocol/thoth-runtime-contract";
import type { AgentThothLifecycle } from "@thoth/protocol/thoth/rpc-schemas";

const ACTIVE_EXECUTION_STATUSES = new Set<ExecutionLifecycle>([
  "created",
  "starting",
  "planning",
  "awaiting_implementation",
  "implementing",
  "running",
  "awaiting_provider",
  "awaiting_user",
]);
const TERMINAL_EXECUTION_STATUSES = new Set<ExecutionLifecycle>([
  "canceled",
  "succeeded",
  "failed",
  "orphaned",
]);

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
  goalsRevision?: number;
  latestPlanExecReport?: unknown;
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
    kind: "clarify_card" | "task_card" | "goal_card";
    status: "pending" | "answered" | "canceled" | "blocked";
    displayed: unknown;
  };
}

export interface DeterministicAuthorityInput {
  now: string;
  ids?: {
    decisionId?: string;
    decisionRequestId?: string;
    blackboardIds?: readonly string[];
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
      type: "execution.planexec.completed";
      generation: string;
      result: ThothLoopPlanExecResultInput;
    }
  | {
      type: "execution.review.assessed";
      generation: string;
      assessment: ThothLoopReviewIndependentAssessmentInput;
    }
  | {
      type: "execution.review.completed";
      generation: string;
      verdict: ThothLoopReviewVerdictInput;
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
    } & ActorCommand);

export interface AuthorityBlackboardAppend {
  id: string;
  taskId: string;
  kind: TaskBlackboardEntry["kind"];
  producer: TaskBlackboardEntry["producer"];
  content: unknown;
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
  | { type: "release_task_runtime"; taskId: string };

export interface AuthorityMutation {
  task: TaskProjection;
  execution: ExecutionProjection | null;
  approval?: ExecutionApprovalProjection | null;
  decision?: HumanDecisionRecord;
  decisionRequest?: AuthorityDecisionRequestMutation;
  blackboard: readonly AuthorityBlackboardAppend[];
  phaseRunStatus?: "succeeded" | "interrupted";
  cancelPendingApprovals: boolean;
  goalsRevision?: number;
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
  sourceAgentId: string;
  mode: "quick" | "loop";
  title: string;
  goal: string;
  constraints: readonly string[];
  acceptance: readonly string[];
  strength: TaskStrength;
  goals: readonly {
    sourceId: string;
    order: number;
    title: string;
    goal: string;
    constraints: readonly string[];
    acceptance: readonly string[];
  }[];
  now: string;
}

export function createTaskAuthority(input: CreateTaskAuthorityInput): TaskProjection {
  const goals = input.goals
    .slice()
    .sort((left, right) => left.order - right.order)
    .map((goal) => ({
      id: deriveDurableGoalId({
        taskId: input.id,
        sourceGoalId: goal.sourceId,
        order: goal.order,
        lineage: "approved-goals",
      }),
      order: goal.order,
      title: goal.title,
      goal: goal.goal,
      constraints: [...goal.constraints],
      acceptance: [...goal.acceptance],
      status: "queued" as const,
      revision: 1,
    }));
  const firstGoal = goals[0];
  if (!firstGoal) invalid("Task registration requires at least one approved goal");
  return {
    id: input.id,
    workspaceId: input.workspaceId,
    sourceAgentId: input.sourceAgentId,
    mode: input.mode,
    title: input.title,
    goal: input.goal,
    constraints: [...input.constraints],
    acceptance: [...input.acceptance],
    origin: null,
    status: "queued",
    summary: "Approved task queued for execution.",
    currentGoalId: firstGoal.id,
    currentExecutionId: null,
    goals,
    latestReviewDirection: null,
    pendingDecision: null,
    budget: {
      strength: input.strength,
      usedFailedReviews: 0,
      maxFailedReviews: failedReviewLimit(input.strength),
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
      return transitionQuickExecutionSettled(authority, command, input);
    case "execution.approval.requested":
      return transitionApprovalRequested(authority, command, input);
    case "execution.approval.resolved":
      return transitionApprovalResolved(authority, command, input);
    case "execution.planexec.completed":
      return transitionPlanExecCompleted(authority, command, input);
    case "execution.review.assessed":
      return transitionReviewAssessed(authority, command, input);
    case "execution.review.completed":
      return transitionReviewCompleted(authority, command, input);
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
  }
}

function transitionForegroundCard(
  state: ForegroundCardAuthorityState,
  command: ForegroundAuthorityCommand,
  input: DeterministicAuthorityInput,
): ForegroundAuthorityMutation {
  if (state.agent.revision !== command.expectedRevision) {
    conflict("The Agent Thoth state changed before this card answer was applied.");
  }
  if (
    state.card.status !== "pending" ||
    state.card.agentId !== state.agent.id ||
    state.card.turnId !== state.turn.id ||
    state.agent.activeTurnId !== state.turn.id ||
    state.turn.agentId !== state.agent.id
  ) {
    conflict("This authority card no longer belongs to the active Agent turn.");
  }
  const revision = state.agent.revision + 1;
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
    decision: {
      id: requireId(input.ids?.decisionId, "decisionId"),
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
    },
    projectionDelta: {
      workspaceRevision: state.workspaceRevision + 1,
      changedTaskIds: [],
      changedExecutionIds: [],
    },
  };
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
  return mutation(
    state,
    state.task,
    updateExecution(execution, input.now, {
      status: command.status,
      summary: command.summary === undefined ? execution.summary : command.summary,
      completedAt: TERMINAL_EXECUTION_STATUSES.has(command.status)
        ? input.now
        : execution.completedAt,
      runModeReceipt:
        command.runModeReceipt === undefined ? execution.runModeReceipt : command.runModeReceipt,
    }),
  );
}

function transitionQuickExecutionSettled(
  state: AuthorityState,
  command: Extract<AuthorityCommand, { type: "execution.quick.settled" }>,
  input: DeterministicAuthorityInput,
): AuthorityMutation {
  const execution = requireExecutionGeneration(state, command.generation);
  if (state.task.mode !== "quick" || execution.phase !== "quick_exec") {
    invalid("Quick settlement requires a Quick Task and quick_exec ExecutionAttempt");
  }
  if (
    state.task.currentExecutionId !== execution.id ||
    state.task.status === "stopping" ||
    TERMINAL_EXECUTION_STATUSES.has(execution.status)
  ) {
    conflict(`Execution ${execution.id} no longer owns Quick Task ${state.task.id}`);
  }
  if (!execution.goalId) invalid("Quick execution is missing its Goal identity");
  const currentGoal = state.task.goals.find((goal) => goal.id === execution.goalId);
  if (!currentGoal || currentGoal.status !== "running") {
    conflict(`Quick Goal ${execution.goalId} is no longer running`);
  }

  const succeeded = command.status === "succeeded";
  const goals = updateGoal(
    state.task.goals,
    execution.goalId,
    succeeded ? "passed" : "interrupted",
    "running",
  );
  return mutation(
    state,
    updateTask(state.task, input.now, {
      status: succeeded ? "completed" : "interrupted",
      summary: command.summary,
      currentGoalId: succeeded ? null : execution.goalId,
      currentExecutionId: null,
      goals,
    }),
    updateExecution(execution, input.now, {
      status: command.status,
      summary: command.summary,
      completedAt: input.now,
    }),
    {
      blackboard: [
        blackboard(input, 0, state.task.id, succeeded ? "evidence_summary" : "blocker", "daemon", {
          executionId: execution.id,
          status: command.status,
          summary: command.summary,
        }),
      ],
      phaseRunStatus: succeeded ? "succeeded" : "interrupted",
      effects: [{ type: "release_task_runtime", taskId: state.task.id }],
    },
  );
}

function transitionTaskControl(
  state: AuthorityState,
  command: Extract<AuthorityCommand, { type: "task.control" }>,
  input: DeterministicAuthorityInput,
): AuthorityMutation {
  const { task } = state;
  requireRevision(task, command.expectedRevision);
  if (["stopping", "stopped"].includes(task.status)) {
    invalid(`Cannot ${command.command} a ${task.status} task`);
  }
  const execution = state.execution;
  const active = execution !== null && ACTIVE_EXECUTION_STATUSES.has(execution.status);
  let nextTask = task;
  let nextExecution = execution;
  let effects: AuthorityEffect[] = [];
  let cancelPendingApprovals = false;
  let quarantine = false;

  if (command.command === "stop") {
    if (task.status === "completed") invalid("Cannot stop a completed task");
    nextTask = updateTask(task, input.now, {
      status: "stopping",
      pendingControl: "stop",
      summary: "Stopping the active execution.",
    });
    if (active && execution) {
      nextExecution = updateExecution(execution, input.now, {
        status: "cancel_requested",
        summary: "Cancellation requested by the user.",
      });
      cancelPendingApprovals = true;
      effects = [
        {
          type: "interrupt_execution",
          executionId: execution.id,
          generation: execution.generation,
        },
      ];
    }
  } else {
    let status = task.status;
    let summary = task.summary;
    let pendingControl: TaskCommand | null = null;
    let strength = task.budget.strength;
    let maxFailedReviews = task.budget.maxFailedReviews;
    switch (command.command) {
      case "pause":
        if (task.status === "completed") invalid("Cannot pause a completed task");
        status = active ? task.status : "paused";
        pendingControl = active ? "pause" : null;
        summary = active
          ? "Pause requested; the task will pause at the current phase boundary."
          : "Paused by the user.";
        break;
      case "resume":
        if (!["paused", "interrupted", "budget_wait"].includes(task.status)) {
          invalid(`Cannot resume a ${task.status} task`);
        }
        status = "queued";
        summary = "Resume requested; the task is queued for execution.";
        effects = [{ type: "schedule_task", taskId: task.id }];
        break;
      case "raise_budget": {
        if (task.status === "completed") invalid("Cannot raise the budget of a completed task");
        const raised = nextTaskStrength(strength);
        if (!raised) invalid("The task already has the maximum Review budget");
        strength = raised.strength;
        maxFailedReviews = raised.maxFailedReviews;
        status = task.status === "budget_wait" ? "queued" : task.status;
        summary = "A budget extension was approved by the user.";
        break;
      }
      case "review_only":
        status = "queued";
        pendingControl = "review_only";
        summary = "An independent Review was requested by the user.";
        effects = [{ type: "schedule_task", taskId: task.id }];
        break;
    }
    nextTask = updateTask(task, input.now, {
      status,
      summary,
      pendingControl,
      budget: { ...task.budget, strength, maxFailedReviews },
    });
  }

  const decision = humanDecision({
    state,
    input,
    command,
    kind: `task_${command.command}`,
    displayed: { command: command.command, taskId: task.id, taskTitle: task.title },
    rawAnswer: { command: command.command },
    normalized: { controlIntent: command.command },
    resultRevision: nextTask.revision,
  });
  return mutation(state, nextTask, nextExecution, {
    decision,
    cancelPendingApprovals,
    quarantine,
    effects,
  });
}

function transitionExecutionCreated(
  state: AuthorityState,
  command: Extract<AuthorityCommand, { type: "execution.created" }>,
  input: DeterministicAuthorityInput,
): AuthorityMutation {
  if (command.execution.taskId !== state.task.id) invalid("Execution belongs to another Task");
  const goals = command.execution.goalId
    ? state.task.goals.map((goal) =>
        goal.id === command.execution.goalId && ["queued", "interrupted"].includes(goal.status)
          ? { ...goal, status: "running" as const, revision: goal.revision + 1 }
          : goal,
      )
    : state.task.goals;
  return mutation(
    state,
    updateTask(state.task, input.now, {
      status: "running",
      currentExecutionId: command.execution.id,
      pendingControl:
        command.execution.phase === "review" && state.task.pendingControl === "review_only"
          ? null
          : state.task.pendingControl,
      goals,
    }),
    command.execution,
  );
}

function transitionApprovalRequested(
  state: AuthorityState,
  command: Extract<AuthorityCommand, { type: "execution.approval.requested" }>,
  input: DeterministicAuthorityInput,
): AuthorityMutation {
  const execution = requireActiveExecution(state, command.approval.executionId);
  if (command.approval.taskId !== state.task.id || command.approval.status !== "pending") {
    invalid("Execution approval does not belong to the active Task");
  }
  const implementing = command.approval.kind === "implement";
  return mutation(
    state,
    updateTask(state.task, input.now, {
      summary: implementing
        ? "Native Plan is ready for implementation approval."
        : "Provider approval is waiting for a user decision.",
    }),
    updateExecution(execution, input.now, {
      status: implementing ? "awaiting_implementation" : "awaiting_user",
    }),
    { approval: command.approval },
  );
}

function transitionApprovalResolved(
  state: AuthorityState,
  command: Extract<AuthorityCommand, { type: "execution.approval.resolved" }>,
  input: DeterministicAuthorityInput,
): AuthorityMutation {
  const execution = requireActiveExecution(state, state.approval?.executionId);
  const approval = state.approval;
  if (
    !approval ||
    approval.status !== "pending" ||
    approval.revision !== command.expectedRevision
  ) {
    conflict("Execution approval changed before this decision was committed.");
  }
  if (approval.kind === "implement" && !["implement", "deny"].includes(command.decision)) {
    invalid("A native Plan approval requires Implement or Deny.");
  }
  if (approval.kind !== "implement" && command.decision === "implement") {
    invalid("Implement is only valid for a native Plan approval.");
  }
  const denied = command.decision === "deny";
  const nextApproval: ExecutionApprovalProjection = {
    ...approval,
    status: denied ? "denied" : "allowed",
    resolution: { decision: command.decision, actorId: command.actorId, resolvedAt: input.now },
    revision: approval.revision + 1,
    updatedAt: input.now,
  };
  const nextExecution = updateExecution(execution, input.now, {
    status: denied
      ? "failed"
      : approval.kind === "implement"
        ? "implementing"
        : "awaiting_provider",
    completedAt: denied ? input.now : null,
    summary: denied ? "Provider approval was denied." : execution.summary,
  });
  const nextTask = updateTask(state.task, input.now, {
    status: denied ? "interrupted" : "running",
    summary: denied
      ? "Provider approval was denied; resume reruns this phase."
      : approval.kind === "implement"
        ? "Native Plan approved; implementation is running."
        : "Provider approval resolved; execution is continuing.",
    currentExecutionId: denied ? null : execution.id,
  });
  const decision = command.recordHumanDecision
    ? humanDecision({
        state,
        input,
        command,
        kind: "execution_approval",
        displayed: approval.displayed,
        rawAnswer: { decision: command.decision },
        normalized: {
          approvalId: approval.id,
          executionId: execution.id,
          kind: approval.kind,
          decision: command.decision,
        },
        expectedRevision: command.expectedRevision,
        resultRevision: nextTask.revision,
      })
    : undefined;
  return mutation(state, nextTask, nextExecution, { approval: nextApproval, decision });
}

function transitionPlanExecCompleted(
  state: AuthorityState,
  command: Extract<AuthorityCommand, { type: "execution.planexec.completed" }>,
  input: DeterministicAuthorityInput,
): AuthorityMutation {
  const execution = requireSemanticExecution(state, command.generation, "planexec");
  const paused = state.task.pendingControl === "pause";
  const blackboardRows = [
    blackboard(input, 0, state.task.id, "planexec_report", "planexec", command.result),
  ];
  return mutation(
    state,
    updateTask(state.task, input.now, {
      status: paused ? "paused" : "queued",
      summary: paused
        ? "Paused after PlanExec; independent Review remains queued."
        : "PlanExec completed; independent Review is queued.",
      currentExecutionId: null,
      pendingControl: null,
    }),
    updateExecution(execution, input.now, {
      status: "succeeded",
      summary: command.result.execution_summary,
      completedAt: input.now,
    }),
    { blackboard: blackboardRows, phaseRunStatus: "succeeded" },
  );
}

function transitionReviewAssessed(
  state: AuthorityState,
  command: Extract<AuthorityCommand, { type: "execution.review.assessed" }>,
  input: DeterministicAuthorityInput,
): AuthorityMutation {
  requireSemanticExecution(state, command.generation, "review");
  if (state.latestPlanExecReport === undefined) {
    invalid("Review cannot compare reality before a PlanExec report exists");
  }
  return mutation(state, state.task, state.execution, {
    blackboard: [
      blackboard(input, 0, state.task.id, "review_assessment", "review", command.assessment),
    ],
  });
}

function transitionReviewCompleted(
  state: AuthorityState,
  command: Extract<AuthorityCommand, { type: "execution.review.completed" }>,
  input: DeterministicAuthorityInput,
): AuthorityMutation {
  const execution = requireSemanticExecution(state, command.generation, "review");
  if (!execution.goalId) invalid("Review execution is missing its Goal identity");
  const current = state.task.goals.find((goal) => goal.id === execution.goalId);
  if (!current) invalid(`Goal ${execution.goalId} does not belong to Task ${state.task.id}`);

  const blackboardRows: AuthorityBlackboardAppend[] = [];
  const append = (
    kind: TaskBlackboardEntry["kind"],
    producer: TaskBlackboardEntry["producer"],
    content: unknown,
  ) =>
    blackboardRows.push(
      blackboard(input, blackboardRows.length, state.task.id, kind, producer, content),
    );
  append("evidence_summary", "review", {
    outcome: command.verdict.outcome,
    summary: command.verdict.summary,
    evidenceSummary: command.verdict.evidence_summary ?? null,
  });
  if (command.verdict.direction_memo)
    append("review_direction", "review", command.verdict.direction_memo);

  let decisionRequest: AuthorityDecisionRequestMutation | undefined;
  let pendingDecision = state.task.pendingDecision;
  if (command.verdict.user_decision) {
    const request: TaskUserDecisionProjection = {
      id: requireId(input.ids?.decisionRequestId, "decisionRequestId"),
      title: command.verdict.user_decision.title,
      question: command.verdict.user_decision.question,
      options: command.verdict.user_decision.options,
      ...(command.verdict.user_decision.note_placeholder === undefined
        ? {}
        : { notePlaceholder: command.verdict.user_decision.note_placeholder }),
      createdAt: input.now,
    };
    pendingDecision = request;
    decisionRequest = { type: "open", request };
    append("user_decision_request", "review", request);
  }
  if (command.verdict.deferred_goal_replan_proposal) {
    append("replan_proposal", "review", command.verdict.deferred_goal_replan_proposal);
  }

  let goals = state.task.goals;
  let nextTaskStatus: TaskProjection["status"] = "queued";
  let nextGoalId: string | null = current.id;
  let usedFailedReviews = state.task.budget.usedFailedReviews;
  let latestDirection = state.task.latestReviewDirection;
  let goalsRevision = state.goalsRevision;

  switch (command.verdict.outcome) {
    case "pass": {
      goals = updateGoal(goals, current.id, "passed");
      const next = goals.find((goal) => goal.order > current.order && goal.status === "queued");
      nextGoalId = next?.id ?? null;
      nextTaskStatus = next ? "queued" : "completed";
      break;
    }
    case "continue":
    case "reframe_current_goal":
      usedFailedReviews += 1;
      goals = updateGoal(goals, current.id, "queued");
      nextTaskStatus =
        usedFailedReviews >= state.task.budget.maxFailedReviews ? "budget_wait" : "queued";
      latestDirection = command.verdict.direction_memo
        ? JSON.stringify(command.verdict.direction_memo)
        : null;
      break;
    case "replan_unstarted_goals": {
      const replan = applyReplan(state, current.id, command.verdict);
      goals = replan.goals;
      goalsRevision = replan.goalsRevision;
      nextGoalId = replan.nextGoalId;
      nextTaskStatus = nextGoalId ? "queued" : "completed";
      break;
    }
    case "return_to_user_decision":
      goals = updateGoal(goals, current.id, "awaiting_user");
      nextTaskStatus = "awaiting_user";
      break;
    case "real_blocker":
      goals = updateGoal(goals, current.id, "blocked");
      nextTaskStatus = "blocked";
      append("blocker", "review", { summary: command.verdict.summary });
      break;
  }
  if (state.task.pendingControl === "pause" && nextTaskStatus === "queued") {
    nextTaskStatus = "paused";
  }
  const task = updateTask(state.task, input.now, {
    status: nextTaskStatus,
    summary: command.verdict.summary,
    currentGoalId: nextGoalId,
    currentExecutionId: null,
    goals,
    latestReviewDirection: latestDirection,
    pendingDecision,
    budget: { ...state.task.budget, usedFailedReviews },
    pendingControl: null,
  });
  return mutation(
    state,
    task,
    updateExecution(execution, input.now, {
      status: "succeeded",
      summary: command.verdict.summary,
      completedAt: input.now,
    }),
    { blackboard: blackboardRows, decisionRequest, goalsRevision, phaseRunStatus: "succeeded" },
  );
}

function transitionBlocked(
  state: AuthorityState,
  command: Extract<AuthorityCommand, { type: "execution.blocked" }>,
  input: DeterministicAuthorityInput,
): AuthorityMutation {
  const execution = requireSemanticExecution(state, command.generation);
  const goals = execution.goalId
    ? updateGoal(state.task.goals, execution.goalId, "blocked")
    : state.task.goals;
  return mutation(
    state,
    updateTask(state.task, input.now, {
      status: "blocked",
      summary: command.report.reason,
      currentExecutionId: null,
      goals,
    }),
    updateExecution(execution, input.now, {
      status: "failed",
      summary: command.report.reason,
      completedAt: input.now,
    }),
    {
      blackboard: [
        blackboard(
          input,
          0,
          state.task.id,
          "blocker",
          execution.phase === "review" ? "review" : "planexec",
          command.report,
        ),
      ],
    },
  );
}

function transitionInterrupted(
  state: AuthorityState,
  command: Extract<AuthorityCommand, { type: "execution.interrupted" }>,
  input: DeterministicAuthorityInput,
): AuthorityMutation {
  const execution = requireExecutionGeneration(state, command.generation);
  if (TERMINAL_EXECUTION_STATUSES.has(execution.status)) conflict("Execution is already terminal");
  if (execution.status === "cancel_requested" || state.task.status === "stopping") {
    conflict("Stop authority owns the active execution");
  }
  const goals = execution.goalId
    ? state.task.goals.map((goal) =>
        goal.id === execution.goalId && goal.status === "running"
          ? { ...goal, status: "interrupted" as const, revision: goal.revision + 1 }
          : goal,
      )
    : state.task.goals;
  return mutation(
    state,
    updateTask(state.task, input.now, {
      status: "interrupted",
      summary: command.summary,
      currentExecutionId: null,
      goals,
    }),
    updateExecution(execution, input.now, {
      status: "failed",
      summary: command.summary,
      completedAt: input.now,
    }),
    { phaseRunStatus: "interrupted" },
  );
}

function transitionStopSettled(
  state: AuthorityState,
  command: Extract<AuthorityCommand, { type: "execution.stop.settled" }>,
  input: DeterministicAuthorityInput,
): AuthorityMutation {
  if (state.task.status !== "stopping") conflict("Task is no longer stopping");
  let execution = state.execution;
  if (execution && command.generation && execution.generation !== command.generation) {
    conflict("Execution generation changed during Stop");
  }
  if (execution?.status === "cancel_requested") {
    execution = updateExecution(execution, input.now, {
      status: command.orphaned ? "orphaned" : "canceled",
      summary: command.orphaned
        ? "Provider interruption could not be confirmed; execution is quarantined."
        : "Execution canceled by the user.",
      completedAt: input.now,
    });
  }
  return mutation(
    state,
    updateTask(state.task, input.now, {
      status: "stopped",
      pendingControl: null,
      summary: command.orphaned
        ? "Stopped; an orphaned provider execution remains quarantined."
        : "Stopped by the user.",
    }),
    execution,
    {
      quarantine: command.orphaned,
      effects:
        command.orphaned && execution
          ? [
              {
                type: "quarantine_execution",
                executionId: execution.id,
                generation: execution.generation,
              },
            ]
          : [{ type: "release_task_runtime", taskId: state.task.id }],
    },
  );
}

function transitionRestartInterrupted(
  state: AuthorityState,
  input: DeterministicAuthorityInput,
): AuthorityMutation {
  const execution = state.execution;
  if (
    !execution ||
    (!ACTIVE_EXECUTION_STATUSES.has(execution.status) && execution.status !== "cancel_requested")
  ) {
    conflict("Execution is not recoverable after restart");
  }
  const stopping = state.task.status === "stopping" || execution.status === "cancel_requested";
  const summary = stopping
    ? "Daemon restarted before provider cancellation could be confirmed."
    : execution.status === "awaiting_implementation" || execution.status === "awaiting_user"
      ? "Daemon restarted while a provider approval callback was pending; this phase must be rerun."
      : "Daemon restarted while the provider execution was active.";
  const goals = execution.goalId
    ? updateGoal(state.task.goals, execution.goalId, stopping ? "stopped" : "interrupted")
    : state.task.goals;
  return mutation(
    state,
    updateTask(state.task, input.now, {
      status: stopping ? "stopped" : "interrupted",
      summary,
      currentExecutionId: null,
      pendingControl: null,
      goals,
    }),
    updateExecution(execution, input.now, {
      status: stopping ? "orphaned" : "failed",
      summary,
      completedAt: input.now,
    }),
    {
      cancelPendingApprovals: true,
      quarantine: stopping,
      effects: stopping
        ? [
            {
              type: "quarantine_execution",
              executionId: execution.id,
              generation: execution.generation,
            },
          ]
        : [],
    },
  );
}

function transitionTaskDecision(
  state: AuthorityState,
  command: Extract<AuthorityCommand, { type: "task.decision.answered" }>,
  input: DeterministicAuthorityInput,
): AuthorityMutation {
  requireRevision(state.task, command.expectedRevision);
  const pending = state.pendingDecision ?? state.task.pendingDecision;
  if (state.task.status !== "awaiting_user" || !state.task.currentGoalId) {
    invalid(`Task ${state.task.id} is not awaiting a user decision`);
  }
  if (!pending || pending.id !== command.decisionId) {
    conflict(`Task decision ${command.decisionId} is no longer pending`);
  }
  const selected = pending.options.find((option) => option.id === command.optionId);
  if (!selected) invalid(`Decision option ${command.optionId} does not belong to ${pending.id}`);
  const normalized = {
    decisionId: pending.id,
    option: selected,
    note: command.note?.trim() || null,
  };
  const task = updateTask(state.task, input.now, {
    status: "queued",
    summary: `User selected: ${selected.label}`,
    pendingControl: null,
    pendingDecision: null,
    goals: updateGoal(state.task.goals, state.task.currentGoalId, "queued", "awaiting_user"),
  });
  const decision = humanDecision({
    state,
    input,
    command,
    kind: "task_user_decision",
    displayed: pending,
    rawAnswer: { optionId: command.optionId, note: command.note ?? null },
    normalized,
    resultRevision: task.revision,
  });
  return mutation(state, task, state.execution, {
    decision,
    decisionRequest: {
      type: "answer",
      requestId: pending.id,
      decisionId: decision.id,
      answeredAt: input.now,
    },
    blackboard: [blackboard(input, 0, task.id, "human_decision", "user", normalized)],
    effects: [{ type: "schedule_task", taskId: task.id }],
  });
}

function applyReplan(
  state: AuthorityState,
  currentGoalId: string,
  verdict: ThothLoopReviewVerdictInput,
): { goals: TaskProjection["goals"]; goalsRevision: number; nextGoalId: string | null } {
  const proposal = verdict.deferred_goal_replan_proposal;
  if (!proposal) invalid("Review replan outcome is missing its proposal");
  if (state.goalsRevision === undefined || state.goalsRevision !== proposal.base_goals_revision) {
    conflict(
      `Goals revision changed before replan ${proposal.base_goals_revision} could be applied`,
    );
  }
  const current = state.task.goals.find((goal) => goal.id === currentGoalId);
  if (!current) invalid(`Current Goal ${currentGoalId} is missing`);
  const affected = new Set(proposal.affected_goal_ids);
  for (const goalId of affected) {
    const goal = state.task.goals.find((candidate) => candidate.id === goalId);
    if (!goal || goal.order <= current.order || goal.status !== "queued") {
      invalid(`Replan may only replace unstarted future Goal ${goalId}`);
    }
  }
  const proposedIds = new Set<string>();
  const proposedOrders = new Set<number>();
  for (const goal of proposal.goals) {
    if (proposedIds.has(goal.id) || proposedOrders.has(goal.order) || goal.order <= current.order) {
      invalid("Replanned Goals must have unique future ids and order values");
    }
    proposedIds.add(goal.id);
    proposedOrders.add(goal.order);
  }
  for (const existing of state.task.goals) {
    if (!affected.has(existing.id) && proposedOrders.has(existing.order)) {
      invalid(`Replanned Goal order ${existing.order} collides with an approved Goal`);
    }
  }
  const nextRevision = state.goalsRevision + 1;
  const replacements = proposal.goals.map((goal) => ({
    id: deriveDurableGoalId({
      taskId: state.task.id,
      sourceGoalId: goal.id,
      order: goal.order,
      lineage: `replan-${nextRevision}`,
    }),
    order: goal.order,
    title: goal.title,
    goal: goal.goal,
    constraints: [...goal.constraints],
    acceptance: [...goal.acceptance],
    status: "queued" as const,
    revision: 1,
  }));
  const goals = [
    ...state.task.goals
      .filter((goal) => !affected.has(goal.id))
      .map((goal) =>
        goal.id === current.id
          ? { ...goal, status: "passed" as const, revision: goal.revision + 1 }
          : goal,
      ),
    ...replacements,
  ].sort((left, right) => left.order - right.order);
  return {
    goals,
    goalsRevision: nextRevision,
    nextGoalId: replacements.toSorted((a, b) => a.order - b.order)[0]?.id ?? null,
  };
}

function mutation(
  state: AuthorityState,
  task: TaskProjection,
  execution: ExecutionProjection | null,
  options: Partial<Omit<AuthorityMutation, "task" | "execution" | "projectionDelta">> = {},
): AuthorityMutation {
  return {
    task,
    execution,
    blackboard: [],
    cancelPendingApprovals: false,
    quarantine: false,
    effects: [],
    ...options,
    projectionDelta: {
      workspaceRevision: state.workspaceRevision + 1,
      changedTaskIds: [task.id],
      changedExecutionIds: execution ? [execution.id] : [],
    },
  };
}

function requireSemanticExecution(
  state: AuthorityState,
  generation: string,
  phase?: "planexec" | "review",
): ExecutionProjection {
  const execution = requireExecutionGeneration(state, generation);
  const implementationMaySubmit = phase === "planexec" && execution.status === "implementing";
  if (
    (phase && execution.phase !== phase) ||
    (!implementationMaySubmit &&
      !["starting", "running", "awaiting_provider"].includes(execution.status))
  ) {
    conflict(`Execution ${execution.id} is not the active semantic tool authority`);
  }
  if (state.task.currentExecutionId !== execution.id || state.task.status === "stopping") {
    conflict(`Execution ${execution.id} no longer owns Task ${execution.taskId}`);
  }
  if (!execution.attachment || execution.attachment.status !== "attached") {
    conflict(`Execution ${execution.id} has no valid RuntimeBundle attachment`);
  }
  return execution;
}

function requireActiveExecution(state: AuthorityState, executionId?: string): ExecutionProjection {
  const execution = state.execution;
  if (
    !execution ||
    (executionId !== undefined && execution.id !== executionId) ||
    state.task.currentExecutionId !== execution.id ||
    state.task.status === "stopping" ||
    TERMINAL_EXECUTION_STATUSES.has(execution.status)
  ) {
    conflict("Execution changed before the authority mutation could be committed.");
  }
  return execution;
}

function requireExecutionGeneration(
  state: AuthorityState,
  generation: string,
): ExecutionProjection {
  const execution = state.execution;
  if (!execution || execution.generation !== generation) {
    conflict("Execution generation is no longer active");
  }
  return execution;
}

function requireRevision(task: TaskProjection, expected: number): void {
  if (task.revision !== expected) {
    conflict(`Task ${task.id} revision changed from ${expected} to ${task.revision}`);
  }
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
    lastActivityAt: now,
    revision: execution.revision + 1,
  };
}

function updateGoal(
  goals: TaskProjection["goals"],
  goalId: string,
  status: TaskProjection["goals"][number]["status"],
  onlyFrom?: TaskProjection["goals"][number]["status"],
): TaskProjection["goals"] {
  return goals.map((goal) =>
    goal.id === goalId && (!onlyFrom || goal.status === onlyFrom)
      ? { ...goal, status, revision: goal.revision + 1 }
      : goal,
  );
}

function blackboard(
  input: DeterministicAuthorityInput,
  index: number,
  taskId: string,
  kind: TaskBlackboardEntry["kind"],
  producer: TaskBlackboardEntry["producer"],
  content: unknown,
): AuthorityBlackboardAppend {
  return {
    id: requireId(input.ids?.blackboardIds?.[index], `blackboardIds[${index}]`),
    taskId,
    kind,
    producer,
    content,
    createdAt: input.now,
  };
}

function humanDecision(input: {
  state: AuthorityState;
  input: DeterministicAuthorityInput;
  command: ActorCommand;
  kind: string;
  displayed: unknown;
  rawAnswer: unknown;
  normalized: unknown;
  expectedRevision?: number;
  resultRevision: number;
}): HumanDecisionRecord {
  return {
    id: requireId(input.input.ids?.decisionId, "decisionId"),
    workspaceId: input.state.task.workspaceId,
    taskId: input.state.task.id,
    turnId: null,
    cardId: null,
    kind: input.kind,
    displayed: input.displayed,
    rawAnswer: input.rawAnswer,
    normalized: input.normalized,
    actorId: input.command.actorId,
    clientId: input.command.clientId,
    deviceId: input.command.deviceId ?? null,
    commandId: input.command.commandId,
    expectedRevision: input.expectedRevision ?? input.state.task.revision,
    resultRevision: input.resultRevision,
    supersedesDecisionId: null,
    fidelity: "exact",
    decidedAt: input.input.now,
  };
}

function nextTaskStrength(strength: TaskStrength): {
  strength: TaskStrength;
  maxFailedReviews: number;
} | null {
  switch (strength) {
    case "single":
      return { strength: "light", maxFailedReviews: 5 };
    case "light":
      return { strength: "balanced", maxFailedReviews: 10 };
    case "balanced":
      return { strength: "infinite", maxFailedReviews: 30 };
    case "infinite":
      return null;
  }
}

export function failedReviewLimit(strength: TaskStrength): number {
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

export function deriveDurableGoalId(input: {
  taskId: string;
  sourceGoalId: string;
  order: number;
  lineage: string;
}): string {
  const digest = createHash("sha256")
    .update(input.taskId)
    .update("\0")
    .update(input.lineage)
    .update("\0")
    .update(input.sourceGoalId)
    .update("\0")
    .update(String(input.order))
    .digest("hex")
    .slice(0, 32);
  return `goal-${digest}`;
}

function requireId(value: string | undefined, name: string): string {
  if (!value) invalid(`Deterministic authority input is missing ${name}`);
  return value;
}

function conflict(message: string): never {
  throw new AuthorityTransitionError("conflict", message);
}

function invalid(message: string): never {
  throw new AuthorityTransitionError("invalid", message);
}
