import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IntentContractProjection } from "@thoth/protocol/intent-contract";
import { WorkspaceTaskCoordinator, type TaskCommandScheduler } from "./task-coordinator.js";
import { WorkspaceAuthorityManager } from "./workspace-authority-manager.js";

const roots: string[] = [];

function createRuntime() {
  const root = mkdtempSync(path.join(tmpdir(), "thoth-task-coordinator-"));
  roots.push(root);
  const workspaceId = "workspace-task-coordinator";
  const manager = new WorkspaceAuthorityManager(root);
  manager.catalog.upsertWorkspace({
    id: workspaceId,
    canonicalPath: path.join(root, "workspace"),
    displayName: "Task coordinator Workspace",
    kind: "workspace",
    parentWorkspaceId: null,
    archivedAt: null,
    createdAt: "2026-07-21T00:00:00.000Z",
    updatedAt: "2026-07-21T00:00:00.000Z",
  });
  manager.forWorkspace(workspaceId).upsertAgentRecord({
    id: "agent-visible",
    provider: "fixture",
    cwd: path.join(root, "workspace"),
    workspaceId,
    createdAt: "2026-07-21T00:00:00.000Z",
    updatedAt: "2026-07-21T00:00:00.000Z",
    labels: {},
    lastStatus: "idle",
    providerRunMode: "default",
    providerControlRevision: 0,
  });
  return {
    workspaceId,
    manager,
    coordinator: new WorkspaceTaskCoordinator(manager, pino({ level: "silent" })),
  };
}

function intentContract(id: string, workspaceId: string): IntentContractProjection {
  const now = "2026-07-21T00:00:00.000Z";
  return {
    id: `intent-contract-${id}`,
    workspaceId,
    sourceAgentId: "agent-visible",
    taskId: null,
    title: `Task ${id}`,
    objective: "Register one durable target-anchored Task aggregate.",
    nonGoals: [],
    invariants: ["Keep provider identifiers out of Task Truth"],
    acceptanceClaims: [
      {
        id: `claim-${id}`,
        statement: "The Task owns one stable Intent Contract and mutable Working Set.",
        status: "open",
        evidenceRefs: [],
        revision: 1,
      },
    ],
    riskBoundary: [],
    humanDecisionRefs: [],
    escalationPolicy: { returnToHumanWhen: [], finalConfirmation: "automatic" },
    status: "confirmed",
    revision: 1,
    confirmedAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("WorkspaceTaskCoordinator", () => {
  it("registers independent Tasks from one Intent Contract each without Goal authority", () => {
    const { workspaceId, manager, coordinator } = createRuntime();
    const first = coordinator.register({
      workspaceId,
      sourceAgentId: "agent-visible",
      sourceTurnId: "turn-first",
      sourceContractCardId: "contract-first",
      mode: "quick",
      loopStrength: null,
      intentContract: intentContract("contract-first", workspaceId),
      providerProfile: { adapterId: "fixture", config: { model: "fixture" } },
    });
    const second = coordinator.register({
      workspaceId,
      sourceAgentId: "agent-visible",
      sourceTurnId: "turn-second",
      sourceContractCardId: "contract-second",
      mode: "loop",
      loopStrength: "light",
      intentContract: intentContract("contract-second", workspaceId),
      providerProfile: { adapterId: "fixture", config: { model: "fixture" } },
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(true);
    expect(first.task.intentContract.id).not.toBe(second.task.intentContract.id);
    expect(first.task.intentContract.taskId).toBe(first.task.id);
    expect(second.task.intentContract.taskId).toBe(second.task.id);
    expect(coordinator.context(workspaceId, second.task.id)).toMatchObject({
      task: {
        currentWorkUnitId: null,
        workUnits: [],
        workingSet: { activeGap: "Register one durable target-anchored Task aggregate." },
      },
    });
    manager.close();
  });

  it("notifies the scheduler after Stop settles so the active Workspace phase can be released", async () => {
    const { workspaceId, manager, coordinator } = createRuntime();
    const registered = coordinator.register({
      workspaceId,
      sourceAgentId: "agent-visible",
      sourceTurnId: "turn-stop",
      sourceContractCardId: "contract-stop",
      mode: "quick",
      loopStrength: null,
      intentContract: intentContract("contract-stop", workspaceId),
      providerProfile: { adapterId: "fixture", config: { model: "fixture" } },
    });
    const store = manager.forWorkspace(workspaceId);
    store.createExecution({
      execution: {
        id: "execution-stop-settled",
        taskId: registered.task.id,
        workUnitId: null,
        cycleId: null,
        phase: "quick_exec",
        providerThreadId: "thread-stop-settled",
        status: "awaiting_provider",
        generation: "generation-stop-settled",
        attachment: null,
        runModeReceipt: null,
        pendingApproval: null,
        startedAt: "2026-07-22T00:00:00.000Z",
        lastActivityAt: "2026-07-22T00:00:00.000Z",
        completedAt: null,
        summary: null,
        revision: 1,
      },
      providerThread: { id: "thread-stop-settled", adapterId: "fixture" },
    });

    const handleTaskStopSettled = vi.fn(async () => undefined);
    const scheduler: TaskCommandScheduler = {
      scheduleTask: vi.fn(async () => undefined),
      handleTaskCommand: vi.fn(async () => undefined),
      continueAfterExecutionApproval: vi.fn(async () => undefined),
      handleTaskStopSettled,
    };
    coordinator.setScheduler(scheduler);
    const current = coordinator.get(workspaceId, registered.task.id).task!;

    const requested = coordinator.command({
      workspaceId,
      taskId: current.id,
      command: "stop",
      expectedRevision: current.revision,
      commandId: "stop-settled-command",
      actorId: "human:test",
      clientId: "desktop",
    });

    expect(requested).toMatchObject({
      conflict: false,
      task: { status: "stopping" },
      execution: { status: "cancel_requested" },
    });
    await vi.waitFor(() => {
      expect(handleTaskStopSettled).toHaveBeenCalledWith({
        workspaceId,
        task: expect.objectContaining({ id: current.id, status: "stopped" }),
        execution: expect.objectContaining({
          id: "execution-stop-settled",
          status: "orphaned",
        }),
      });
    });
    manager.close();
  });

  it("keeps Quick queued until the Workspace mutation lease is released", async () => {
    const { workspaceId, manager, coordinator } = createRuntime();
    const registered = coordinator.register({
      workspaceId,
      sourceAgentId: "agent-visible",
      sourceTurnId: "turn-quick-wait",
      sourceContractCardId: "contract-quick-wait",
      mode: "quick",
      loopStrength: null,
      intentContract: intentContract("quick-wait", workspaceId),
      providerProfile: { adapterId: "fixture", config: { model: "fixture" } },
    });
    const store = manager.forWorkspace(workspaceId);
    expect(
      store.claimMutationLease({
        taskId: "task-current-holder",
        executionId: "execution-current-holder",
        generation: "generation-current-holder",
        ttlMs: 30_000,
      }),
    ).toBe(true);
    const begin = () =>
      coordinator.beginQuickExecution({
        workspaceId,
        taskId: registered.task.id,
        executionId: "execution-quick-wait",
        generation: "generation-quick-wait",
        attachment: {
          id: "attachment-quick-wait",
          adapterId: "fixture",
          threadId: "thread-quick-wait",
          bundleId: "thoth.clarify",
          bundleDigest: `sha256:${"a".repeat(64)}`,
          instructionAttachment: "session_prompt",
          toolAttachment: "mcp",
          attachedAt: "2026-07-21T00:00:01.000Z",
        },
        runModeReceipt: null,
      });
    expect(begin()).toBeNull();
    expect(coordinator.get(workspaceId, registered.task.id)).toMatchObject({
      task: { status: "queued", currentExecutionId: null },
      executions: [],
    });

    const woke = vi.fn();
    const unsubscribe = coordinator.subscribeQuickMutationReady(workspaceId, woke);
    expect(
      store.releaseMutationLease({
        taskId: "task-current-holder",
        executionId: "execution-current-holder",
        generation: "generation-current-holder",
      }),
    ).toBe(true);
    coordinator.notifyMutationLeaseReleased(workspaceId);
    await vi.waitFor(() => expect(woke).toHaveBeenCalledTimes(1));
    expect(begin()).toMatchObject({ phase: "quick_exec", status: "running" });
    expect(coordinator.get(workspaceId, registered.task.id).task).toMatchObject({
      status: "running",
      currentExecutionId: "execution-quick-wait",
    });
    unsubscribe();
    coordinator.settleQuickExecution({
      workspaceId,
      taskId: registered.task.id,
      executionId: "execution-quick-wait",
      generation: "generation-quick-wait",
      status: "succeeded",
      summary: "Quick completed after its durable wait.",
    });
    manager.close();
  });

  it("commits a worktree Task contract revision back from its source Agent shard exactly once", () => {
    const { workspaceId: sourceWorkspaceId, manager, coordinator } = createRuntime();
    const taskWorkspaceId = "workspace-task-worktree";
    manager.catalog.upsertWorkspace({
      id: taskWorkspaceId,
      canonicalPath: path.join(roots.at(-1)!, "worktree"),
      displayName: "Task worktree",
      kind: "worktree",
      parentWorkspaceId: sourceWorkspaceId,
      archivedAt: null,
      createdAt: "2026-07-21T00:00:00.000Z",
      updatedAt: "2026-07-21T00:00:00.000Z",
    });
    const registered = coordinator.register({
      workspaceId: taskWorkspaceId,
      sourceAgentWorkspaceId: sourceWorkspaceId,
      sourceAgentId: "agent-visible",
      sourceTurnId: "schedule-turn-worktree",
      sourceContractCardId: "schedule-contract-worktree",
      mode: "loop",
      loopStrength: "light",
      intentContract: {
        ...intentContract("worktree", taskWorkspaceId),
        sourceAgentId: "agent-visible",
      },
      providerProfile: { adapterId: "fixture", config: { model: "fixture" } },
    });
    const taskStore = manager.forWorkspace(taskWorkspaceId);
    const cycleId = "cycle-worktree-decision";
    const executionId = "execution-worktree-decision";
    const generation = "generation-worktree-decision";
    taskStore.createExecution({
      execution: {
        id: executionId,
        taskId: registered.task.id,
        workUnitId: "work-unit-worktree-decision",
        cycleId,
        phase: "execute",
        providerThreadId: "thread-worktree-decision",
        status: "running",
        generation,
        attachment: null,
        runModeReceipt: null,
        pendingApproval: null,
        startedAt: "2026-07-21T00:00:01.000Z",
        lastActivityAt: "2026-07-21T00:00:01.000Z",
        completedAt: null,
        summary: null,
        revision: 1,
      },
      cycle: { id: cycleId, status: "active", startedAt: "2026-07-21T00:00:01.000Z" },
      workUnit: {
        id: "work-unit-worktree-decision",
        taskId: registered.task.id,
        cycleId,
        title: "Resolve deployment boundary",
        activeGap: registered.task.workingSet.activeGap,
        progressClaim: "A Human-owned contract fork was found.",
        unresolvedGap: "Deployment boundary requires the user.",
        evidenceRefs: [],
        status: "active",
        revision: 1,
        createdAt: "2026-07-21T00:00:01.000Z",
        updatedAt: "2026-07-21T00:00:01.000Z",
      },
      providerThread: { id: "thread-worktree-decision", adapterId: "fixture" },
    });
    taskStore.recordAttachment({
      executionId,
      receipt: {
        id: "attachment-worktree-decision",
        adapterId: "fixture",
        threadId: "thread-worktree-decision",
        bundleId: "thoth.loop",
        bundleDigest: `sha256:${"b".repeat(64)}`,
        instructionAttachment: "session_prompt",
        toolAttachment: "mcp",
        attachedAt: "2026-07-21T00:00:02.000Z",
      },
    });
    taskStore.requestExecutionHumanDecision({
      executionId,
      generation,
      callId: "worktree-decision",
      request: {
        title: "Deployment boundary",
        question: "Should this Task include production deployment?",
        affectedContractFields: ["riskBoundary"],
        options: [
          { id: "exclude", label: "Exclude deployment" },
          { id: "include", label: "Include deployment" },
        ],
      },
    });
    const pending = taskStore.getTask(registered.task.id)!;
    expect(pending).toMatchObject({
      sourceAgentWorkspaceId: sourceWorkspaceId,
      status: "awaiting_user",
      pendingDecision: { id: "task-decision-worktree-decision" },
    });
    const sourceDecision = manager
      .forWorkspace(sourceWorkspaceId)
      .recordProviderPermissionDecision({
        agentId: "agent-visible",
        requestId: "worktree-human-answer",
        displayed: pending.pendingDecision,
        rawAnswer: { optionId: "exclude" },
        actorId: "human:test",
        clientId: "desktop",
      }).decision;
    const input = {
      taskWorkspaceId,
      taskId: registered.task.id,
      sourceAgentWorkspaceId: sourceWorkspaceId,
      sourceAgentId: "agent-visible",
      decisionRequestId: pending.pendingDecision!.id,
      contract: {
        ...registered.task.intentContract,
        id: "intent-contract-worktree-revised",
        title: "Task worktree revised",
        humanDecisionRefs: [sourceDecision.id],
      },
      decisionRecordIds: [sourceDecision.id],
      commandId: "task-clarify-commit-worktree",
    };
    expect(coordinator.commitClarifyContractRevision(input)).toMatchObject({
      duplicate: false,
      task: { status: "reorienting", title: "Task worktree revised" },
    });
    expect(coordinator.commitClarifyContractRevision(input)).toMatchObject({
      duplicate: true,
      task: { status: "reorienting" },
    });
    expect(coordinator.context(taskWorkspaceId, registered.task.id)?.decisions).toEqual([
      expect.objectContaining({ id: sourceDecision.id, workspaceId: sourceWorkspaceId }),
    ]);
    expect(manager.catalog.locateAgent("agent-visible")).toBe(sourceWorkspaceId);
    manager.close();
  });
});
