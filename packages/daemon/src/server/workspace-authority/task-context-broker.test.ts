import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { TaskProjection } from "@thoth/protocol/task-authority";
import { createTaskAuthority } from "@thoth/core";
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
  const now = "2026-07-21T00:00:00.000Z";
  const store = manager.forWorkspace(workspaceId);
  store.upsertAgentRecord({
    id: "agent-visible",
    provider: "fixture",
    cwd: manager.catalog.getWorkspace(workspaceId)!.canonicalPath,
    workspaceId,
    createdAt: now,
    updatedAt: now,
    labels: {},
    lastStatus: "idle",
    providerRunMode: "default",
    providerControlRevision: 0,
  });
  const task = createTaskAuthority({
    id: taskId,
    workspaceId,
    sourceAgentWorkspaceId: workspaceId,
    sourceAgentId: "agent-visible",
    mode: "loop",
    intentContract: {
      id: `intent-contract-${taskId}`,
      workspaceId,
      sourceAgentId: "agent-visible",
      taskId: null,
      title: `Task ${taskId}`,
      objective: "Expose semantic background progress to an explicitly bound foreground turn.",
      nonGoals: [],
      invariants: ["Remain inside one Workspace", "Keep Provider threads separate"],
      acceptanceClaims: [
        {
          id: `claim-${taskId}`,
          statement: "The selected Task revision is frozen for the foreground turn.",
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
    strength: "single",
    now,
  });
  return store.registerTask({
    task,
    sourceTurnId: `source-turn-${taskId}`,
    sourceContractCardId: `source-contract-card-${taskId}`,
    providerProfileId: "provider-profile-test",
  }).task;
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
