import type { IntentContractProjection } from "@thoth/protocol/intent-contract";
import type { WorkspaceAuthorityStore } from "../workspace-authority/workspace-authority-store.js";

export function seedConfirmedIntentContract(input: {
  store: WorkspaceAuthorityStore;
  workspaceId: string;
  agentId?: string;
  sourceMessageId?: string;
  title?: string;
  objective?: string;
}): IntentContractProjection {
  const agentId = input.agentId ?? "agent-contract-fixture";
  const started = input.store.startForegroundTurn({
    agentId,
    kind: "thoth",
    controls: { mode: "quick", clarifyStrength: "light", loop: null },
    sourceMessageId: input.sourceMessageId ?? `message-contract-${agentId}`,
    workspaceId: input.workspaceId,
    workspacePath: "/workspace",
    userText: input.objective ?? "Execute the scheduled task against its confirmed intent.",
  });
  const tree = input.store.startDecisionSession({
    agentId,
    turnId: started.turn.id,
    requestedStrength: "light",
  });
  input.store.updateDecisionTree({
    sessionId: tree.session.id,
    update: {
      effectiveStrength: "light",
      activity: "investigating",
      activeNodeId: "schedule-objective",
      publicSummary: "The objective and acceptance boundary are grounded.",
      nodes: [
        {
          id: "schedule-objective",
          parentId: tree.session.rootNodeId,
          crossLinkIds: [],
          title: "Scheduled objective",
          summary: "The scheduled objective and acceptance boundary are grounded.",
          owner: "agent",
          materiality: "structural",
          status: "resolved",
          resolutionRef: "fixture:confirmed-objective",
          sourceRefs: [],
        },
      ],
    },
  });
  const proposed = input.store.proposeIntentContract({
    sessionId: tree.session.id,
    proposal: {
      contract: {
        title: input.title ?? "Confirmed schedule template",
        objective: input.objective ?? "Execute the scheduled task and preserve durable evidence.",
        nonGoals: [],
        invariants: ["Remain inside the owning Workspace."],
        acceptance: ["The scheduled execution records a durable terminal result."],
        riskBoundary: [],
        humanDecisionRefs: [],
        escalationPolicy: { returnToHumanWhen: [], finalConfirmation: "automatic" },
      },
      decisionNodeRefs: ["schedule-objective"],
      publicSummary: "A stable schedule template is ready for independent challenge.",
    },
  });
  input.store.applyDecisionTreeChallenge({
    sessionId: proposed.session.id,
    result: {
      decision: "stable",
      reason: "The objective, invariant, and acceptance boundary are explicit.",
      missingNodes: [],
    },
  });
  const confirmed = input.store.confirmIntentContract(proposed.session.id);
  if (!confirmed.session.intentContract) {
    throw new Error("Confirmed Intent Contract fixture is missing");
  }
  input.store.markForegroundLifecycle({
    agentId,
    turnId: started.turn.id,
    generation: started.turn.generation,
    lifecycle: "done",
    reason: "turn_completed",
    error: null,
  });
  return confirmed.session.intentContract;
}
