import type { TaskContextEnvelope, TaskContextReference } from "@thoth/protocol/task-authority";
import type { WorkspaceAuthorityManager } from "./workspace-authority-manager.js";
import { WorkspaceAuthorityConflictError } from "./workspace-authority-store.js";

export interface PreparedTaskContext {
  references: TaskContextReference[];
  contexts: TaskContextEnvelope[];
  prompt: string | null;
}

/**
 * Resolves user-selected Task references without merging provider threads. The
 * provider receives semantic Task truth; identity and revision stay in the
 * durable turn binding owned by the daemon.
 */
export class TaskContextBroker {
  constructor(private readonly authority: WorkspaceAuthorityManager) {}

  prepare(workspaceId: string, references: TaskContextReference[]): PreparedTaskContext {
    const unique = new Map<string, TaskContextReference>();
    for (const reference of references) {
      if (reference.workspaceId !== workspaceId) {
        throw new Error(`Task ${reference.taskId} cannot cross Workspace authority`);
      }
      const previous = unique.get(reference.taskId);
      if (previous && previous.revision !== reference.revision) {
        throw new WorkspaceAuthorityConflictError(
          `Task ${reference.taskId} was referenced at two different revisions`,
        );
      }
      unique.set(reference.taskId, reference);
    }
    const normalized = [...unique.values()];
    const store = this.authority.forWorkspace(workspaceId);
    const contexts = normalized.map((reference) => {
      const context = store.getTaskContext(reference.taskId);
      if (!context) {
        throw new Error(`Task ${reference.taskId} does not exist in Workspace ${workspaceId}`);
      }
      if (context.task.revision !== reference.revision) {
        throw new WorkspaceAuthorityConflictError(
          `Task ${reference.taskId} revision changed from ${reference.revision} to ${context.task.revision}`,
        );
      }
      return context;
    });
    return {
      references: normalized,
      contexts,
      prompt: contexts.length > 0 ? renderTaskContexts(contexts) : null,
    };
  }

  bindTurn(input: {
    workspaceId: string;
    agentId: string;
    turnId: string;
    prepared: PreparedTaskContext;
  }): void {
    if (input.prepared.references.length === 0) {
      return;
    }
    this.authority.forWorkspace(input.workspaceId).bindTaskContexts({
      agentId: input.agentId,
      turnId: input.turnId,
      references: input.prepared.references,
    });
  }

  renderTurn(turnId: string): string | null {
    const store = this.authority.forTurn(turnId);
    if (!store) {
      return null;
    }
    const contexts = store.listTurnTaskContexts(turnId);
    return contexts.length > 0 ? renderTaskContexts(contexts) : null;
  }
}

function renderTaskContexts(contexts: TaskContextEnvelope[]): string {
  const semantic = contexts.map((context) => ({
    task: {
      title: context.task.title,
      mode: context.task.mode,
      status: context.task.status,
      summary: context.task.summary,
      goal: context.task.goal,
      constraints: context.task.constraints,
      acceptance: context.task.acceptance,
      currentGoal:
        context.task.goals.find((goal) => goal.id === context.task.currentGoalId) ?? null,
      goals: context.task.goals.map((goal) => ({
        order: goal.order,
        title: goal.title,
        goal: goal.goal,
        constraints: goal.constraints,
        acceptance: goal.acceptance,
        status: goal.status,
      })),
      latestReviewDirection: context.task.latestReviewDirection,
    },
    humanDecisions: context.decisions.map((decision) => ({
      kind: decision.kind,
      answer: decision.rawAnswer,
      normalized: decision.normalized,
      decidedAt: decision.decidedAt,
    })),
    blackboard: context.blackboard.map((entry) => ({
      kind: entry.kind,
      producer: entry.producer,
      content: entry.content,
      createdAt: entry.createdAt,
    })),
  }));
  return [
    "User-selected read-only Task context from this Workspace:",
    JSON.stringify(semantic, null, 2),
    "Use this context to answer or clarify the current request. Do not claim that foreground and background provider sessions share native context.",
  ].join("\n\n");
}
