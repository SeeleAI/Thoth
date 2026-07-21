import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { TaskProjection } from "@thoth/protocol/task-authority";
import { WorkspaceForegroundAuthority } from "./foreground-authority.js";
import { TaskContextBroker } from "./task-context-broker.js";
import { WorkspaceAuthorityManager } from "./workspace-authority-manager.js";
import { WorkspaceAuthorityConflictError } from "./workspace-authority-store.js";

const roots: string[] = [];

function createRuntime() {
  const root = mkdtempSync(path.join(tmpdir(), "thoth-task-context-broker-"));
  roots.push(root);
  const manager = new WorkspaceAuthorityManager(root);
  for (const workspaceId of ["workspace-a", "workspace-b"]) {
    manager.catalog.upsertWorkspace({
      id: workspaceId,
      canonicalPath: path.join(root, workspaceId),
      displayName: workspaceId,
      kind: "workspace",
      parentWorkspaceId: null,
      archivedAt: null,
      createdAt: "2026-07-21T00:00:00.000Z",
      updatedAt: "2026-07-21T00:00:00.000Z",
    });
  }
  return { manager, broker: new TaskContextBroker(manager) };
}

function createTask(
  manager: WorkspaceAuthorityManager,
  workspaceId: string,
  taskId: string,
): TaskProjection {
  const task: TaskProjection = {
    id: taskId,
    workspaceId,
    sourceAgentId: "agent-visible",
    mode: "loop",
    title: `Task ${taskId}`,
    goal: "Expose semantic background progress to an explicitly bound foreground turn.",
    constraints: ["Remain inside one Workspace"],
    acceptance: ["The selected revision is frozen for the turn"],
    status: "queued",
    summary: "Queued",
    currentGoalId: `goal-${taskId}`,
    currentExecutionId: null,
    goals: [
      {
        id: `goal-${taskId}`,
        order: 1,
        title: "Verify the binding",
        goal: "Keep foreground and background provider threads separate.",
        constraints: ["Use Task Blackboard only"],
        acceptance: ["No provider-session merge"],
        status: "queued",
        revision: 0,
      },
    ],
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
    createdAt: "2026-07-21T00:00:00.000Z",
    updatedAt: "2026-07-21T00:00:00.000Z",
  };
  return manager.forWorkspace(workspaceId).createTask(task, manager.catalog);
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("TaskContextBroker", () => {
  it("freezes the selected Task revision while a readonly progress query can read the latest projection", () => {
    const { manager, broker } = createRuntime();
    const task = createTask(manager, "workspace-a", "task-a");
    const turn = new WorkspaceForegroundAuthority(manager).startTurn({
      agentId: "agent-visible",
      kind: "raw",
      sourceMessageId: "message-a",
      workspaceId: "workspace-a",
      workspacePath: path.join(manager.catalog.getWorkspace("workspace-a")!.canonicalPath),
      userText: "Summarize @Task progress",
    }).turn;
    const prepared = broker.prepare("workspace-a", [
      { kind: "task", workspaceId: "workspace-a", taskId: task.id, revision: task.revision },
    ]);
    broker.bindTurn({
      workspaceId: "workspace-a",
      agentId: "agent-visible",
      turnId: turn.id,
      prepared,
    });

    const store = manager.forWorkspace("workspace-a");
    store.requestCommand({
      taskId: task.id,
      command: "pause",
      expectedRevision: task.revision,
      commandId: "pause-after-binding",
      actorId: "human",
      clientId: "desktop",
    });

    expect(store.listTurnTaskContexts(turn.id)[0]?.task).toMatchObject({
      revision: 1,
      status: "queued",
    });
    expect(store.listLatestTurnTaskContexts(turn.id)[0]?.task).toMatchObject({
      revision: 2,
      status: "paused",
    });
    expect(broker.renderTurn(turn.id)).toContain('"status": "queued"');
    manager.close();
  });

  it("rejects stale revisions, cross-Workspace references, and conflicting duplicate references", () => {
    const { manager, broker } = createRuntime();
    const task = createTask(manager, "workspace-a", "task-a");
    manager.forWorkspace("workspace-a").requestCommand({
      taskId: task.id,
      command: "pause",
      expectedRevision: task.revision,
      commandId: "pause-before-binding",
      actorId: "human",
      clientId: "desktop",
    });

    expect(() =>
      broker.prepare("workspace-a", [
        { kind: "task", workspaceId: "workspace-a", taskId: task.id, revision: 1 },
      ]),
    ).toThrow(WorkspaceAuthorityConflictError);
    expect(() =>
      broker.prepare("workspace-a", [
        { kind: "task", workspaceId: "workspace-b", taskId: task.id, revision: 2 },
      ]),
    ).toThrow("cannot cross Workspace authority");
    expect(() =>
      broker.prepare("workspace-a", [
        { kind: "task", workspaceId: "workspace-a", taskId: task.id, revision: 1 },
        { kind: "task", workspaceId: "workspace-a", taskId: task.id, revision: 2 },
      ]),
    ).toThrow("two different revisions");
    manager.close();
  });
});
