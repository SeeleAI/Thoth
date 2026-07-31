import type {
  AgentThothLifecycle,
  AgentThothState,
  ThothCardAnswerPayload,
} from "@thoth/protocol/thoth/rpc-schemas";
import type { ProviderRunModeReceipt } from "@thoth/protocol/provider-control";
import type { WorkspaceAuthorityManager } from "./workspace-authority-manager.js";
import type {
  AnswerForegroundCardResult,
  ForegroundAuthorityCard,
  ForegroundAuthorityRuntimeBinding,
  ForegroundAuthorityUpdateReason,
  ForegroundCardAuthorityRecord,
  ForegroundTurnAuthorityRecord,
  StartForegroundTurnInput,
  StartForegroundTurnResult,
  ForegroundQueuedSubmission,
  ForegroundQueueCommandInput,
  ForegroundQueueCommandResult,
  ForegroundTaskClarifyHandoffRecord,
} from "./foreground-authority-types.js";
import type { AgentQueuedTurn } from "@thoth/protocol/agent-turn-queue";
import type { ClarifySessionProjection } from "@thoth/protocol/clarify-authority";
import type { RuntimeAttachmentReceipt } from "@thoth/drivers/harness";
import type {
  ThothClarifyJudgeContractInput,
  ThothClarifyProposeContractInput,
  ThothClarifyUpdateMapInput,
} from "@thoth/protocol/thoth-runtime-contract";

/** Agent-scoped facade over Workspace-sharded authority stores. */
export class WorkspaceForegroundAuthority {
  constructor(private readonly manager: WorkspaceAuthorityManager) {}

  subscribe(
    subscriber: (state: AgentThothState, reason: ForegroundAuthorityUpdateReason) => void,
  ): () => void {
    return this.manager.subscribeForeground(subscriber);
  }

  startTurn(input: StartForegroundTurnInput): StartForegroundTurnResult {
    return this.manager.forWorkspace(input.workspaceId).startForegroundTurn(input);
  }

  getState(agentId: string): AgentThothState {
    return (
      this.manager.forAgent(agentId)?.getForegroundState(agentId) ?? {
        agentId,
        revision: 0,
        lifecycle: "idle",
        turn: null,
        pendingCard: null,
        backgroundTaskId: null,
        error: null,
      }
    );
  }

  getWorkspace(workspaceId: string): { id: string; canonicalPath: string } | null {
    const workspace = this.manager.catalog.getWorkspace(workspaceId);
    return workspace ? { id: workspace.id, canonicalPath: workspace.canonicalPath } : null;
  }

  getActiveTurn(agentId: string): ForegroundTurnAuthorityRecord | null {
    return this.manager.forAgent(agentId)?.getActiveForegroundTurn(agentId) ?? null;
  }

  enqueueTurn(input: ForegroundQueuedSubmission): {
    queuedTurn: AgentQueuedTurn;
    revision: number;
    created: boolean;
  } {
    const store = this.manager.forAgent(input.agentId);
    if (!store) {
      throw new Error(`Agent ${input.agentId} is not bound to a Workspace authority`);
    }
    return store.enqueueForegroundTurn(input);
  }

  peekQueue(agentId: string): { queuedTurn: AgentQueuedTurn; payload: unknown } | null {
    return this.manager.forAgent(agentId)?.peekForegroundQueue(agentId) ?? null;
  }

  removeQueuedTurn(agentId: string, queuedTurnId: string): boolean {
    return (
      this.manager.forAgent(agentId)?.removeForegroundQueuedTurn(agentId, queuedTurnId) ?? false
    );
  }

  clearQueue(agentId: string): number {
    return this.manager.forAgent(agentId)?.clearForegroundQueue(agentId) ?? 0;
  }

  commandQueue(input: ForegroundQueueCommandInput): ForegroundQueueCommandResult {
    const store = this.manager.forAgent(input.agentId);
    if (!store) {
      return {
        accepted: false,
        conflict: false,
        duplicate: false,
        revision: 0,
        queuedTurns: [],
        restoredText: null,
        error: `Agent ${input.agentId} is not bound to a Workspace authority`,
      };
    }
    return store.commandForegroundQueue(input);
  }

  getTurn(turnId: string): ForegroundTurnAuthorityRecord | null {
    return this.manager.forTurn(turnId)?.getForegroundTurn(turnId) ?? null;
  }

  getTaskClarifyHandoff(turnId: string): ForegroundTaskClarifyHandoffRecord | null {
    return this.manager.forTurn(turnId)?.getTaskClarifyHandoff(turnId) ?? null;
  }

  listTurnDecisions(turnId: string) {
    return this.manager.forTurn(turnId)?.listTurnDecisions(turnId) ?? [];
  }

  finishTaskClarifyHandoff(turnId: string, status: "completed" | "canceled"): boolean {
    const store = this.manager.forTurn(turnId);
    if (!store) throw new Error(`Foreground turn ${turnId} has no Workspace authority`);
    return store.finishTaskClarifyHandoff(turnId, status);
  }

  getTurnBySourceMessage(
    agentId: string,
    sourceMessageId: string,
  ): ForegroundTurnAuthorityRecord | null {
    return (
      this.manager.forAgent(agentId)?.getForegroundTurnBySourceMessage(agentId, sourceMessageId) ??
      null
    );
  }

  bindProviderTurn(input: {
    agentId: string;
    turnId: string;
    generation: string;
    providerTurnId: string;
  }): boolean {
    return this.manager.forAgent(input.agentId)?.bindForegroundProviderTurn(input) ?? false;
  }

  recordRunModeReceipt(input: {
    agentId: string;
    turnId: string;
    generation: string;
    receipt: ProviderRunModeReceipt;
  }): ForegroundTurnAuthorityRecord {
    const store = this.manager.forAgent(input.agentId);
    if (!store) {
      throw new Error(`Agent ${input.agentId} is not bound to a Workspace authority`);
    }
    return store.recordForegroundRunModeReceipt(input);
  }

  recordProviderInteraction(input: {
    agentId: string;
    turnId: string;
    generation: string;
    expectedRevision: number;
    interaction: import("@thoth/core").ProviderTurnInteractionState;
    planReceipt?: import("@thoth/protocol/agent-types").ProviderPlanCompleted | null;
  }): ForegroundTurnAuthorityRecord {
    const store = this.manager.forAgent(input.agentId);
    if (!store) {
      throw new Error(`Agent ${input.agentId} is not bound to a Workspace authority`);
    }
    return store.recordForegroundProviderInteraction(input);
  }

  recordRuntimeAttachment(input: {
    agentId: string;
    turnId: string;
    generation: string;
    receipt: RuntimeAttachmentReceipt;
  }): ForegroundTurnAuthorityRecord {
    const store = this.manager.forAgent(input.agentId);
    if (!store) throw new Error(`Agent ${input.agentId} is not bound to a Workspace authority`);
    return store.recordForegroundRuntimeAttachment(input);
  }

  bindTask(input: {
    agentId: string;
    turnId: string;
    generation: string;
    taskId: string;
  }): ForegroundTurnAuthorityRecord {
    const store = this.manager.forAgent(input.agentId);
    if (!store) throw new Error(`Agent ${input.agentId} is not bound to a Workspace authority`);
    return store.bindForegroundTask(input);
  }

  openCard(input: {
    agentId: string;
    turnId: string;
    generation: string;
    card: ForegroundAuthorityCard;
    runtime: ForegroundAuthorityRuntimeBinding;
    clarify?: { sessionId: string; awaitingNodeIds: string[] };
  }): { record: ForegroundCardAuthorityRecord; state: AgentThothState; created: boolean } {
    const store = this.manager.forAgent(input.agentId);
    if (!store) {
      throw new Error(`Agent ${input.agentId} is not bound to a Workspace authority`);
    }
    return store.openForegroundCard(input);
  }

  answerCard(input: {
    agentId: string;
    cardId: string;
    answer: ThothCardAnswerPayload;
    submittedCard: ForegroundAuthorityCard["card"];
    submittedSummary: string;
    expectedRevision: number;
    commandId: string;
    nextLifecycle: AgentThothLifecycle;
    actorId: string;
    clientId: string;
    deviceId?: string | null;
  }): AnswerForegroundCardResult {
    const store = this.manager.forCard(input.cardId);
    if (!store) {
      return {
        accepted: false,
        conflict: false,
        duplicate: false,
        error: "The authority card does not belong to a Workspace.",
        state: this.getState(input.agentId),
        card: null,
        turn: this.getActiveTurn(input.agentId),
      };
    }
    return store.answerForegroundCard(input);
  }

  markLifecycle(input: {
    agentId: string;
    turnId: string;
    generation: string;
    lifecycle: AgentThothLifecycle;
    reason: ForegroundAuthorityUpdateReason;
    error?: string | null;
    backgroundTaskId?: string | null;
  }): AgentThothState | null {
    return this.manager.forAgent(input.agentId)?.markForegroundLifecycle(input) ?? null;
  }

  cancelActiveTurn(input: { agentId: string; submittedSummary: string }): {
    state: AgentThothState;
    pendingCards: ForegroundCardAuthorityRecord[];
  } {
    const store = this.manager.forAgent(input.agentId);
    return store
      ? store.cancelActiveForegroundTurn(input)
      : { state: this.getState(input.agentId), pendingCards: [] };
  }

  getCard(cardId: string): ForegroundCardAuthorityRecord | null {
    return this.manager.forCard(cardId)?.getForegroundCard(cardId) ?? null;
  }

  listCardsForTurn(turnId: string): ForegroundCardAuthorityRecord[] {
    return this.manager.forTurn(turnId)?.listForegroundCardsForTurn(turnId) ?? [];
  }

  listCardsForAgent(agentId: string): ForegroundCardAuthorityRecord[] {
    return this.manager.forAgent(agentId)?.listForegroundCardsForAgent(agentId) ?? [];
  }

  listAllCards(): ForegroundCardAuthorityRecord[] {
    return this.manager.catalog
      .listWorkspaces()
      .flatMap((workspace) => this.manager.forWorkspace(workspace.id).listAllForegroundCards());
  }

  claimContinuation(input: { turnId: string; generation: string; key: string }): boolean {
    return this.manager.forTurn(input.turnId)?.claimForegroundContinuation(input) ?? false;
  }

  startClarifySession(input: {
    agentId: string;
    turnId: string;
    requestedStrength: "auto" | "light" | "balanced" | "dive";
  }): ClarifySessionProjection {
    const store = this.manager.forAgent(input.agentId);
    if (!store) throw new Error(`Agent ${input.agentId} is not bound to Workspace authority`);
    return store.startClarifySession(input);
  }

  getClarifySession(agentId: string): ClarifySessionProjection | null {
    return this.manager.forAgent(agentId)?.getLatestClarifySessionForAgent(agentId) ?? null;
  }

  updateClarifyDecisionMap(input: {
    agentId: string;
    sessionId: string;
    update: ThothClarifyUpdateMapInput;
  }): ClarifySessionProjection {
    const store = this.manager.forAgent(input.agentId);
    if (!store) throw new Error(`Agent ${input.agentId} is not bound to Workspace authority`);
    return store.updateClarifyDecisionMap(input);
  }

  applyClarifyCardDecision(input: {
    agentId: string;
    sessionId: string;
    answer: Extract<ThothCardAnswerPayload, { questionCardId: string }>;
    decisionId: string;
  }): ClarifySessionProjection {
    const store = this.manager.forAgent(input.agentId);
    if (!store) throw new Error(`Agent ${input.agentId} is not bound to Workspace authority`);
    return store.applyClarifyCardDecision(input);
  }

  proposeIntentContract(input: {
    agentId: string;
    sessionId: string;
    proposal: ThothClarifyProposeContractInput;
  }): ClarifySessionProjection {
    const store = this.manager.forAgent(input.agentId);
    if (!store) throw new Error(`Agent ${input.agentId} is not bound to Workspace authority`);
    return store.proposeIntentContract(input);
  }

  applyClarifyChallenge(input: {
    agentId: string;
    sessionId: string;
    result: ThothClarifyJudgeContractInput;
  }): ClarifySessionProjection {
    const store = this.manager.forAgent(input.agentId);
    if (!store) throw new Error(`Agent ${input.agentId} is not bound to Workspace authority`);
    return store.applyClarifyChallenge(input);
  }

  confirmIntentContract(agentId: string, sessionId: string): ClarifySessionProjection {
    const store = this.manager.forAgent(agentId);
    if (!store) throw new Error(`Agent ${agentId} is not bound to Workspace authority`);
    return store.confirmIntentContract(sessionId);
  }

  reopenIntentContract(agentId: string, sessionId: string): ClarifySessionProjection {
    const store = this.manager.forAgent(agentId);
    if (!store) throw new Error(`Agent ${agentId} is not bound to Workspace authority`);
    return store.reopenIntentContract(sessionId);
  }

  prioritizeClarifyNode(input: {
    agentId: string;
    sessionId: string;
    nodeId: string;
    expectedRevision: number;
    commandId: string;
  }): { session: ClarifySessionProjection; duplicate: boolean } {
    const store = this.manager.forAgent(input.agentId);
    if (!store) throw new Error(`Agent ${input.agentId} is not bound to Workspace authority`);
    return store.prioritizeClarifyNode(input);
  }
}

export type {
  AnswerForegroundCardResult,
  ForegroundAuthorityCard,
  ForegroundAuthorityRuntimeBinding,
  ForegroundAuthorityUpdateReason,
  ForegroundCardAuthorityRecord,
  ForegroundTurnAuthorityRecord,
  StartForegroundTurnInput,
  StartForegroundTurnResult,
} from "./foreground-authority-types.js";
