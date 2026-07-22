import type {
  AgentThothLifecycle,
  AgentThothState,
  ThothApprovalGoalCardModel,
  ThothCardAnswerPayload,
  ThothClarifyCardModel,
  ThothTaskCardModel,
  ThothTurnControlSnapshot,
} from "@thoth/protocol/thoth/rpc-schemas";
import type { ProviderRunMode, ProviderRunModeReceipt } from "@thoth/protocol/provider-control";

export type ForegroundAuthorityUpdateReason =
  | "turn_started"
  | "card_opened"
  | "card_answered"
  | "quick_exec_started"
  | "background_handoff"
  | "turn_completed"
  | "turn_interrupted"
  | "turn_canceled";

export type ForegroundAuthorityCardKind = "clarify_card" | "task_card" | "goal_card";

export type ForegroundAuthorityCard =
  | { kind: "clarify_card"; card: ThothClarifyCardModel }
  | { kind: "task_card"; card: ThothTaskCardModel }
  | { kind: "goal_card"; card: ThothApprovalGoalCardModel };

export interface ForegroundAuthorityRuntimeBinding {
  provider: string;
  threadId: string;
  providerTurnId: string;
  callId: string;
  toolName: string;
  redactedRawInputHash: string;
}

export interface ForegroundTurnAuthorityRecord {
  id: string;
  agentId: string;
  generation: string;
  kind: "raw" | "thoth";
  lifecycle: AgentThothLifecycle;
  controls: ThothTurnControlSnapshot | null;
  providerRunMode: ProviderRunMode;
  providerRunModeReceipt: ProviderRunModeReceipt | null;
  sourceMessageId: string | null;
  workspaceId: string;
  workspacePath: string;
  userText: string;
  providerTurnId: string | null;
  backgroundTaskId: string | null;
  error: string | null;
  startedAt: string;
  updatedAt: string;
}

export interface ForegroundCardAuthorityRecord {
  id: string;
  turnId: string;
  agentId: string;
  kind: ForegroundAuthorityCardKind;
  status: "pending" | "answered" | "canceled" | "blocked";
  card: ForegroundAuthorityCard["card"];
  answer: ThothCardAnswerPayload | null;
  submittedSummary: string | null;
  runtime: ForegroundAuthorityRuntimeBinding;
  createdAt: string;
  updatedAt: string;
}

export interface StartForegroundTurnInput {
  agentId: string;
  kind: "raw" | "thoth";
  controls?: ThothTurnControlSnapshot;
  providerRunMode: ProviderRunMode;
  sourceMessageId?: string;
  workspaceId: string;
  workspacePath: string;
  userText: string;
}

export interface StartForegroundTurnResult {
  turn: ForegroundTurnAuthorityRecord;
  state: AgentThothState;
  created: boolean;
}

export interface AnswerForegroundCardResult {
  accepted: boolean;
  conflict: boolean;
  duplicate: boolean;
  error: string | null;
  state: AgentThothState;
  card: ForegroundCardAuthorityRecord | null;
  turn: ForegroundTurnAuthorityRecord | null;
}
