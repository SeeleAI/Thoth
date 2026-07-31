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
  const session = input.store.startClarifySession({
    agentId,
    turnId: started.turn.id,
    requestedStrength: "light",
  });
  input.store.updateClarifyDecisionMap({
    sessionId: session.id,
    update: {
      effectiveStrength: "light",
      publicSummary: "The objective and acceptance boundary are grounded.",
      nodes: [
        {
          id: "schedule-objective",
          parentIds: [],
          title: "Scheduled objective",
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
    sessionId: session.id,
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
  input.store.applyClarifyChallenge({
    sessionId: proposed.id,
    result: {
      decision: "stable",
      reason: "The objective, invariant, and acceptance boundary are explicit.",
      missingNodes: [],
    },
  });
  const confirmed = input.store.confirmIntentContract(proposed.id);
  if (!confirmed.intentContract) throw new Error("Confirmed Intent Contract fixture is missing");
  input.store.markForegroundLifecycle({
    agentId,
    turnId: started.turn.id,
    generation: started.turn.generation,
    lifecycle: "done",
    reason: "turn_completed",
    error: null,
  });
  return confirmed.intentContract;
}
