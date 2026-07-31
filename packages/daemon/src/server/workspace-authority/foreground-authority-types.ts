import type {
  AgentThothLifecycle,
  AgentThothState,
  ThothCardAnswerPayload,
  ThothClarifyCardModel,
  ThothIntentContractCardModel,
  ThothTurnControlSnapshot,
} from "@thoth/protocol/thoth/rpc-schemas";
import type { DecisionTreeDelta } from "@thoth/protocol/clarify-authority";
import type { ProviderRunMode, ProviderRunModeReceipt } from "@thoth/protocol/provider-control";
import type { ProviderPlanCompleted } from "@thoth/protocol/agent-types";
import type { ProviderTurnInteractionState } from "@thoth/core";
import type {
  AgentMessageDeliveryMode,
  AgentQueuedTurn,
  AgentTurnQueueCommand,
} from "@thoth/protocol/agent-turn-queue";
import type { RuntimeAttachmentReceipt } from "@thoth/drivers/harness";

export type ForegroundAuthorityUpdateReason =
  | "turn_started"
  | "decision_tree_changed"
  | "card_opened"
  | "card_answered"
  | "contract_proposed"
  | "quick_exec_waiting"
  | "quick_exec_started"
  | "background_handoff"
  | "turn_completed"
  | "turn_interrupted"
  | "turn_canceled"
  | "queue_changed";

export type ForegroundAuthorityCardKind = "clarify_card" | "intent_contract_card";

export type ForegroundAuthorityCard =
  | { kind: "clarify_card"; card: ThothClarifyCardModel }
  | { kind: "intent_contract_card"; card: ThothIntentContractCardModel };

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
  providerPlanReceipt: ProviderPlanCompleted | null;
  providerInteraction: ProviderTurnInteractionState | null;
  providerInteractionRevision: number;
  runtimeAttachment: RuntimeAttachmentReceipt | null;
  sourceMessageId: string | null;
  taskId: string | null;
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
  taskClarifyHandoff?: {
    taskWorkspaceId: string;
    taskId: string;
    decisionRequestId: string;
  };
}

export interface ForegroundTaskClarifyHandoffRecord {
  turnId: string;
  taskWorkspaceId: string;
  taskId: string;
  decisionRequestId: string;
  status: "active" | "completed" | "canceled";
  createdAt: string;
  completedAt: string | null;
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
  decisionTreeDelta: DecisionTreeDelta | null;
}

export interface ForegroundQueuedSubmission {
  agentId: string;
  messageId: string;
  text: string;
  deliveryMode: AgentMessageDeliveryMode;
  attachmentCount: number;
  payload: unknown;
}

export interface ForegroundQueueCommandResult {
  accepted: boolean;
  conflict: boolean;
  duplicate: boolean;
  revision: number;
  queuedTurns: AgentQueuedTurn[];
  restoredText: string | null;
  error: string | null;
}

interface ForegroundQueueCommandBaseInput {
  agentId: string;
  queuedTurnId: string;
  expectedRevision: number;
  commandId: string;
}

export type ForegroundQueueCommandInput = ForegroundQueueCommandBaseInput &
  (
    | { command: Extract<AgentTurnQueueCommand, "edit">; text: string }
    | { command: Exclude<AgentTurnQueueCommand, "edit"> }
  );
