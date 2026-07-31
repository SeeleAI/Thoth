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
    const contexts = normalized.map((reference) => {
      const context = this.authority.getTaskContext(reference.workspaceId, reference.taskId);
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

  prepareTaskClarifyHandoff(input: {
    sourceWorkspaceId: string;
    sourceAgentId: string;
    taskWorkspaceId: string;
    taskId: string;
    taskRevision: number;
    decisionRequestId: string;
  }): PreparedTaskContext {
    const context = this.authority.getTaskContext(input.taskWorkspaceId, input.taskId);
    if (
      !context ||
      context.task.revision !== input.taskRevision ||
      context.task.sourceAgentWorkspaceId !== input.sourceWorkspaceId ||
      context.task.sourceAgentId !== input.sourceAgentId ||
      context.task.pendingDecision?.id !== input.decisionRequestId ||
      context.task.pendingDecision.kind !== "contract_change"
    ) {
      throw new WorkspaceAuthorityConflictError(
        "Task Clarify handoff no longer matches its source Agent or pending decision",
      );
    }
    return {
      references: [context.reference],
      contexts: [context],
      prompt: renderTaskContexts([context]),
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
    this.authority.forWorkspace(input.workspaceId).bindTaskContextSnapshots({
      agentId: input.agentId,
      turnId: input.turnId,
      contexts: input.prepared.contexts,
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

  latestForTurn(turnId: string): TaskContextEnvelope[] {
    return this.authority.listLatestTurnTaskContexts(turnId);
  }
}

function renderTaskContexts(contexts: TaskContextEnvelope[]): string {
  const semantic = contexts.map((context) => ({
    taskAnchor: {
      title: context.task.title,
      objective: context.task.intentContract.objective,
      nonGoals: context.task.intentContract.nonGoals,
      invariants: context.task.intentContract.invariants,
      acceptanceClaims: context.task.intentContract.acceptanceClaims.map((claim) => ({
        statement: claim.statement,
        status: claim.status,
      })),
      riskBoundary: context.task.intentContract.riskBoundary,
      escalationPolicy: context.task.intentContract.escalationPolicy,
    },
    progress: {
      status: context.task.status,
      summary: context.task.summary,
      activeGap: context.task.workingSet.activeGap,
      currentUnderstanding: context.task.workingSet.currentUnderstanding,
      currentHypothesis: context.task.workingSet.currentHypothesis,
      nextMove: context.task.workingSet.nextMove,
      rejectedRoutes: context.task.workingSet.rejectedRoutes,
      blockers: context.task.workingSet.blockers,
      currentWorkUnit:
        context.task.workUnits.find((unit) => unit.id === context.task.currentWorkUnitId) ?? null,
      latestReview: context.task.latestReview
        ? {
            decision: context.task.latestReview.decision,
            reason: context.task.latestReview.reason,
            nextFocus: context.task.latestReview.nextFocus,
          }
        : null,
    },
    evidenceIndex: context.evidence.map((evidence) => ({
      kind: evidence.kind,
      summary: evidence.summary,
      artifactRef: evidence.artifactRef,
    })),
    humanDecisionRefs: context.task.intentContract.humanDecisionRefs,
  }));
  return [
    "User-selected read-only Task context from this Workspace:",
    JSON.stringify(semantic, null, 2),
    "Use this context to answer or clarify the current request. Do not claim that foreground and background provider sessions share native context.",
  ].join("\n\n");
}
