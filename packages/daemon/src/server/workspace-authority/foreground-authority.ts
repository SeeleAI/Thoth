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
} from "./foreground-authority-types.js";

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

  getActiveTurn(agentId: string): ForegroundTurnAuthorityRecord | null {
    return this.manager.forAgent(agentId)?.getActiveForegroundTurn(agentId) ?? null;
  }

  getTurn(turnId: string): ForegroundTurnAuthorityRecord | null {
    return this.manager.forTurn(turnId)?.getForegroundTurn(turnId) ?? null;
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

  openCard(input: {
    agentId: string;
    turnId: string;
    generation: string;
    card: ForegroundAuthorityCard;
    runtime: ForegroundAuthorityRuntimeBinding;
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
