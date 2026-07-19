import type {
  ClarifyConvergenceReview,
  ClarifyDecisionDelta,
  ClarifyFrontierLedger,
} from "@thoth/protocol/thoth-runtime-contract";
import type {
  ThothApprovalGoalCardModel,
  ThothClarifyCardModel,
  ThothTaskCardModel,
} from "@thoth/protocol/thoth/rpc-schemas";
import type {
  ForegroundAuthorityCard,
  ForegroundAuthorityStore,
} from "./foreground-authority-store.js";

export type RuntimeAuthorityCardKind = "clarify_card" | "task_card" | "goals_card" | "blocked_card";

export type RuntimeAuthorityDecisionStatus = "pending" | "answered" | "rejected" | "blocked";

export type RuntimeAuthorityCard =
  | { kind: "clarify_card"; card: ThothClarifyCardModel }
  | { kind: "task_card"; card: ThothTaskCardModel }
  | { kind: "goals_card"; card: ThothApprovalGoalCardModel }
  | { kind: "blocked_card"; title: string; reason: string };

export interface RuntimeAuthorityDecisionRecord {
  id: string;
  provider: string;
  agentId: string;
  foregroundTurnId: string;
  executionGeneration: string;
  threadId: string;
  providerTurnId: string;
  callId: string;
  toolName: string;
  cardKind: RuntimeAuthorityCardKind;
  cardId: string;
  status: RuntimeAuthorityDecisionStatus;
  createdAt: string;
  updatedAt: string;
  redactedRawInputHash: string;
  authorityCard: RuntimeAuthorityCard;
  publicBadgeSummary?: string;
  frontierLedger?: ClarifyFrontierLedger;
  decisionDelta?: ClarifyDecisionDelta;
  convergenceReview?: ClarifyConvergenceReview;
}

function toStoreCard(card: RuntimeAuthorityCard): ForegroundAuthorityCard {
  if (card.kind === "clarify_card" || card.kind === "task_card") {
    return card;
  }
  if (card.kind === "goals_card") {
    return { kind: "goal_card", card: card.card };
  }
  throw new Error("Blocked reports do not create user authority cards.");
}

function fromStoreRecord(
  store: ForegroundAuthorityStore,
  cardId: string,
): RuntimeAuthorityDecisionRecord | null {
  const card = store.getCard(cardId);
  const turn = card ? store.getTurn(card.turnId) : null;
  if (!card || !turn) {
    return null;
  }
  const authorityCard: RuntimeAuthorityCard =
    card.kind === "clarify_card"
      ? { kind: "clarify_card", card: card.card as ThothClarifyCardModel }
      : card.kind === "task_card"
        ? { kind: "task_card", card: card.card as ThothTaskCardModel }
        : { kind: "goals_card", card: card.card as ThothApprovalGoalCardModel };
  return {
    id: `runtime-decision-${card.id}`,
    provider: card.runtime.provider,
    agentId: card.agentId,
    foregroundTurnId: card.turnId,
    executionGeneration: turn.generation,
    threadId: card.runtime.threadId,
    providerTurnId: card.runtime.providerTurnId,
    callId: card.runtime.callId,
    toolName: card.runtime.toolName,
    cardKind: authorityCard.kind,
    cardId: card.id,
    status:
      card.status === "pending"
        ? "pending"
        : card.status === "answered"
          ? "answered"
          : card.status === "blocked"
            ? "blocked"
            : "rejected",
    createdAt: card.createdAt,
    updatedAt: card.updatedAt,
    redactedRawInputHash: card.runtime.redactedRawInputHash,
    authorityCard,
  };
}

export function createRuntimeAuthorityDecision(input: {
  store: ForegroundAuthorityStore;
  provider: string;
  agentId: string;
  threadId: string;
  providerTurnId: string;
  callId: string;
  toolName: string;
  card: RuntimeAuthorityCard;
  redactedRawInputHash: string;
  publicBadgeSummary?: string;
  frontierLedger?: ClarifyFrontierLedger;
  decisionDelta?: ClarifyDecisionDelta;
  convergenceReview?: ClarifyConvergenceReview;
}): {
  record: RuntimeAuthorityDecisionRecord;
} {
  const turn = input.store.getActiveTurn(input.agentId);
  if (!turn || turn.kind !== "thoth") {
    throw new Error("No active Agent-scoped Thoth turn owns this authority card.");
  }
  const opened = input.store.openCard({
    agentId: input.agentId,
    turnId: turn.id,
    generation: turn.generation,
    card: toStoreCard(input.card),
    runtime: {
      provider: input.provider,
      threadId: input.threadId,
      providerTurnId: input.providerTurnId,
      callId: input.callId,
      toolName: input.toolName,
      redactedRawInputHash: input.redactedRawInputHash,
    },
  });
  const base = fromStoreRecord(input.store, opened.record.id);
  if (!base) {
    throw new Error(`Failed to project foreground authority card ${opened.record.id}.`);
  }
  const record: RuntimeAuthorityDecisionRecord = {
    ...base,
    cardKind: input.card.kind,
    authorityCard: input.card,
    ...(input.publicBadgeSummary ? { publicBadgeSummary: input.publicBadgeSummary } : {}),
    ...(input.frontierLedger ? { frontierLedger: input.frontierLedger } : {}),
    ...(input.decisionDelta ? { decisionDelta: input.decisionDelta } : {}),
    ...(input.convergenceReview ? { convergenceReview: input.convergenceReview } : {}),
  };
  return { record };
}

export function listRuntimeAuthorityDecisionRecords(
  store: ForegroundAuthorityStore,
): RuntimeAuthorityDecisionRecord[] {
  return store
    .listAllCards()
    .flatMap((card) => (fromStoreRecord(store, card.id) ? [fromStoreRecord(store, card.id)!] : []));
}

export function listRuntimeAuthorityDecisionRecordsForAgent(
  store: ForegroundAuthorityStore,
  agentId: string,
): RuntimeAuthorityDecisionRecord[] {
  return store
    .listCardsForAgent(agentId)
    .flatMap((card) => (fromStoreRecord(store, card.id) ? [fromStoreRecord(store, card.id)!] : []));
}

export function getLatestRuntimeTaskCardForAgent(
  store: ForegroundAuthorityStore,
  agentId: string,
): ThothTaskCardModel | null {
  return (
    (store
      .listCardsForAgent(agentId)
      .filter((record) => record.kind === "task_card")
      .at(-1)?.card as ThothTaskCardModel | undefined) ?? null
  );
}
