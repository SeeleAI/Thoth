import { describe, expect, it } from "vitest";
import type {
  ExecutionApprovalProjection,
  ExecutionProjection,
  TaskProjection,
} from "@thoth/protocol/task-authority";
import {
  AuthorityTransitionError,
  createTaskAuthority,
  deriveDurableGoalId,
  transitionAuthority,
  type AuthorityState,
  type DeterministicAuthorityInput,
} from "./authority.js";

const now = "2026-07-23T20:00:00.000Z";
const deterministic: DeterministicAuthorityInput = {
  now,
  ids: {
    decisionId: "decision-1",
    decisionRequestId: "decision-request-1",
    blackboardIds: Array.from({ length: 8 }, (_, index) => `blackboard-${index + 1}`),
  },
};

describe("transitionAuthority", () => {
  it("applies Task control without reading time or generating identity", () => {
    const state = authorityState();
    const paused = transitionAuthority(
      state,
      {
        type: "task.control",
        command: "pause",
        expectedRevision: 1,
        commandId: "command-pause",
        actorId: "human",
        clientId: "desktop",
      },
      deterministic,
    );
    expect(paused.task).toMatchObject({
      status: "running",
      pendingControl: "pause",
      revision: 2,
      updatedAt: now,
    });
    expect(paused.decision).toMatchObject({
      id: "decision-1",
      commandId: "command-pause",
      resultRevision: 2,
      decidedAt: now,
    });

    const stopped = transitionAuthority(
      state,
      {
        type: "task.control",
        command: "stop",
        expectedRevision: 1,
        commandId: "command-stop",
        actorId: "human",
        clientId: "desktop",
      },
      deterministic,
    );
    expect(stopped.task).toMatchObject({ status: "stopping", pendingControl: "stop" });
    expect(stopped.execution).toMatchObject({ status: "cancel_requested", revision: 2 });
    expect(stopped.cancelPendingApprovals).toBe(true);
    expect(stopped.effects).toEqual([
      {
        type: "interrupt_execution",
        executionId: "execution-1",
        generation: "generation-1",
      },
    ]);
  });

  it("rejects stale revision as an explicit authority conflict", () => {
    expect(() =>
      transitionAuthority(
        authorityState(),
        {
          type: "task.control",
          command: "pause",
          expectedRevision: 9,
          commandId: "stale",
          actorId: "human",
          clientId: "desktop",
        },
        deterministic,
      ),
    ).toThrowError(
      expect.objectContaining<Partial<AuthorityTransitionError>>({ kind: "conflict" }),
    );
  });

  it("moves PlanExec completion to the Review boundary atomically", () => {
    const mutation = transitionAuthority(
      authorityState(),
      {
        type: "execution.planexec.completed",
        generation: "generation-1",
        result: {
          plan_summary: "Plan",
          execution_summary: "Implemented",
          evidence: ["Evidence"],
          validation_performed: ["Tests"],
          remaining_risks: [],
          next_review_focus: "Review",
        },
      },
      deterministic,
    );
    expect(mutation.task).toMatchObject({
      status: "queued",
      currentExecutionId: null,
      summary: "PlanExec completed; independent Review is queued.",
    });
    expect(mutation.execution).toMatchObject({ status: "succeeded", completedAt: now });
    expect(mutation.blackboard).toEqual([
      expect.objectContaining({ id: "blackboard-1", kind: "planexec_report" }),
    ]);
    expect(mutation.phaseRunStatus).toBe("succeeded");
  });

  it("settles a Quick execution and its Task through one authority transition", () => {
    const state = authorityState({
      task: taskProjection({ mode: "quick" }),
      execution: executionProjection({ phase: "quick_exec", attachment: null }),
    });
    const succeeded = transitionAuthority(
      state,
      {
        type: "execution.quick.settled",
        generation: "generation-1",
        status: "succeeded",
        summary: "Scheduled work completed",
      },
      deterministic,
    );

    expect(succeeded.task).toMatchObject({
      status: "completed",
      currentGoalId: null,
      currentExecutionId: null,
      summary: "Scheduled work completed",
    });
    expect(succeeded.task.goals[0]).toMatchObject({ status: "passed", revision: 2 });
    expect(succeeded.execution).toMatchObject({
      status: "succeeded",
      completedAt: now,
      summary: "Scheduled work completed",
    });
    expect(succeeded.blackboard).toEqual([
      expect.objectContaining({ kind: "evidence_summary", producer: "daemon" }),
    ]);
    expect(succeeded.phaseRunStatus).toBe("succeeded");
    expect(succeeded.effects).toEqual([{ type: "release_task_runtime", taskId: "task-1" }]);
  });

  it("keeps failed Quick execution authority terminal and recoverable", () => {
    const state = authorityState({
      task: taskProjection({ mode: "quick" }),
      execution: executionProjection({ phase: "quick_exec", attachment: null }),
    });
    const failed = transitionAuthority(
      state,
      {
        type: "execution.quick.settled",
        generation: "generation-1",
        status: "failed",
        summary: "Provider unavailable",
      },
      deterministic,
    );

    expect(failed.task).toMatchObject({
      status: "interrupted",
      currentExecutionId: null,
      summary: "Provider unavailable",
    });
    expect(failed.task.goals[0]).toMatchObject({ status: "interrupted" });
    expect(failed.execution).toMatchObject({ status: "failed", completedAt: now });
    expect(failed.blackboard).toEqual([
      expect.objectContaining({ kind: "blocker", producer: "daemon" }),
    ]);
    expect(failed.phaseRunStatus).toBe("interrupted");
  });

  it("applies Review retry budget and direction in one pure transition", () => {
    const state = authorityState({ execution: reviewExecution() });
    const mutation = transitionAuthority(
      state,
      {
        type: "execution.review.completed",
        generation: "generation-review",
        verdict: {
          outcome: "continue",
          summary: "Retry with corrected direction",
          direction_memo: {
            conclusion: "Retry",
            reality: ["The result is incomplete"],
            diagnosis: "Root issue",
            abandon: [],
            reframe: "Correct the root issue",
            next_direction: "Implement the correction",
          },
        },
      },
      deterministic,
    );
    expect(mutation.task).toMatchObject({
      status: "budget_wait",
      currentExecutionId: null,
      budget: { usedFailedReviews: 1, maxFailedReviews: 1 },
    });
    expect(mutation.task.goals[0]).toMatchObject({ status: "queued", revision: 2 });
    expect(mutation.execution).toMatchObject({ status: "succeeded" });
  });

  it("opens and answers a user-owned Review decision with exact evidence", () => {
    const reviewState = authorityState({ execution: reviewExecution() });
    const opened = transitionAuthority(
      reviewState,
      {
        type: "execution.review.completed",
        generation: "generation-review",
        verdict: {
          outcome: "return_to_user_decision",
          summary: "A user choice is required",
          user_decision: {
            title: "Choose",
            question: "A or B?",
            options: [
              { id: "a", label: "A" },
              { id: "b", label: "B" },
            ],
          },
        },
      },
      deterministic,
    );
    expect(opened.task).toMatchObject({
      status: "awaiting_user",
      pendingDecision: { id: "decision-request-1" },
    });
    expect(opened.decisionRequest).toMatchObject({ type: "open" });

    const answered = transitionAuthority(
      {
        ...reviewState,
        task: opened.task,
        execution: null,
        pendingDecision: opened.task.pendingDecision,
      },
      {
        type: "task.decision.answered",
        decisionId: "decision-request-1",
        optionId: "b",
        note: " exact note ",
        expectedRevision: opened.task.revision,
        commandId: "answer-1",
        actorId: "human",
        clientId: "desktop",
      },
      deterministic,
    );
    expect(answered.task).toMatchObject({ status: "queued", pendingDecision: null });
    expect(answered.decision).toMatchObject({
      id: "decision-1",
      rawAnswer: { optionId: "b", note: " exact note " },
      normalized: { note: "exact note" },
    });
    expect(answered.decisionRequest).toEqual({
      type: "answer",
      requestId: "decision-request-1",
      decisionId: "decision-1",
      answeredAt: now,
    });
  });

  it("preserves approved Goals while replacing only unstarted future Goals", () => {
    const task = taskProjection({
      goals: [
        goal("goal-1", 1, "running"),
        goal("goal-2", 2, "queued"),
        goal("goal-3", 3, "queued"),
      ],
    });
    const state = authorityState({ task, execution: reviewExecution(), goalsRevision: 4 });
    const mutation = transitionAuthority(
      state,
      {
        type: "execution.review.completed",
        generation: "generation-review",
        verdict: {
          outcome: "replan_unstarted_goals",
          summary: "Replace future work",
          deferred_goal_replan_proposal: {
            base_goals_revision: 4,
            rationale: "Reality changed",
            expected_benefit: "Converge",
            affected_goal_ids: ["goal-2", "goal-3"],
            goals: [
              {
                id: "replacement",
                order: 2,
                title: "Replacement",
                goal: "Do replacement",
                constraints: ["Stay scoped"],
                acceptance: ["Pass"],
              },
            ],
          },
        },
      },
      deterministic,
    );
    expect(mutation.goalsRevision).toBe(5);
    expect(mutation.task.goals).toHaveLength(2);
    expect(mutation.task.goals[0]).toMatchObject({ id: "goal-1", status: "passed" });
    expect(mutation.task.goals[1]).toMatchObject({
      id: deriveDurableGoalId({
        taskId: "task-1",
        sourceGoalId: "replacement",
        order: 2,
        lineage: "replan-5",
      }),
      status: "queued",
    });
  });

  it("settles approval and restart interruption without provider-specific policy", () => {
    const approval = approvalProjection();
    const approved = transitionAuthority(
      authorityState({ approval }),
      {
        type: "execution.approval.resolved",
        decision: "implement",
        expectedRevision: 1,
        commandId: "approval-command",
        actorId: "human",
        clientId: "desktop",
        recordHumanDecision: true,
      },
      deterministic,
    );
    expect(approved.approval).toMatchObject({ status: "allowed", revision: 2 });
    expect(approved.execution).toMatchObject({ status: "implementing" });
    expect(approved.task).toMatchObject({ status: "running" });

    const restarted = transitionAuthority(
      authorityState({
        task: taskProjection({ status: "stopping", pendingControl: "stop" }),
        execution: executionProjection({ status: "cancel_requested" }),
      }),
      { type: "execution.restart.interrupted" },
      deterministic,
    );
    expect(restarted.task).toMatchObject({ status: "stopped", pendingControl: null });
    expect(restarted.execution).toMatchObject({ status: "orphaned" });
    expect(restarted.quarantine).toBe(true);
  });

  it("answers a foreground Card through the same deterministic authority entry", () => {
    const mutation = transitionAuthority(
      {
        workspaceId: "workspace-1",
        workspaceRevision: 4,
        agent: {
          id: "agent-1",
          revision: 2,
          activeTurnId: "turn-1",
          lifecycle: "awaiting_card",
        },
        turn: {
          id: "turn-1",
          agentId: "agent-1",
          generation: "generation-card",
          lifecycle: "awaiting_card",
        },
        card: {
          id: "card-1",
          turnId: "turn-1",
          agentId: "agent-1",
          kind: "clarify_card",
          status: "pending",
          displayed: { question: "Choose" },
        },
      },
      {
        type: "card.answered",
        expectedRevision: 2,
        answer: { choice: "a" },
        submittedCard: { submitted: true },
        submittedSummary: "A",
        nextLifecycle: "running",
        commandId: "answer-card",
        actorId: "human",
        clientId: "desktop",
      },
      deterministic,
    );
    expect(mutation.agent).toMatchObject({ revision: 3, lifecycle: "running" });
    expect(mutation.card).toMatchObject({ status: "answered", updatedAt: now });
    expect(mutation.decision).toMatchObject({
      id: "decision-1",
      taskId: null,
      turnId: "turn-1",
      cardId: "card-1",
      resultRevision: 3,
    });
  });

  it("constructs Task authority with stable Goal identity", () => {
    const task = createTaskAuthority({
      id: "task-created",
      workspaceId: "workspace-1",
      sourceAgentId: "agent-1",
      mode: "loop",
      title: "Task",
      goal: "Goal",
      constraints: ["Constraint"],
      acceptance: ["Acceptance"],
      strength: "balanced",
      goals: [
        {
          sourceId: "source-goal",
          order: 1,
          title: "First",
          goal: "Do first",
          constraints: ["Constraint"],
          acceptance: ["Pass"],
        },
      ],
      now,
    });
    expect(task).toMatchObject({
      status: "queued",
      currentGoalId: deriveDurableGoalId({
        taskId: "task-created",
        sourceGoalId: "source-goal",
        order: 1,
        lineage: "approved-goals",
      }),
      budget: { strength: "balanced", maxFailedReviews: 10 },
      createdAt: now,
    });
  });
});

function authorityState(
  patch: Partial<AuthorityState> & {
    task?: TaskProjection;
    execution?: ExecutionProjection | null;
  } = {},
): AuthorityState {
  return {
    workspaceRevision: 7,
    task: patch.task ?? taskProjection(),
    execution: patch.execution === undefined ? executionProjection() : patch.execution,
    approval: patch.approval,
    pendingDecision: patch.pendingDecision,
    goalsRevision: patch.goalsRevision ?? 0,
    latestPlanExecReport: patch.latestPlanExecReport,
  };
}

function taskProjection(patch: Partial<TaskProjection> = {}): TaskProjection {
  return {
    id: "task-1",
    workspaceId: "workspace-1",
    sourceAgentId: "agent-1",
    mode: "loop",
    title: "Task",
    goal: "Goal",
    constraints: ["Constraint"],
    acceptance: ["Acceptance"],
    status: "running",
    summary: "Running",
    currentGoalId: "goal-1",
    currentExecutionId: "execution-1",
    goals: [goal("goal-1", 1, "running")],
    latestReviewDirection: null,
    pendingDecision: null,
    budget: {
      strength: "single",
      usedFailedReviews: 0,
      maxFailedReviews: 1,
      activeDurationMs: 0,
      tokenCount: 0,
      toolCallCount: 0,
    },
    pendingControl: null,
    revision: 1,
    createdAt: "2026-07-23T19:00:00.000Z",
    updatedAt: "2026-07-23T19:00:00.000Z",
    ...patch,
  };
}

function goal(
  id: string,
  order: number,
  status: TaskProjection["goals"][number]["status"],
): TaskProjection["goals"][number] {
  return {
    id,
    order,
    title: `Goal ${order}`,
    goal: `Do ${order}`,
    constraints: ["Constraint"],
    acceptance: ["Pass"],
    status,
    revision: 1,
  };
}

function executionProjection(patch: Partial<ExecutionProjection> = {}): ExecutionProjection {
  return {
    id: "execution-1",
    taskId: "task-1",
    goalId: "goal-1",
    phaseRunId: "phase-1",
    phase: "planexec",
    providerThreadId: "thread-1",
    status: "running",
    generation: "generation-1",
    attachment: {
      id: "attachment-1",
      bundleId: "thoth.loop",
      bundleDigest: "sha256:bundle",
      status: "attached",
      attachedAt: "2026-07-23T19:00:00.000Z",
    },
    runModeReceipt: null,
    pendingApproval: null,
    startedAt: "2026-07-23T19:00:00.000Z",
    lastActivityAt: "2026-07-23T19:00:00.000Z",
    completedAt: null,
    summary: null,
    revision: 1,
    ...patch,
  };
}

function reviewExecution(): ExecutionProjection {
  return executionProjection({
    phase: "review",
    generation: "generation-review",
  });
}

function approvalProjection(): ExecutionApprovalProjection {
  return {
    id: "approval-1",
    taskId: "task-1",
    executionId: "execution-1",
    kind: "implement",
    title: "Implement",
    description: null,
    displayed: { planId: "plan-1" },
    deadlineAt: null,
    status: "pending",
    resolution: null,
    revision: 1,
    createdAt: "2026-07-23T19:00:00.000Z",
    updatedAt: "2026-07-23T19:00:00.000Z",
  };
}
