import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import type { RuntimeAttachmentReceipt } from "@thoth/drivers/harness";
import { WorkspaceCatalogStore } from "./catalog-store.js";
import { WorkspaceAuthorityStore } from "./workspace-authority-store.js";

const roots: string[] = [];

function createStore() {
  const root = mkdtempSync(path.join(tmpdir(), "thoth-workspace-authority-"));
  roots.push(root);
  const workspaceId = "wks_test";
  const catalog = new WorkspaceCatalogStore(root);
  catalog.upsertWorkspace({
    id: workspaceId,
    canonicalPath: path.join(root, "workspace"),
    displayName: "Test Workspace",
    kind: "workspace",
    parentWorkspaceId: null,
    archivedAt: null,
    createdAt: "2026-07-20T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:00.000Z",
  });
  const store = new WorkspaceAuthorityStore({ thothHome: root, workspaceId, catalog });
  return { root, workspaceId, catalog, store };
}

function createTask(store: WorkspaceAuthorityStore, catalog: WorkspaceCatalogStore) {
  return store.createTask(
    {
      id: "task_test",
      workspaceId: "wks_test",
      sourceAgentId: "agent_visible",
      mode: "loop",
      title: "Exercise the final authority",
      goal: "Prove Task and Execution identities stay separate.",
      constraints: ["No provider-specific authority"],
      acceptance: ["Stop fences the active execution"],
      status: "queued",
      summary: "Queued",
      currentGoalId: "goal_1",
      currentExecutionId: null,
      goals: [
        {
          id: "goal_1",
          order: 1,
          title: "Run one phase",
          goal: "Run one phase through the authority store.",
          constraints: ["Keep Task Truth semantic"],
          acceptance: ["Execution has its own lifecycle"],
          status: "queued",
          revision: 0,
        },
      ],
      latestReviewDirection: null,
      revision: 1,
      createdAt: "2026-07-20T00:00:00.000Z",
      updatedAt: "2026-07-20T00:00:00.000Z",
    },
    catalog,
  );
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("WorkspaceAuthorityStore", () => {
  it("stores normalized Task and Execution projections without full projection events", () => {
    const { root, catalog, store } = createStore();
    createTask(store, catalog);
    const execution = store.createExecution({
      execution: {
        id: "execution_1",
        taskId: "task_test",
        goalId: "goal_1",
        phaseRunId: "phase_1",
        phase: "planexec",
        providerThreadId: "thread_1",
        status: "running",
        generation: "generation_1",
        attachment: null,
        startedAt: "2026-07-20T00:00:01.000Z",
        lastActivityAt: "2026-07-20T00:00:01.000Z",
        completedAt: null,
        summary: null,
        revision: 1,
      },
      providerThread: { id: "thread_1", adapterId: "fixture" },
    });
    expect(execution.status).toBe("running");
    expect(store.getTask("task_test")?.currentExecutionId).toBe("execution_1");

    const db = new DatabaseSync(path.join(root, "workspaces", "wks_test", "authority.sqlite"), {
      readOnly: true,
    });
    const columns = db.prepare("PRAGMA table_info(authority_events)").all() as Array<{
      name: string;
    }>;
    expect(columns.map((column) => column.name)).not.toContain("projection_json");
    db.close();
    store.close();
    catalog.close();
  });

  it("never resumes unavailable legacy context and records an explicit replacement lineage", () => {
    const { catalog, store } = createStore();
    createTask(store, catalog);
    store.importLegacyExecution({
      taskId: "task_test",
      goalId: "goal_1",
      executionId: "execution_legacy",
      phaseRunId: "phase_legacy",
      phase: "planexec",
      providerThreadId: "thread_legacy",
      adapterId: "fixture",
      providerThreadNativeHandle: "native_legacy",
      providerThreadPersistence: { migration: { disposition: "replacement_required" } },
      providerThreadStatus: "native_context_unavailable",
      status: "orphaned",
      generation: "generation_legacy",
      startedAt: "2026-07-20T00:00:01.000Z",
      completedAt: "2026-07-20T00:00:02.000Z",
      summary: "Native context is unavailable.",
      semanticHistory: { phase: "planexec" },
    });

    expect(store.findLatestPlanExecThread("task_test", "goal_1")).toBeNull();
    expect(store.findLatestPlanExecLineageThread("task_test", "goal_1")).toMatchObject({
      id: "thread_legacy",
      status: "native_context_unavailable",
    });

    store.createExecution({
      execution: {
        id: "execution_replacement",
        taskId: "task_test",
        goalId: "goal_1",
        phaseRunId: "phase_replacement",
        phase: "planexec",
        providerThreadId: "thread_replacement",
        status: "starting",
        generation: "generation_replacement",
        attachment: null,
        startedAt: "2026-07-20T00:00:03.000Z",
        lastActivityAt: "2026-07-20T00:00:03.000Z",
        completedAt: null,
        summary: null,
        revision: 1,
      },
      providerThread: {
        id: "thread_replacement",
        adapterId: "fixture",
        lineageParentId: "thread_legacy",
      },
    });
    expect(store.getProviderThread("thread_replacement")).toMatchObject({
      lineageParentId: "thread_legacy",
      status: "active",
    });
    store.close();
    catalog.close();
  });

  it("rejects a replayed turn_started event after semantic execution success", () => {
    const { catalog, store } = createStore();
    createTask(store, catalog);
    store.createExecution({
      execution: {
        id: "execution_terminal",
        taskId: "task_test",
        goalId: "goal_1",
        phaseRunId: "phase_terminal",
        phase: "planexec",
        providerThreadId: "thread_terminal",
        status: "running",
        generation: "generation_terminal",
        attachment: null,
        startedAt: "2026-07-20T00:00:01.000Z",
        lastActivityAt: "2026-07-20T00:00:01.000Z",
        completedAt: null,
        summary: null,
        revision: 1,
      },
      providerThread: { id: "thread_terminal", adapterId: "fixture" },
    });
    const succeeded = store.updateExecution({
      executionId: "execution_terminal",
      generation: "generation_terminal",
      expectedRevision: 1,
      status: "succeeded",
      summary: "Semantic result accepted.",
    });
    expect(succeeded?.status).toBe("succeeded");
    expect(
      store.markExecutionAwaitingProvider({
        executionId: "execution_terminal",
        generation: "generation_terminal",
      }),
    ).toBeNull();
    expect(store.getExecution("execution_terminal")?.status).toBe("succeeded");
    store.close();
    catalog.close();
  });

  it("deduplicates exact human decisions and preserves their original payloads", () => {
    const { catalog, store } = createStore();
    createTask(store, catalog);
    const input = {
      taskId: "task_test",
      turnId: null,
      cardId: "card_1",
      kind: "goal_card_answer",
      displayed: { title: "Choose", options: ["A", "B"] },
      rawAnswer: { choice: "A", note: "exact text" },
      normalized: { choiceId: "a" },
      actorId: "human",
      clientId: "desktop",
      deviceId: "device_1",
      commandId: "command_1",
      expectedRevision: 1,
      resultRevision: 2,
      supersedesDecisionId: null,
      fidelity: "exact" as const,
    };
    const first = store.appendDecision(input);
    const duplicate = store.appendDecision(input);
    expect(duplicate).toEqual(first);
    expect(store.listDecisions("task_test")).toEqual([first]);
    expect(first.rawAnswer).toEqual({ choice: "A", note: "exact text" });
    store.close();
    catalog.close();
  });

  it("records provider permission before execution resumes and preserves the displayed payload", () => {
    const { catalog, store } = createStore();
    createTask(store, catalog);
    store.createExecution({
      execution: {
        id: "execution_permission",
        taskId: "task_test",
        goalId: "goal_1",
        phaseRunId: "phase_permission",
        phase: "planexec",
        providerThreadId: "thread_permission",
        status: "awaiting_provider",
        generation: "generation_permission",
        attachment: null,
        startedAt: "2026-07-20T00:00:01.000Z",
        lastActivityAt: "2026-07-20T00:00:01.000Z",
        completedAt: null,
        summary: null,
        revision: 1,
      },
      providerThread: { id: "thread_permission", adapterId: "fixture" },
    });
    const revision = store.getTask("task_test")!.revision;
    const input = {
      agentId: "agent_internal",
      providerThreadId: "thread_permission",
      requestId: "permission_1",
      displayed: {
        id: "permission_1",
        kind: "tool",
        title: "Allow workspace write?",
        input: { path: "src/index.ts" },
      },
      rawAnswer: { behavior: "allow", selectedActionId: "allow_once" },
      actorId: "user:test",
      clientId: "desktop",
      deviceId: "device_1",
    };
    const first = store.recordProviderPermissionDecision(input);
    expect(first.duplicate).toBe(false);
    expect(first.decision).toMatchObject({
      taskId: "task_test",
      kind: "provider_permission",
      displayed: input.displayed,
      rawAnswer: input.rawAnswer,
      expectedRevision: revision,
      resultRevision: revision + 1,
      fidelity: "exact",
    });
    expect(first.task?.revision).toBe(revision + 1);
    expect(
      store
        .getTaskContext("task_test")
        ?.blackboard.some(
          (entry) =>
            entry.kind === "human_decision" &&
            (entry.content as { requestId?: unknown }).requestId === "permission_1",
        ),
    ).toBe(true);

    const duplicate = store.recordProviderPermissionDecision(input);
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.decision.id).toBe(first.decision.id);
    expect(duplicate.task?.revision).toBe(revision + 1);
    store.close();
    catalog.close();
  });

  it("resolves execution approvals with CAS, command idempotency, and an honest resolution actor", () => {
    const { catalog, store } = createStore();
    createTask(store, catalog);
    store.createExecution({
      execution: {
        id: "execution_approval",
        taskId: "task_test",
        goalId: "goal_1",
        phaseRunId: "phase_approval",
        phase: "planexec",
        providerThreadId: "thread_approval",
        status: "planning",
        generation: "generation_approval",
        attachment: null,
        startedAt: "2026-07-22T00:00:00.000Z",
        lastActivityAt: "2026-07-22T00:00:00.000Z",
        completedAt: null,
        summary: null,
        revision: 1,
      },
      providerThread: { id: "thread_approval", adapterId: "fixture" },
    });
    const approval = store.createExecutionApproval({
      executionId: "execution_approval",
      generation: "generation_approval",
      request: {
        id: "provider-plan-approval",
        kind: "implement",
        title: "Implement plan",
        description: "The native Plan is ready.",
        displayed: { plan: ["Inspect", "Implement", "Verify"] },
        autoApproveEligible: true,
      },
      deadlineAt: "2026-07-22T00:00:20.000Z",
    });
    expect(store.getExecution("execution_approval")).toMatchObject({
      status: "awaiting_implementation",
      pendingApproval: { id: approval.id, kind: "implement", status: "pending" },
    });

    const resolved = store.resolveExecutionApproval({
      taskId: "task_test",
      executionId: "execution_approval",
      approvalId: approval.id,
      decision: "implement",
      expectedRevision: approval.revision,
      commandId: "human-implement-command",
      actorId: "human:user-1",
      clientId: "desktop",
      deviceId: "device-1",
      recordHumanDecision: true,
    });
    expect(resolved).toMatchObject({
      duplicate: false,
      execution: { status: "implementing", pendingApproval: null },
      approval: {
        status: "allowed",
        resolution: { decision: "implement", actorId: "human:user-1" },
      },
    });
    expect(store.listDecisions("task_test").at(-1)).toMatchObject({
      kind: "execution_approval",
      actorId: "human:user-1",
      rawAnswer: { decision: "implement" },
    });

    expect(
      store.markExecutionAwaitingProvider({
        executionId: "execution_approval",
        generation: "generation_approval",
      }),
    ).toMatchObject({ status: "awaiting_provider" });

    const duplicate = store.resolveExecutionApproval({
      taskId: "task_test",
      executionId: "execution_approval",
      approvalId: approval.id,
      decision: "implement",
      expectedRevision: approval.revision,
      commandId: "human-implement-command",
      actorId: "human:user-1",
      clientId: "desktop",
      recordHumanDecision: true,
    });
    expect(duplicate.duplicate).toBe(true);

    expect(() =>
      store.resolveExecutionApproval({
        taskId: "task_test",
        executionId: "execution_approval",
        approvalId: approval.id,
        decision: "deny",
        expectedRevision: approval.revision,
        commandId: "late-deny-command",
        actorId: "daemon:auto-approval-timeout",
        clientId: "daemon",
        recordHumanDecision: false,
      }),
    ).toThrow("changed before this decision");
    expect(store.getExecutionApproval(approval.id)?.resolution?.actorId).toBe("human:user-1");
    store.close();
    catalog.close();
  });

  it("never admits provider questions into the background approval authority", () => {
    const { catalog, store } = createStore();
    createTask(store, catalog);
    store.createExecution({
      execution: {
        id: "execution_question",
        taskId: "task_test",
        goalId: "goal_1",
        phaseRunId: "phase_question",
        phase: "review",
        providerThreadId: "thread_question",
        status: "running",
        generation: "generation_question",
        attachment: null,
        startedAt: "2026-07-22T00:00:00.000Z",
        lastActivityAt: "2026-07-22T00:00:00.000Z",
        completedAt: null,
        summary: null,
        revision: 1,
      },
      providerThread: { id: "thread_question", adapterId: "fixture" },
    });

    expect(() =>
      store.createExecutionApproval({
        executionId: "execution_question",
        generation: "generation_question",
        request: {
          id: "provider-question",
          kind: "question",
          title: "Choose an implementation direction",
          description: null,
          displayed: { choices: ["A", "B"] },
          autoApproveEligible: false,
        },
        deadlineAt: "2026-07-22T00:00:20.000Z",
      }),
    ).toThrow("Provider questions cannot enter");
    expect(store.getPendingExecutionApproval("execution_question")).toBeNull();
    store.close();
    catalog.close();
  });

  it("associates visible Agent permissions with the active foreground turn", () => {
    const { workspaceId, catalog, store } = createStore();
    const started = store.startForegroundTurn({
      agentId: "agent_visible",
      kind: "raw",
      sourceMessageId: "message_permission",
      workspaceId,
      workspacePath: "/workspace",
      userText: "Run the action after approval.",
    });
    const input = {
      agentId: "agent_visible",
      providerThreadId: null,
      requestId: "permission_foreground",
      displayed: {
        id: "permission_foreground",
        kind: "tool",
        title: "Allow workspace read?",
        input: { path: "README.md" },
      },
      rawAnswer: { behavior: "allow", selectedActionId: "allow_once" },
      actorId: "user:test",
      clientId: "desktop",
      deviceId: "device_1",
    };

    const first = store.recordProviderPermissionDecision(input);
    expect(first).toMatchObject({
      duplicate: false,
      task: null,
      decision: {
        taskId: null,
        turnId: started.turn.id,
        kind: "provider_permission",
        displayed: input.displayed,
        rawAnswer: input.rawAnswer,
        expectedRevision: started.state.revision,
        resultRevision: started.state.revision + 1,
        fidelity: "exact",
      },
    });
    expect(store.getForegroundState("agent_visible").revision).toBe(started.state.revision + 1);

    const duplicate = store.recordProviderPermissionDecision(input);
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.decision.id).toBe(first.decision.id);
    expect(store.getForegroundState("agent_visible").revision).toBe(started.state.revision + 1);
    store.close();
    catalog.close();
  });

  it("commits Stop before interrupt completion and never projects a running spinner state", () => {
    const { catalog, store } = createStore();
    createTask(store, catalog);
    store.createExecution({
      execution: {
        id: "execution_stop",
        taskId: "task_test",
        goalId: "goal_1",
        phaseRunId: "phase_stop",
        phase: "planexec",
        providerThreadId: "thread_stop",
        status: "awaiting_provider",
        generation: "generation_stop",
        attachment: null,
        startedAt: "2026-07-20T00:00:01.000Z",
        lastActivityAt: "2026-07-20T00:00:01.000Z",
        completedAt: null,
        summary: null,
        revision: 1,
      },
      providerThread: { id: "thread_stop", adapterId: "fixture" },
    });
    const approval = store.createExecutionApproval({
      executionId: "execution_stop",
      generation: "generation_stop",
      request: {
        id: "provider-stop-permission",
        kind: "command",
        title: "Run a mutating command",
        description: null,
        displayed: { command: "npm test" },
        autoApproveEligible: true,
      },
      deadlineAt: "2026-07-22T00:00:20.000Z",
    });
    const current = store.getTask("task_test")!;
    const requested = store.requestStop({
      taskId: current.id,
      expectedRevision: current.revision,
      commandId: "stop_command",
      actorId: "human",
      clientId: "desktop",
    });
    expect(requested.task.status).toBe("stopping");
    expect(requested.execution?.status).toBe("cancel_requested");
    expect(store.getExecutionApproval(approval.id)).toMatchObject({
      status: "canceled",
      deadlineAt: null,
    });
    expect(
      store.interruptExecution({
        executionId: "execution_stop",
        generation: "generation_stop",
        summary: "The provider emitted a canceled terminal.",
      }),
    ).toBe(false);
    expect(store.getTask("task_test")?.status).toBe("stopping");
    expect(store.getExecution("execution_stop")?.status).toBe("cancel_requested");
    const settled = store.settleStop({
      taskId: current.id,
      executionId: "execution_stop",
      generation: "generation_stop",
    });
    expect(settled.task.status).toBe("stopped");
    expect(settled.execution?.status).toBe("canceled");
    expect(
      store.requestStop({
        taskId: current.id,
        expectedRevision: current.revision,
        commandId: "stop_command",
        actorId: "human",
        clientId: "desktop",
      }).duplicate,
    ).toBe(true);
    store.close();
    catalog.close();
  });

  it("interrupts an unrecoverable pending approval on daemon restart", () => {
    const { catalog, store } = createStore();
    createTask(store, catalog);
    store.createExecution({
      execution: {
        id: "execution_restart_approval",
        taskId: "task_test",
        goalId: "goal_1",
        phaseRunId: "phase_restart_approval",
        phase: "planexec",
        providerThreadId: "thread_restart_approval",
        status: "planning",
        generation: "generation_restart_approval",
        attachment: null,
        startedAt: "2026-07-22T00:00:00.000Z",
        lastActivityAt: "2026-07-22T00:00:00.000Z",
        completedAt: null,
        summary: null,
        revision: 1,
      },
      providerThread: { id: "thread_restart_approval", adapterId: "fixture" },
    });
    const approval = store.createExecutionApproval({
      executionId: "execution_restart_approval",
      generation: "generation_restart_approval",
      request: {
        id: "provider-restart-plan",
        kind: "implement",
        title: "Implement plan",
        description: null,
        displayed: { plan: "Implement after approval." },
        autoApproveEligible: true,
      },
      deadlineAt: "2026-07-22T00:00:20.000Z",
    });

    expect(store.recoverInterruptedExecutionsAfterRestart()).toEqual(["task_test"]);
    expect(store.getExecution("execution_restart_approval")).toMatchObject({
      status: "failed",
      summary: expect.stringContaining("approval callback was pending"),
      pendingApproval: null,
    });
    expect(store.getExecutionApproval(approval.id)?.status).toBe("canceled");
    expect(store.getTask("task_test")).toMatchObject({
      status: "interrupted",
      currentExecutionId: null,
    });
    store.close();
    catalog.close();
  });

  it("pauses atomically after PlanExec and resumes at the Review boundary", () => {
    const { catalog, store } = createStore();
    createTask(store, catalog);
    store.createExecution({
      execution: {
        id: "execution_pause",
        taskId: "task_test",
        goalId: "goal_1",
        phaseRunId: "phase_pause",
        phase: "planexec",
        providerThreadId: "thread_pause",
        status: "awaiting_provider",
        generation: "generation_pause",
        attachment: null,
        startedAt: "2026-07-20T00:00:01.000Z",
        lastActivityAt: "2026-07-20T00:00:01.000Z",
        completedAt: null,
        summary: null,
        revision: 1,
      },
      providerThread: { id: "thread_pause", adapterId: "fixture" },
    });
    store.recordAttachment({
      executionId: "execution_pause",
      receipt: {
        id: "attachment_pause",
        adapterId: "fixture",
        threadId: "thread_pause",
        bundleId: "thoth.loop",
        bundleDigest: `sha256:${"b".repeat(64)}`,
        instructionAttachment: "session_prompt",
        toolAttachment: "mcp",
        attachedAt: "2026-07-20T00:00:02.000Z",
      },
    });
    const running = store.getTask("task_test")!;
    const requested = store.requestCommand({
      taskId: running.id,
      command: "pause",
      expectedRevision: running.revision,
      commandId: "pause_command",
      actorId: "human",
      clientId: "desktop",
    });
    expect(requested.task.pendingControl).toBe("pause");

    expect(
      store.acceptPlanExecResult({
        executionId: "execution_pause",
        generation: "generation_pause",
        result: {
          plan_summary: "Complete the approved PlanExec checkpoint.",
          execution_summary: "The approved PlanExec checkpoint completed.",
          evidence: ["The semantic result was accepted."],
          validation_performed: ["Checked the phase boundary."],
          remaining_risks: [],
          next_review_focus: "Run the independent Review after Resume.",
        },
        callId: "planexec_result",
      }),
    ).toBe(true);
    const paused = store.getTask("task_test")!;
    expect(paused).toMatchObject({
      status: "paused",
      currentExecutionId: null,
      pendingControl: null,
    });
    expect(store.getExecution("execution_pause")?.status).toBe("succeeded");

    const resumed = store.requestCommand({
      taskId: paused.id,
      command: "resume",
      expectedRevision: paused.revision,
      commandId: "resume_command",
      actorId: "human",
      clientId: "desktop",
    });
    expect(resumed.task).toMatchObject({ status: "queued", currentGoalId: "goal_1" });
    store.close();
    catalog.close();
  });

  it("requires a durable RuntimeBundle attachment receipt for an execution", () => {
    const { catalog, store } = createStore();
    createTask(store, catalog);
    store.createExecution({
      execution: {
        id: "execution_bundle",
        taskId: "task_test",
        goalId: "goal_1",
        phaseRunId: "phase_bundle",
        phase: "review",
        providerThreadId: "thread_bundle",
        status: "starting",
        generation: "generation_bundle",
        attachment: null,
        startedAt: "2026-07-20T00:00:01.000Z",
        lastActivityAt: "2026-07-20T00:00:01.000Z",
        completedAt: null,
        summary: null,
        revision: 1,
      },
      providerThread: { id: "thread_bundle", adapterId: "fixture" },
    });
    const receipt: RuntimeAttachmentReceipt = {
      id: "attachment_1",
      adapterId: "fixture",
      threadId: "thread_bundle",
      bundleId: "thoth.loop",
      bundleDigest: `sha256:${"a".repeat(64)}`,
      instructionAttachment: "session_prompt",
      toolAttachment: "mcp",
      attachedAt: "2026-07-20T00:00:02.000Z",
    };
    store.recordAttachment({ executionId: "execution_bundle", receipt });
    expect(store.getExecution("execution_bundle")?.attachment).toMatchObject({
      bundleId: "thoth.loop",
      bundleDigest: receipt.bundleDigest,
    });
    store.close();
    catalog.close();
  });

  it("returns complete semantic Task context without runtime mechanics", () => {
    const { catalog, store } = createStore();
    createTask(store, catalog);
    const entry = store.appendBlackboard({
      taskId: "task_test",
      kind: "review_direction",
      producer: "review",
      content: { conclusion: "Reframe around the real invariant." },
    });
    const context = store.getTaskContext("task_test");
    expect(context?.blackboard).toEqual([entry]);
    const serialized = JSON.stringify(context);
    expect(serialized).not.toContain("generation");
    expect(serialized).not.toContain("providerThreadId");
    expect(
      readFileSync(
        entry.contentDigest
          ? path.join(
              store.workspaceRoot,
              "blobs",
              "sha256",
              entry.contentDigest.slice(0, 2),
              entry.contentDigest,
            )
          : "",
      ),
    ).toBeTruthy();
    store.close();
    catalog.close();
  });

  it("persists foreground queue order and fences queue commands with authority revision", () => {
    const created = createStore();
    const { catalog } = created;
    let { store } = created;
    const first = store.enqueueForegroundTurn({
      agentId: "agent_visible",
      messageId: "message-queue-1",
      text: "wait for the current turn",
      deliveryMode: "queue",
      attachmentCount: 0,
      payload: { marker: "first" },
    });
    const replayedFirst = store.enqueueForegroundTurn({
      agentId: "agent_visible",
      messageId: "message-queue-1",
      text: "must not replace the frozen payload",
      deliveryMode: "interrupt",
      attachmentCount: 1,
      payload: { marker: "replacement" },
    });
    expect(replayedFirst).toMatchObject({ created: false });
    expect(replayedFirst.queuedTurn).toMatchObject({
      text: "wait for the current turn",
      deliveryMode: "queue",
      attachmentCount: 0,
    });
    const interrupt = store.enqueueForegroundTurn({
      agentId: "agent_visible",
      messageId: "message-interrupt-1",
      text: "stop then run this",
      deliveryMode: "interrupt",
      attachmentCount: 1,
      payload: {
        marker: "interrupt",
        text: "stop then run this",
        rawPrompt: [
          { type: "text", text: "stop then run this" },
          { type: "image", data: "frozen-image", mimeType: "image/png" },
        ],
        images: [{ data: "frozen-image", mimeType: "image/png" }],
        contextRefs: [{ type: "task", taskId: "task-1", revision: 3 }],
        thoth: { enabled: true, executionMode: "loop" },
        providerRunMode: "plan",
      },
    });
    store.close();
    store = new WorkspaceAuthorityStore({
      thothHome: created.root,
      workspaceId: created.workspaceId,
      catalog,
    });

    expect(store.listForegroundQueue("agent_visible").map((item) => item.messageId)).toEqual([
      "message-interrupt-1",
      "message-queue-1",
    ]);
    expect(store.peekForegroundQueue("agent_visible")?.payload).toMatchObject({
      marker: "interrupt",
      text: "stop then run this",
    });
    expect(store.getForegroundState("agent_visible").queuedTurns).toHaveLength(2);

    const stale = store.commandForegroundQueue({
      agentId: "agent_visible",
      queuedTurnId: first.queuedTurn.id,
      command: "delete",
      expectedRevision: first.revision,
      commandId: "queue-command-stale",
    });
    expect(stale).toMatchObject({ accepted: false, conflict: true });

    const edited = store.commandForegroundQueue({
      agentId: "agent_visible",
      queuedTurnId: interrupt.queuedTurn.id,
      command: "edit",
      text: "edited without replacing frozen context",
      expectedRevision: interrupt.revision,
      commandId: "queue-command-edit",
    });
    expect(edited).toMatchObject({
      accepted: true,
      restoredText: "edited without replacing frozen context",
    });
    expect(store.listForegroundQueue("agent_visible")).toHaveLength(2);
    expect(store.peekForegroundQueue("agent_visible")?.payload).toMatchObject({
      marker: "interrupt",
      text: "edited without replacing frozen context",
      rawPrompt: [
        { type: "text", text: "edited without replacing frozen context" },
        { type: "image", data: "frozen-image", mimeType: "image/png" },
      ],
      images: [{ data: "frozen-image", mimeType: "image/png" }],
      contextRefs: [{ type: "task", taskId: "task-1", revision: 3 }],
      thoth: { enabled: true, executionMode: "loop" },
      providerRunMode: "plan",
    });
    expect(
      store.commandForegroundQueue({
        agentId: "agent_visible",
        queuedTurnId: first.queuedTurn.id,
        command: "delete",
        expectedRevision: first.revision,
        commandId: "queue-command-stale",
      }),
    ).toMatchObject({ accepted: false, conflict: true, duplicate: true });
    store.close();
    catalog.close();
  });

  it("persists provider-native rewind anchors and resets the canonical timeline epoch", () => {
    const { root, catalog, store } = createStore();
    store.upsertAgentRecord({
      id: "agent_visible",
      provider: "codex",
      title: "Visible",
      cwd: "/tmp/workspace",
      workspaceId: "wks_test",
      config: { provider: "codex", cwd: "/tmp/workspace" },
      labels: {},
      lastStatus: "closed",
      persistence: {
        provider: "codex",
        sessionId: "native-thread-1",
        nativeHandle: "native-thread-1",
      },
      createdAt: "2026-07-20T00:00:00.000Z",
      updatedAt: "2026-07-20T00:00:00.000Z",
      archivedAt: null,
    });
    store.appendAgentTimelineRows("agent_visible", [
      {
        seq: 1,
        timestamp: "2026-07-20T00:00:00.000Z",
        item: { type: "user_message", text: "first", messageId: "canonical-1" },
      },
      {
        seq: 2,
        timestamp: "2026-07-20T00:00:01.000Z",
        item: { type: "assistant_message", text: "answer" },
      },
    ]);
    const before = store.getAgentTimelineMeta("agent_visible")?.epoch;
    store.bindProviderMessageAnchor(
      "agent_visible",
      "canonical-1",
      { version: 1, opaqueAnchor: "native-1" },
      ["conversation"],
    );
    expect(store.getProviderMessageAnchor("agent_visible", "canonical-1", "conversation")).toEqual({
      version: 1,
      opaqueAnchor: "native-1",
    });
    expect(store.getProviderMessageAnchor("agent_visible", "canonical-1", "files")).toBeNull();
    const database = new DatabaseSync(
      path.join(root, "workspaces", "wks_test", "authority.sqlite"),
      { readOnly: true },
    );
    expect(
      database
        .prepare(
          `SELECT provider_thread_id, native_anchor_receipt_json, scopes_json
           FROM provider_message_anchors WHERE canonical_message_id = ?`,
        )
        .get("canonical-1"),
    ).toMatchObject({
      provider_thread_id: "provider-thread-visible-agent_visible",
      native_anchor_receipt_json: JSON.stringify({ version: 1, opaqueAnchor: "native-1" }),
      scopes_json: JSON.stringify(["conversation"]),
    });
    database.close();

    store.truncateAgentTimelineFromMessage("agent_visible", "canonical-1");
    expect(store.listAgentTimelineRows("agent_visible")).toEqual([]);
    expect(store.getAgentTimelineMeta("agent_visible")?.epoch).not.toBe(before);
    store.close();
    catalog.close();
  });
});
