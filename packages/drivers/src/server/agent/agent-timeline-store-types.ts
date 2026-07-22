import type {
  AgentTimelineItem,
  ProviderMessageAnchorReceipt,
  ProviderRewindScope,
} from "./agent-sdk-types.js";

export interface AgentTimelineRow {
  seq: number;
  timestamp: string;
  item: AgentTimelineItem;
}

export interface AgentTimelineCursor {
  epoch: string;
  seq: number;
}

export type AgentTimelineFetchDirection = "tail" | "before" | "after";

export interface AgentTimelineFetchOptions {
  direction?: AgentTimelineFetchDirection;
  cursor?: AgentTimelineCursor;
  /**
   * Number of canonical rows to return.
   * - undefined: store default
   * - 0: all rows in the selected window
   */
  limit?: number;
}

export interface AgentTimelineWindow {
  minSeq: number;
  maxSeq: number;
  nextSeq: number;
}

export interface AgentTimelineFetchResult {
  epoch: string;
  direction: AgentTimelineFetchDirection;
  reset: boolean;
  staleCursor: boolean;
  gap: boolean;
  window: AgentTimelineWindow;
  hasOlder: boolean;
  hasNewer: boolean;
  rows: AgentTimelineRow[];
}

export interface AgentTimelineStore {
  bindAgentWorkspace(agentId: string, workspaceId: string): void;
  appendCommitted(
    agentId: string,
    item: AgentTimelineItem,
    options?: { timestamp?: string },
  ): Promise<AgentTimelineRow>;
  fetchCommitted(
    agentId: string,
    options?: AgentTimelineFetchOptions,
  ): Promise<AgentTimelineFetchResult>;
  getLatestCommittedSeq(agentId: string): Promise<number>;
  getCommittedRows(agentId: string): Promise<AgentTimelineRow[]>;
  getLastItem(agentId: string): Promise<AgentTimelineItem | null>;
  getLastAssistantMessage(agentId: string): Promise<string | null>;
  deleteAgent(agentId: string): Promise<void>;
  bulkInsert(agentId: string, rows: readonly AgentTimelineRow[]): Promise<void>;
  getProviderMessageAnchor?(
    agentId: string,
    canonicalMessageId: string,
    scope: ProviderRewindScope,
  ): Promise<ProviderMessageAnchorReceipt | null>;
  bindProviderMessageAnchor?(
    agentId: string,
    canonicalMessageId: string,
    receipt: ProviderMessageAnchorReceipt,
    scopes: readonly ProviderRewindScope[],
  ): Promise<void>;
  truncateFromMessage?(agentId: string, canonicalMessageId: string): Promise<void>;
}
