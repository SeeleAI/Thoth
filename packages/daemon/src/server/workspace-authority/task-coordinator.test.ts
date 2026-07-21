import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { afterEach, describe, expect, it } from "vitest";
import type { ThothGoalsCardModel, ThothTaskCardModel } from "@thoth/protocol/thoth/rpc-schemas";
import { WorkspaceTaskCoordinator } from "./task-coordinator.js";
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
  return {
    workspaceId,
    manager,
    coordinator: new WorkspaceTaskCoordinator(manager, pino({ level: "silent" })),
  };
}

function taskCard(id: string): ThothTaskCardModel {
  return {
    id,
    roundLabel: "Task",
    title: `Task ${id}`,
    goal: "Register a durable Task aggregate.",
    constraints: ["Keep provider identifiers semantic"],
    acceptance: ["Every Task receives independent durable Goal identities"],
    provenanceSummary: "Approved test contract",
    submitted: true,
    submittedSummary: "Approved",
  };
}

function goalsCard(id: string): ThothGoalsCardModel {
  return {
    id,
    roundLabel: "Goals",
    title: `Goals ${id}`,
    summary: "Provider-local Goal ids may repeat across Tasks.",
    goalsCountRationale: "One Goal is sufficient for identity verification.",
    goals: [
      {
        id: "goal-1",
        order: 1,
        title: "Shared provider Goal id",
        goal: "Prove the local id is not a Workspace database key.",
        constraints: ["Preserve the approved card verbatim"],
        acceptance: ["Both Tasks register without a key collision"],
        provenance: "Approved Goals Card",
      },
    ],
    provenanceSummary: "Approved test contract",
    submitted: true,
    submittedSummary: "Approved",
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("WorkspaceTaskCoordinator", () => {
  it("maps provider-local Goal ids to independent durable identities per Task", () => {
    const { workspaceId, manager, coordinator } = createRuntime();
    const first = coordinator.register({
      workspaceId,
      sourceAgentId: "agent-visible",
      sourceTurnId: "turn-first",
      sourceGoalsCardId: "goals-first",
      mode: "quick",
      loopStrength: null,
      taskCard: taskCard("task-card-first"),
      goalsCard: goalsCard("goals-first"),
      providerProfile: { adapterId: "fixture", config: { model: "fixture" } },
    });
    const second = coordinator.register({
      workspaceId,
      sourceAgentId: "agent-visible",
      sourceTurnId: "turn-second",
      sourceGoalsCardId: "goals-second",
      mode: "loop",
      loopStrength: "light",
      taskCard: taskCard("task-card-second"),
      goalsCard: goalsCard("goals-second"),
      providerProfile: { adapterId: "fixture", config: { model: "fixture" } },
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(true);
    expect(first.task.goals[0]?.id).not.toBe("goal-1");
    expect(second.task.goals[0]?.id).not.toBe(first.task.goals[0]?.id);
    expect(
      coordinator
        .context(workspaceId, second.task.id)
        ?.blackboard.find((entry) => entry.kind === "goal_contract")?.content,
    ).toMatchObject({ goals: [{ id: "goal-1" }] });
    manager.close();
  });
});
