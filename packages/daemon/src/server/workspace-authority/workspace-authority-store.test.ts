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
});
