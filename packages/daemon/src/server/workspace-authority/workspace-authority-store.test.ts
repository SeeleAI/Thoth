import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import type { RuntimeAttachmentReceipt } from "@thoth/drivers/harness";
import { WorkspaceCatalogStore } from "./catalog-store.js";
import { WorkspaceAuthorityStore } from "./workspace-authority-store.js";
import {
  createProviderTurnInteractionState,
  createTaskAuthority,
  reduceProviderTurnInteraction,
} from "@thoth/core";
import type { ExecutionProjection } from "@thoth/protocol/task-authority";

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

function createTask(store: WorkspaceAuthorityStore) {
  const now = "2026-07-20T00:00:00.000Z";
  store.upsertAgentRecord({
    id: "agent_visible",
    provider: "fixture",
    cwd: "/workspace",
    workspaceId: "wks_test",
    createdAt: now,
    updatedAt: now,
    labels: {},
    lastStatus: "idle",
    providerRunMode: "default",
    providerControlRevision: 0,
  });
  const task = createTaskAuthority({
    id: "task_test",
    workspaceId: "wks_test",
    sourceAgentWorkspaceId: "wks_test",
    sourceAgentId: "agent_visible",
    mode: "loop",
    intentContract: {
      id: "intent-contract-test",
      workspaceId: "wks_test",
      sourceAgentId: "agent_visible",
      taskId: null,
      title: "Exercise the final authority",
      objective: "Prove Task and Execution identities stay separate.",
      nonGoals: [],
      invariants: ["No provider-specific authority"],
      acceptanceClaims: [
        {
          id: "acceptance-claim-stop",
          statement: "Stop fences the active execution",
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
    },
    strength: "balanced",
    now,
  });
  return store.registerTask({
    task,
    sourceTurnId: "source-turn-test",
    sourceContractCardId: "source-contract-card-test",
    providerProfileId: "provider-profile-test",
  }).task;
}

function createLoopExecution(
  store: WorkspaceAuthorityStore,
  input: {
    id: string;
    status: ExecutionProjection["status"];
    generation: string;
    threadId: string;
    phase?: "execute" | "review";
    providerThread?: {
      id: string;
      adapterId: string;
      nativeHandle?: string | null;
      persistence?: Record<string, unknown> | null;
      lineageParentId?: string | null;
    };
  },
) {
  const phase = input.phase ?? "execute";
  const cycleId = `cycle-${input.id}`;
  const workUnit =
    phase === "execute"
      ? {
          id: `work-unit-${input.id}`,
          taskId: "task_test",
          cycleId,
          title: "Current gap",
          activeGap: "Prove Task and Execution identities stay separate.",
          progressClaim: "No checkpoint has been submitted.",
          unresolvedGap: "Prove Task and Execution identities stay separate.",
          evidenceRefs: [],
          status: "active" as const,
          revision: 1,
          createdAt: "2026-07-20T00:00:01.000Z",
          updatedAt: "2026-07-20T00:00:01.000Z",
        }
      : undefined;
  return store.createExecution({
    execution: {
      id: input.id,
      taskId: "task_test",
      workUnitId: workUnit?.id ?? null,
      cycleId,
      phase,
      providerThreadId: input.threadId,
      status: input.status,
      generation: input.generation,
      attachment: null,
      runModeReceipt: null,
      pendingApproval: null,
      startedAt: "2026-07-20T00:00:01.000Z",
      lastActivityAt: "2026-07-20T00:00:01.000Z",
      completedAt: null,
      summary: null,
      revision: 1,
    },
    cycle: {
      id: cycleId,
      status: phase === "review" ? "reviewing" : "active",
      startedAt: "2026-07-20T00:00:01.000Z",
    },
    ...(workUnit ? { workUnit } : {}),
    providerThread: input.providerThread ?? { id: input.threadId, adapterId: "fixture" },
  });
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("WorkspaceAuthorityStore", () => {
  it("keeps Provider question command receipts idempotent and free of answer plaintext", () => {
    const { root, store, catalog } = createStore();
    const result = {
      agentId: "agent_visible",
      interactionId: "question-1",
      accepted: true,
      conflict: false,
      revision: 1,
      errorCode: null,
      error: null,
    };
    const receipt = {
      resolutionType: "answer" as const,
      answeredQuestionIds: ["public", "secret"],
      nonSecretAnswerDigest: "sha256-digest-only",
      secretQuestionCount: 1,
    };

    expect(
      store.recordProviderQuestionCommand({
        agentId: "agent_visible",
        interactionId: "question-1",
        commandId: "provider-question-command-1",
        resultRevision: 1,
        result,
        receipt,
      }),
    ).toMatchObject({ duplicate: false, revision: 1 });
    expect(
      store.recordProviderQuestionCommand({
        agentId: "agent_visible",
        interactionId: "question-1",
        commandId: "provider-question-command-1",
        resultRevision: 99,
        result: { ignored: "correct horse battery staple" },
        receipt: { ...receipt, nonSecretAnswerDigest: "ignored-public-answer" },
      }),
    ).toMatchObject({ duplicate: true, revision: 1 });
    expect(() =>
      store.getProviderQuestionCommandResult({
        agentId: "agent_visible",
        interactionId: "question-2",
        commandId: "provider-question-command-1",
      }),
    ).toThrow(/another authority action/);

    const dbPath = path.join(root, "workspaces", "wks_test", "authority.sqlite");
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const row = db
      .prepare("SELECT result_json FROM authority_commands WHERE command_id = ?")
      .get("provider-question-command-1") as { result_json: string };
    db.close();
    expect(JSON.parse(row.result_json)).toEqual({ result, receipt });
    store.close();
    catalog.close();
    const authorityFiles = readdirSync(path.dirname(dbPath))
      .filter((name) => name.startsWith("authority.sqlite"))
      .map((name) => readFileSync(path.join(path.dirname(dbPath), name)));
    for (const sqliteBytes of authorityFiles) {
      expect(sqliteBytes.includes(Buffer.from("correct horse battery staple"))).toBe(false);
      expect(sqliteBytes.includes(Buffer.from("ignored-public-answer"))).toBe(false);
    }
  });

  it("stores Agent provider control with CAS and command idempotency", () => {
    const { store } = createStore();
    store.upsertAgentRecord({
      id: "agent_visible",
      provider: "codex",
      cwd: "/workspace",
      workspaceId: "wks_test",
      createdAt: "2026-07-20T00:00:00.000Z",
      updatedAt: "2026-07-20T00:00:00.000Z",
      labels: {},
      lastStatus: "idle",
      providerRunMode: "default",
      providerControlRevision: 0,
    });

    const first = store.updateAgentProviderControl({
      agentId: "agent_visible",
      runMode: "plan",
      expectedRevision: 0,
      commandId: "provider-control-1",
    });
    expect(first).toEqual({ runMode: "plan", revision: 1 });
    expect(
      store.updateAgentProviderControl({
        agentId: "agent_visible",
        runMode: "plan",
        expectedRevision: 0,
        commandId: "provider-control-1",
      }),
    ).toEqual(first);
    expect(() =>
      store.updateAgentProviderControl({
        agentId: "agent_visible",
        runMode: "default",
        expectedRevision: 0,
        commandId: "provider-control-2",
      }),
    ).toThrow("Provider control revision conflict");
    expect(store.getAgentRecord("agent_visible")).toMatchObject({
      providerRunMode: "plan",
      providerControlRevision: 1,
    });
  });

  it("stores normalized Task and Execution projections without full projection events", () => {
    const { root, catalog, store } = createStore();
    createTask(store);
    const execution = createLoopExecution(store, {
      id: "execution_1",
      threadId: "thread_1",
      status: "running",
      generation: "generation_1",
    });
    expect(execution.status).toBe("running");
    expect(store.getTask("task_test")?.currentExecutionId).toBe("execution_1");

    const db = new DatabaseSync(path.join(root, "workspaces", "wks_test", "authority.sqlite"), {
      readOnly: true,
    });
    expect(
      db
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'authority_events'")
        .get(),
    ).toBeUndefined();
    expect(
      (
        db
          .prepare("SELECT authority_revision FROM workspace_meta WHERE workspace_id = ?")
          .get("wks_test") as { authority_revision: number }
      ).authority_revision,
    ).toBe(3);
    db.close();
    store.close();
    catalog.close();
  });

  it("never resumes unavailable legacy context and records an explicit replacement lineage", () => {
    const { catalog, store } = createStore();
    createTask(store);
    const legacy = createLoopExecution(store, {
      id: "execution_legacy",
      threadId: "thread_legacy",
      status: "starting",
      generation: "generation_legacy",
      providerThread: {
        id: "thread_legacy",
        adapterId: "fixture",
        nativeHandle: "native_legacy",
        persistence: { migration: { disposition: "replacement_required" } },
      },
    });
    expect(
      store.updateProviderThread({
        threadId: "thread_legacy",
        nativeHandle: "native_legacy",
        persistence: { migration: { disposition: "replacement_required" } },
        status: "native_context_unavailable",
      }),
    ).toBe(true);
    expect(
      store.interruptExecution({
        executionId: legacy.id,
        generation: legacy.generation,
        summary: "Native context is unavailable.",
      }),
    ).toBe(true);

    expect(store.findLatestExecuteThread("task_test")).toBeNull();
    expect(store.findLatestExecuteLineageThread("task_test")).toMatchObject({
      id: "thread_legacy",
      status: "native_context_unavailable",
    });

    createLoopExecution(store, {
      id: "execution_replacement",
      threadId: "thread_replacement",
      status: "starting",
      generation: "generation_replacement",
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
    createTask(store);
    createLoopExecution(store, {
      id: "execution_terminal",
      threadId: "thread_terminal",
      status: "running",
      generation: "generation_terminal",
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
    createTask(store);
    const input = {
      taskId: "task_test",
      command: "pause" as const,
      actorId: "human",
      clientId: "desktop",
      deviceId: "device_1",
      commandId: "command_1",
      expectedRevision: 1,
    };
    const first = store.requestCommand(input);
    const revisionAfterFirst = store.readSnapshot("wks_test").revision;
    const duplicate = store.requestCommand(input);
    expect(duplicate).toMatchObject({ task: first.task, duplicate: true });
    expect(store.readSnapshot("wks_test").revision).toBe(revisionAfterFirst);
    expect(() =>
      store.requestCommand({
        ...input,
        commandId: "command-stale",
        expectedRevision: 1,
      }),
    ).toThrow("revision changed");
    expect(store.readSnapshot("wks_test").revision).toBe(revisionAfterFirst);
    const decisions = store.listDecisions("task_test");
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      displayed: { command: "pause" },
      rawAnswer: "pause",
      normalized: { command: "pause", resultingStatus: "paused" },
      deviceId: "device_1",
      fidelity: "exact",
    });
    store.close();
    catalog.close();
  });

  it("records provider permission before execution resumes and preserves the displayed payload", () => {
    const { catalog, store } = createStore();
    createTask(store);
    createLoopExecution(store, {
      id: "execution_permission",
      threadId: "thread_permission",
      status: "awaiting_provider",
      generation: "generation_permission",
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
        ?.decisions.some(
          (decision) =>
            decision.kind === "provider_permission" &&
            (decision.displayed as { id?: unknown }).id === "permission_1",
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
    createTask(store);
    createLoopExecution(store, {
      id: "execution_approval",
      threadId: "thread_approval",
      status: "planning",
      generation: "generation_approval",
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
      rawAnswer: "implement",
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
    ).toThrow("no longer pending");
    expect(store.getExecutionApproval(approval.id)?.resolution?.actorId).toBe("human:user-1");
    store.close();
    catalog.close();
  });

  it("never admits provider questions into the background approval authority", () => {
    const { catalog, store } = createStore();
    createTask(store);
    createLoopExecution(store, {
      id: "execution_question",
      threadId: "thread_question",
      status: "running",
      generation: "generation_question",
      phase: "review",
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
    expect(store.getExecution("execution_question")?.pendingApproval).toBeNull();
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

  it("CAS-fences Provider interaction and completed Plan receipts on the foreground turn", () => {
    const { workspaceId, catalog, store } = createStore();
    const started = store.startForegroundTurn({
      agentId: "agent_plan",
      kind: "raw",
      sourceMessageId: "message_plan",
      workspaceId,
      workspacePath: "/workspace",
      userText: "Plan this change.",
      providerRunMode: "plan",
    });
    const running = createProviderTurnInteractionState({
      providerThreadId: "thread-plan",
      providerTurnId: "turn-plan",
    });
    const first = store.recordForegroundProviderInteraction({
      agentId: "agent_plan",
      turnId: started.turn.id,
      generation: started.turn.generation,
      expectedRevision: 0,
      interaction: running,
    });
    expect(first).toMatchObject({
      providerInteraction: running,
      providerInteractionRevision: 1,
      providerPlanReceipt: null,
    });
    expect(() =>
      store.recordForegroundProviderInteraction({
        agentId: "agent_plan",
        turnId: started.turn.id,
        generation: started.turn.generation,
        expectedRevision: 0,
        interaction: running,
      }),
    ).toThrow(/interaction changed/);

    const text = "Inspect, implement, and verify.";
    const planned = reduceProviderTurnInteraction(running, {
      type: "plan_completed",
      providerThreadId: "thread-plan",
      providerTurnId: "turn-plan",
      itemId: "plan-item",
      byteLength: Buffer.byteLength(text, "utf8"),
    }).state;
    const receipt = {
      providerThreadId: "thread-plan",
      providerTurnId: "turn-plan",
      itemId: "plan-item",
      text,
      originalBytes: Buffer.byteLength(text, "utf8"),
      retainedBytes: Buffer.byteLength(text, "utf8"),
    };
    const second = store.recordForegroundProviderInteraction({
      agentId: "agent_plan",
      turnId: started.turn.id,
      generation: started.turn.generation,
      expectedRevision: 1,
      interaction: planned,
      planReceipt: receipt,
    });
    expect(second).toMatchObject({
      providerInteraction: planned,
      providerInteractionRevision: 2,
      providerPlanReceipt: receipt,
    });
    store.close();
    catalog.close();
  });

  it("commits Stop before interrupt completion and never projects a running spinner state", () => {
    const { catalog, store } = createStore();
    createTask(store);
    createLoopExecution(store, {
      id: "execution_stop",
      threadId: "thread_stop",
      status: "awaiting_provider",
      generation: "generation_stop",
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
    const requested = store.requestCommand({
      taskId: current.id,
      command: "stop",
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
    expect(() =>
      store.acceptExecutorCheckpoint({
        executionId: "execution_stop",
        generation: "generation_stop",
        checkpoint: {
          title: "Late checkpoint",
          activeGap: "Stop already owns this execution.",
          progressClaim: "This stale claim must not advance the Task.",
          unresolvedGap: "None",
          evidenceRefs: [],
        },
        callId: "late-checkpoint-after-stop",
      }),
    ).toThrow(/no longer owns Task mutation authority/u);
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
      store.requestCommand({
        taskId: current.id,
        command: "stop",
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
    createTask(store);
    createLoopExecution(store, {
      id: "execution_restart_approval",
      threadId: "thread_restart_approval",
      status: "planning",
      generation: "generation_restart_approval",
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
      status: "canceled",
      summary: expect.stringContaining("Daemon restarted"),
      pendingApproval: null,
    });
    expect(store.getExecutionApproval(approval.id)?.status).toBe("canceled");
    expect(store.getTask("task_test")).toMatchObject({
      status: "reorienting",
      currentExecutionId: null,
    });
    store.close();
    catalog.close();
  });

  it("pauses atomically after an Executor checkpoint and resumes at the Review boundary", () => {
    const { catalog, store } = createStore();
    createTask(store);
    createLoopExecution(store, {
      id: "execution_pause",
      threadId: "thread_pause",
      status: "awaiting_provider",
      generation: "generation_pause",
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
      store.acceptExecutorCheckpoint({
        executionId: "execution_pause",
        generation: "generation_pause",
        checkpoint: {
          title: "Completed checkpoint",
          activeGap: "Prove Task and Execution identities stay separate.",
          progressClaim: "The approved execution checkpoint completed.",
          unresolvedGap: "Run the independent Review after Resume.",
          evidenceRefs: ["evidence-semantic-result"],
        },
        callId: "executor-checkpoint",
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
    expect(resumed.task).toMatchObject({ status: "reorienting", pendingControl: null });
    store.close();
    catalog.close();
  });

  it("requires a durable RuntimeBundle attachment receipt for an execution", () => {
    const { catalog, store } = createStore();
    createTask(store);
    createLoopExecution(store, {
      id: "execution_bundle",
      threadId: "thread_bundle",
      status: "starting",
      generation: "generation_bundle",
      phase: "review",
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
    createTask(store);
    const context = store.getTaskContext("task_test");
    expect(context?.task.intentContract).toMatchObject({
      objective: "Prove Task and Execution identities stay separate.",
      invariants: ["No provider-specific authority"],
    });
    expect(context?.task.workingSet.activeGap).toBe(
      "Prove Task and Execution identities stay separate.",
    );
    expect(context?.decisions).toEqual([]);
    expect(context?.evidence).toEqual([]);
    const serialized = JSON.stringify(context);
    expect(serialized).not.toContain("generation");
    expect(serialized).not.toContain("providerThreadId");
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
