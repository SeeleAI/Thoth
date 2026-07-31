import { describe, expect, it } from "vitest";
import type { IntentContractProjection } from "@thoth/protocol/intent-contract";
import type {
  ExecutionApprovalProjection,
  ExecutionProjection,
  TaskProjection,
  WorkUnitProjection,
} from "@thoth/protocol/task-authority";
import {
  AuthorityTransitionError,
  createTaskAuthority,
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
    evidenceId: "evidence-1",
    reviewDecisionId: "review-1",
  },
};

describe("transitionAuthority", () => {
  it("constructs one target-anchored Task without Goal authority", () => {
    const task = createTaskAuthority({
      id: "task-created",
      workspaceId: "workspace-1",
      sourceAgentWorkspaceId: "workspace-1",
      sourceAgentId: "agent-1",
      mode: "loop",
      intentContract: intentContract({ taskId: null }),
      strength: "balanced",
      now,
    });

    expect(task).toMatchObject({
      id: "task-created",
      status: "queued",
      currentExecutionId: null,
      currentWorkUnitId: null,
      workUnits: [],
      completionAuthority: "none",
      workingSet: { activeGap: "Deliver the confirmed runtime target." },
      budget: {
        strength: "balanced",
        usedNonCompleteReviews: 0,
        maxNonCompleteReviews: 10,
      },
    });
    expect(task.intentContract.taskId).toBe("task-created");
  });

  it("requires a confirmed Intent Contract from the same Workspace and source Agent", () => {
    expect(() =>
      createTaskAuthority({
        id: "task-created",
        workspaceId: "workspace-1",
        sourceAgentWorkspaceId: "workspace-1",
        sourceAgentId: "agent-1",
        mode: "loop",
        intentContract: intentContract({ status: "proposed", confirmedAt: null }),
        strength: "light",
        now,
      }),
    ).toThrow(/confirmed Intent Contract/u);
  });

  it("applies Task controls with CAS and settles Stop in a second transition", () => {
    const state = authorityState();
    const paused = transitionAuthority(
      state,
      {
        type: "task.control",
        command: "pause",
        expectedRevision: state.task.revision,
        commandId: "command-pause",
        actorId: "human",
        clientId: "desktop",
      },
      deterministic,
    );
    expect(paused.task).toMatchObject({ status: "running", pendingControl: "pause" });
    expect(paused.decision).toMatchObject({ kind: "task_control_pause", decidedAt: now });

    expect(() =>
      transitionAuthority(
        state,
        {
          type: "task.control",
          command: "pause",
          expectedRevision: 99,
          commandId: "stale",
          actorId: "human",
          clientId: "desktop",
        },
        deterministic,
      ),
    ).toThrowError(
      expect.objectContaining<Partial<AuthorityTransitionError>>({ kind: "conflict" }),
    );

    const stopping = transitionAuthority(
      state,
      {
        type: "task.control",
        command: "stop",
        expectedRevision: state.task.revision,
        commandId: "command-stop",
        actorId: "human",
        clientId: "desktop",
      },
      deterministic,
    );
    expect(stopping.task).toMatchObject({ status: "stopping", pendingControl: "stop" });
    expect(stopping.execution).toMatchObject({ status: "cancel_requested" });
    expect(stopping.effects).toEqual([
      {
        type: "interrupt_execution",
        executionId: "execution-1",
        generation: "generation-1",
      },
    ]);

    const stopped = transitionAuthority(
      { ...state, task: stopping.task, execution: stopping.execution },
      {
        type: "execution.stop.settled",
        generation: "generation-1",
        orphaned: false,
      },
      deterministic,
    );
    expect(stopped.task).toMatchObject({ status: "stopped", pendingControl: null });
    expect(stopped.execution).toMatchObject({ status: "canceled" });
  });

  it("atomically turns an Executor checkpoint into evidence and the Review boundary", () => {
    const mutation = transitionAuthority(
      authorityState(),
      {
        type: "execution.checkpoint.completed",
        generation: "generation-1",
        checkpoint: {
          title: "Runtime increment",
          activeGap: "Deliver the confirmed runtime target.",
          progressClaim: "The native path now passes its focused verification.",
          unresolvedGap: "Independently review the complete target.",
          evidenceRefs: ["evidence-provider"],
        },
      },
      deterministic,
    );

    expect(mutation.task).toMatchObject({
      status: "queued",
      currentExecutionId: null,
      currentWorkUnitId: "work-unit-1",
      workingSet: {
        activeGap: "Independently review the complete target.",
        nextMove: "Run a fresh independent Review against Workspace reality.",
      },
    });
    expect(mutation.task.workUnits[0]).toMatchObject({
      status: "completed",
      evidenceRefs: ["evidence-provider", "evidence-1"],
    });
    expect(mutation.execution).toMatchObject({ status: "succeeded", completedAt: now });
    expect(mutation.evidence).toEqual([
      expect.objectContaining({ id: "evidence-1", kind: "executor_checkpoint" }),
    ]);
  });

  it("records a Review reorientation, rejected routes, and the non-complete budget", () => {
    const mutation = transitionAuthority(
      authorityState({ execution: executionProjection({ phase: "review" }) }),
      {
        type: "execution.review.completed",
        generation: "generation-1",
        review: {
          decision: "reorient",
          reason: "The implementation optimized the wrong runtime boundary.",
          evidenceRefs: ["evidence-review"],
          nextFocus: "Reorient against the confirmed native target.",
          rejectedRoutes: ["Do not continue the portable-only route."],
          acceptanceEvidence: {},
        },
      },
      deterministic,
    );

    expect(mutation.task).toMatchObject({
      status: "budget_wait",
      currentExecutionId: null,
      latestReview: { id: "review-1", decision: "reorient" },
      budget: { usedNonCompleteReviews: 1, maxNonCompleteReviews: 1 },
      workingSet: {
        activeGap: "Reorient against the confirmed native target.",
        rejectedRoutes: ["Do not continue the portable-only route."],
      },
    });
    expect(mutation.effects).toEqual([{ type: "release_task_runtime", taskId: "task-1" }]);
  });

  it("completes only when Review maps every Acceptance Claim to evidence", () => {
    const state = authorityState({ execution: executionProjection({ phase: "review" }) });
    expect(() =>
      transitionAuthority(
        state,
        {
          type: "execution.review.completed",
          generation: "generation-1",
          review: {
            decision: "complete",
            reason: "Looks complete.",
            evidenceRefs: ["evidence-review"],
            acceptanceEvidence: {},
            rejectedRoutes: [],
          },
        },
        deterministic,
      ),
    ).toThrow(/map every Acceptance Claim/u);

    const completed = transitionAuthority(
      state,
      {
        type: "execution.review.completed",
        generation: "generation-1",
        review: completeReview(),
      },
      deterministic,
    );
    expect(completed.task).toMatchObject({
      status: "completed",
      completionAuthority: "review_verified",
      pendingDecision: null,
      intentContract: {
        acceptanceClaims: [
          { id: "acceptance-1", status: "satisfied", evidenceRefs: ["evidence-review"] },
        ],
      },
    });
  });

  it("opens final Human confirmation only when the Intent Contract requires it", () => {
    const task = taskProjection({
      intentContract: intentContract({
        taskId: "task-1",
        escalationPolicy: {
          returnToHumanWhen: ["Final acceptance is material."],
          finalConfirmation: "required",
        },
      }),
    });
    const reviewed = transitionAuthority(
      authorityState({ task, execution: executionProjection({ phase: "review" }) }),
      {
        type: "execution.review.completed",
        generation: "generation-1",
        review: completeReview(),
      },
      deterministic,
    );
    expect(reviewed.task).toMatchObject({
      status: "awaiting_user_final",
      pendingDecision: { id: "decision-request-1", kind: "final_confirmation" },
    });

    const accepted = transitionAuthority(
      {
        ...authorityState({ task: reviewed.task, execution: null }),
        pendingDecision: reviewed.task.pendingDecision,
      },
      {
        type: "task.decision.answered",
        decisionId: "decision-request-1",
        optionId: "accept",
        expectedRevision: reviewed.task.revision,
        commandId: "accept-final",
        actorId: "human",
        clientId: "desktop",
      },
      deterministic,
    );
    expect(accepted.task).toMatchObject({
      status: "completed",
      completionAuthority: "human_accepted",
      pendingDecision: null,
    });
    expect(accepted.decision).toMatchObject({ kind: "task_final_confirmation" });
  });

  it("returns a new Human-owned premise to Clarify and revises the same Task lineage", () => {
    const opened = transitionAuthority(
      authorityState(),
      {
        type: "execution.human_decision.requested",
        generation: "generation-1",
        request: {
          title: "Runtime boundary changed",
          question: "May execution adopt the discovered native boundary?",
          affectedContractFields: ["riskBoundary"],
          options: [
            { id: "adopt", label: "Adopt boundary" },
            { id: "keep", label: "Keep contract" },
          ],
        },
      },
      deterministic,
    );
    expect(opened.task).toMatchObject({
      id: "task-1",
      status: "awaiting_user",
      currentExecutionId: null,
      pendingDecision: { id: "decision-request-1", kind: "contract_change" },
    });
    expect(opened.execution).toMatchObject({ status: "succeeded" });
    expect(opened.effects).toEqual([
      {
        type: "open_task_clarify",
        taskId: "task-1",
        decisionRequestId: "decision-request-1",
      },
    ]);

    const revisedContract = intentContract({
      id: "intent-contract-revised",
      taskId: "task-1",
      title: "Revised runtime boundary",
      revision: 2,
      confirmedAt: now,
      updatedAt: now,
    });
    const revised = transitionAuthority(
      {
        ...authorityState({ task: opened.task, execution: null }),
        pendingDecision: opened.task.pendingDecision,
      },
      {
        type: "task.contract.revised",
        decisionRequestId: "decision-request-1",
        decisionRecordId: "decision-contract-revision",
        expectedRevision: opened.task.revision,
        contract: revisedContract,
      },
      deterministic,
    );
    expect(revised.task).toMatchObject({
      id: "task-1",
      title: "Revised runtime boundary",
      status: "reorienting",
      pendingDecision: null,
      intentContract: { id: "intent-contract-revised", revision: 2 },
      workingSet: { activeGap: "Deliver the confirmed runtime target." },
    });
    expect(revised.effects).toEqual([{ type: "schedule_task", taskId: "task-1" }]);
  });

  it.each([
    { status: "succeeded" as const, taskStatus: "completed", authority: "executor_unreviewed" },
    { status: "failed" as const, taskStatus: "interrupted", authority: "none" },
  ])("settles a Quick execution as $status without independent Review", (example) => {
    const task = taskProjection({ mode: "quick" });
    const execution = executionProjection({
      phase: "quick_exec",
      workUnitId: null,
      cycleId: null,
      attachment: {
        id: "attachment-quick",
        bundleId: "thoth.clarify",
        bundleDigest: "sha256:quick",
        status: "attached",
        attachedAt: now,
      },
    });
    const settled = transitionAuthority(
      authorityState({ task, execution }),
      {
        type: "execution.quick.settled",
        generation: "generation-1",
        status: example.status,
        summary: "Quick execution settled.",
      },
      deterministic,
    );
    expect(settled.task).toMatchObject({
      status: example.taskStatus,
      completionAuthority: example.authority,
      currentExecutionId: null,
    });
    expect(settled.execution).toMatchObject({ status: example.status, completedAt: now });
  });

  it("resolves Provider approval and reorients an interrupted Loop after restart", () => {
    const approval = approvalProjection();
    const approved = transitionAuthority(
      authorityState({ approval }),
      {
        type: "execution.approval.resolved",
        decision: "implement",
        expectedRevision: approval.revision,
        commandId: "approval-command",
        actorId: "human",
        clientId: "desktop",
        recordHumanDecision: true,
      },
      deterministic,
    );
    expect(approved.approval).toMatchObject({ status: "allowed", revision: 2 });
    expect(approved.execution).toMatchObject({ status: "implementing" });

    const restarted = transitionAuthority(
      authorityState(),
      { type: "execution.restart.interrupted" },
      deterministic,
    );
    expect(restarted.task).toMatchObject({ status: "reorienting", currentExecutionId: null });
    expect(restarted.execution).toMatchObject({ status: "canceled" });
    expect(restarted.effects).toEqual([{ type: "schedule_task", taskId: "task-1" }]);
  });

  it("stops automatic reorientation after two Executor attempts make no semantic progress", () => {
    const first = transitionAuthority(
      authorityState(),
      {
        type: "execution.interrupted",
        generation: "generation-1",
        summary: "Provider completed twice without a checkpoint.",
      },
      deterministic,
    );
    expect(first.task).toMatchObject({
      status: "reorienting",
      workingSet: { noProgressCount: 1 },
    });
    expect(first.effects).toEqual([{ type: "schedule_task", taskId: "task-1" }]);

    const retryTask = taskProjection();
    retryTask.workingSet = {
      ...retryTask.workingSet,
      noProgressCount: 1,
    };
    const second = transitionAuthority(
      authorityState({ task: retryTask }),
      {
        type: "execution.interrupted",
        generation: "generation-1",
        summary: "Replacement Executor also completed without a checkpoint.",
      },
      deterministic,
    );
    expect(second.task).toMatchObject({
      status: "interrupted",
      currentExecutionId: null,
      workingSet: {
        noProgressCount: 2,
        nextMove:
          "Two Executor attempts produced no semantic progress; explicit Resume is required.",
      },
    });
    expect(second.effects).toEqual([{ type: "release_task_runtime", taskId: "task-1" }]);

    const resumed = transitionAuthority(
      { ...authorityState({ task: second.task }), execution: second.execution },
      {
        type: "task.control",
        command: "resume",
        expectedRevision: second.task.revision,
        commandId: "resume-after-no-progress",
        actorId: "human",
        clientId: "desktop",
      },
      deterministic,
    );
    expect(resumed.task).toMatchObject({
      status: "reorienting",
      workingSet: { noProgressCount: 0 },
    });
    expect(resumed.effects).toEqual([{ type: "schedule_task", taskId: "task-1" }]);
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
    });
  });
});

function intentContract(patch: Partial<IntentContractProjection> = {}): IntentContractProjection {
  return {
    id: "intent-contract-1",
    workspaceId: "workspace-1",
    sourceAgentId: "agent-1",
    taskId: "task-1",
    title: "Runtime target",
    objective: "Deliver the confirmed runtime target.",
    nonGoals: ["Do not add a fallback."],
    invariants: ["Use one provider-neutral path."],
    acceptanceClaims: [
      {
        id: "acceptance-1",
        statement: "The runtime target passes independent verification.",
        status: "open",
        evidenceRefs: [],
        revision: 1,
      },
    ],
    riskBoundary: [],
    humanDecisionRefs: ["decision-runtime-target"],
    escalationPolicy: { returnToHumanWhen: [], finalConfirmation: "automatic" },
    status: "confirmed",
    revision: 1,
    confirmedAt: "2026-07-23T19:00:00.000Z",
    createdAt: "2026-07-23T19:00:00.000Z",
    updatedAt: "2026-07-23T19:00:00.000Z",
    ...patch,
  };
}

function workUnit(): WorkUnitProjection {
  return {
    id: "work-unit-1",
    taskId: "task-1",
    cycleId: "cycle-1",
    title: "Current runtime gap",
    activeGap: "Deliver the confirmed runtime target.",
    progressClaim: "No checkpoint has been submitted.",
    unresolvedGap: "Deliver the confirmed runtime target.",
    evidenceRefs: [],
    status: "active",
    revision: 1,
    createdAt: "2026-07-23T19:00:00.000Z",
    updatedAt: "2026-07-23T19:00:00.000Z",
  };
}

function taskProjection(patch: Partial<TaskProjection> = {}): TaskProjection {
  const base = createTaskAuthority({
    id: "task-1",
    workspaceId: "workspace-1",
    sourceAgentWorkspaceId: "workspace-1",
    sourceAgentId: "agent-1",
    mode: patch.mode ?? "loop",
    intentContract: intentContract({ taskId: null }),
    strength: "single",
    now: "2026-07-23T19:00:00.000Z",
  });
  return {
    ...base,
    status: "running",
    summary: "Execution is running.",
    currentExecutionId: "execution-1",
    currentWorkUnitId: patch.mode === "quick" ? null : "work-unit-1",
    workUnits: patch.mode === "quick" ? [] : [workUnit()],
    ...patch,
  };
}

function executionProjection(patch: Partial<ExecutionProjection> = {}): ExecutionProjection {
  const phase = patch.phase ?? "execute";
  return {
    id: "execution-1",
    taskId: "task-1",
    workUnitId: phase === "quick_exec" ? null : "work-unit-1",
    cycleId: phase === "quick_exec" ? null : "cycle-1",
    phase,
    providerThreadId: "thread-1",
    status: "awaiting_provider",
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
  };
}

function completeReview() {
  return {
    decision: "complete" as const,
    reason: "Independent inspection verified the complete target.",
    evidenceRefs: ["evidence-review"],
    rejectedRoutes: [],
    acceptanceEvidence: { "acceptance-1": ["evidence-review"] },
  };
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
