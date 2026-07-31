import type {
  ThothClarifyCardModel,
  ThothIntentContractCardModel,
} from "@thoth/protocol/thoth/rpc-schemas";
import type {
  ForegroundAuthorityCard,
  WorkspaceForegroundAuthority,
} from "../workspace-authority/foreground-authority.js";

export type RuntimeAuthorityCardKind = "clarify_card" | "intent_contract_card" | "blocked_card";

export type RuntimeAuthorityDecisionStatus = "pending" | "answered" | "rejected" | "blocked";

export type RuntimeAuthorityCard =
  | { kind: "clarify_card"; card: ThothClarifyCardModel }
  | { kind: "intent_contract_card"; card: ThothIntentContractCardModel }
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
}

function toStoreCard(card: RuntimeAuthorityCard): ForegroundAuthorityCard {
  if (card.kind === "blocked_card") {
    throw new Error("Blocked reports do not create user authority cards.");
  }
  return card;
}

function fromStoreRecord(
  store: WorkspaceForegroundAuthority,
  cardId: string,
): RuntimeAuthorityDecisionRecord | null {
  const card = store.getCard(cardId);
  const turn = card ? store.getTurn(card.turnId) : null;
  if (!card || !turn) return null;
  const authorityCard: RuntimeAuthorityCard =
    card.kind === "clarify_card"
      ? { kind: "clarify_card", card: card.card as ThothClarifyCardModel }
      : {
          kind: "intent_contract_card",
          card: card.card as ThothIntentContractCardModel,
        };
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
  store: WorkspaceForegroundAuthority;
  provider: string;
  agentId: string;
  threadId: string;
  providerTurnId: string;
  callId: string;
  toolName: string;
  card: RuntimeAuthorityCard;
  redactedRawInputHash: string;
  publicBadgeSummary?: string;
}): { record: RuntimeAuthorityDecisionRecord } {
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
    ...(input.card.kind === "clarify_card"
      ? {
          decisionSession: {
            sessionId: input.card.card.sessionId,
            awaitingNodeIds: input.card.card.card.questions.map((question) => question.nodeId),
          },
        }
      : {}),
  });
  const projected = fromStoreRecord(input.store, opened.record.id);
  if (!projected) {
    throw new Error(`Failed to project foreground authority card ${opened.record.id}.`);
  }
  return {
    record: {
      ...projected,
      cardKind: input.card.kind,
      authorityCard: input.card,
      ...(input.publicBadgeSummary ? { publicBadgeSummary: input.publicBadgeSummary } : {}),
    },
  };
}

export function listRuntimeAuthorityDecisionRecords(
  store: WorkspaceForegroundAuthority,
): RuntimeAuthorityDecisionRecord[] {
  return store
    .listAllCards()
    .flatMap((card) => (fromStoreRecord(store, card.id) ? [fromStoreRecord(store, card.id)!] : []));
}

export function listRuntimeAuthorityDecisionRecordsForAgent(
  store: WorkspaceForegroundAuthority,
  agentId: string,
): RuntimeAuthorityDecisionRecord[] {
  return store
    .listCardsForAgent(agentId)
    .flatMap((card) => (fromStoreRecord(store, card.id) ? [fromStoreRecord(store, card.id)!] : []));
}

export function getLatestRuntimeIntentContractCardForAgent(
  store: WorkspaceForegroundAuthority,
  agentId: string,
): ThothIntentContractCardModel | null {
  return (
    (store
      .listCardsForAgent(agentId)
      .filter((record) => record.kind === "intent_contract_card")
      .at(-1)?.card as ThothIntentContractCardModel | undefined) ?? null
  );
}
