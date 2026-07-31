import {
  AgentThothStateSchema,
  ThothClarifyCardModelSchema,
  ThothIntentContractCardModelSchema,
  ThothTurnControlSnapshotSchema,
  type AgentThothLifecycle,
  type AgentThothPendingCard,
  type AgentThothState,
  type AgentThothTurn,
} from "@thoth/protocol/thoth/rpc-schemas";
import {
  ProviderRunModeReceiptSchema,
  ProviderRunModeSchema,
} from "@thoth/protocol/provider-control";

export interface ForegroundAgentAuthorityRow {
  agent_id: string;
  authority_revision: number;
  active_turn_id: string | null;
  thoth_lifecycle: AgentThothLifecycle;
  background_task_id: string | null;
  error: string | null;
}

export interface ForegroundTurnRow {
  turn_id: string;
  agent_id: string;
  turn_kind: "raw" | "thoth";
  status: AgentThothLifecycle;
  controls_json: string | null;
  provider_run_mode: string;
  provider_mode_receipt_json: string | null;
  source_message_id: string | null;
  background_task_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface ForegroundCardRow {
  card_id: string;
  kind: "clarify_card" | "intent_contract_card";
  displayed_digest: string;
  created_at: string;
}

function parseTurn(row: ForegroundTurnRow | null): AgentThothTurn | null {
  if (!row) {
    return null;
  }
  const controls = row.controls_json
    ? ThothTurnControlSnapshotSchema.parse(JSON.parse(row.controls_json) as unknown)
    : undefined;
  return {
    id: row.turn_id,
    agentId: row.agent_id,
    kind: row.turn_kind,
    lifecycle: row.status,
    ...(controls ? { controls } : {}),
    providerRunMode: ProviderRunModeSchema.parse(row.provider_run_mode ?? "default"),
    ...(row.provider_mode_receipt_json
      ? {
          providerRunModeReceipt: ProviderRunModeReceiptSchema.parse(
            JSON.parse(row.provider_mode_receipt_json) as unknown,
          ),
        }
      : {}),
    ...(row.source_message_id ? { sourceMessageId: row.source_message_id } : {}),
    ...(row.background_task_id ? { backgroundTaskId: row.background_task_id } : {}),
    ...(row.error ? { error: row.error } : {}),
    startedAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parsePendingCard(
  row: ForegroundCardRow | null,
  readBlob: (digest: string) => unknown,
): AgentThothPendingCard | null {
  if (!row) {
    return null;
  }
  const raw = readBlob(row.displayed_digest);
  if (row.kind === "clarify_card") {
    return {
      kind: row.kind,
      card: ThothClarifyCardModelSchema.parse(raw),
      createdAt: row.created_at,
    };
  }
  return {
    kind: row.kind,
    card: ThothIntentContractCardModelSchema.parse(raw),
    createdAt: row.created_at,
  };
}

export class WorkspaceForegroundProjection {
  static empty(agentId: string): AgentThothState {
    return {
      agentId,
      revision: 0,
      lifecycle: "idle",
      turn: null,
      pendingCard: null,
      backgroundTaskId: null,
      error: null,
    };
  }

  static build(input: {
    authority: ForegroundAgentAuthorityRow | null;
    turn: ForegroundTurnRow | null;
    pendingCard: ForegroundCardRow | null;
    agentId: string;
    readBlob: (digest: string) => unknown;
  }): AgentThothState {
    if (!input.authority) {
      return this.empty(input.agentId);
    }
    return AgentThothStateSchema.parse({
      agentId: input.authority.agent_id,
      revision: input.authority.authority_revision,
      lifecycle: input.authority.thoth_lifecycle,
      turn: parseTurn(input.turn),
      pendingCard: parsePendingCard(input.pendingCard, input.readBlob),
      backgroundTaskId: input.authority.background_task_id,
      error: input.authority.error,
    });
  }
}
