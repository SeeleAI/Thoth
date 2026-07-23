import { randomUUID } from "node:crypto";
import { InMemoryAgentTimelineStore } from "../agent/agent-timeline-store.js";
import type {
  AgentTimelineFetchOptions,
  AgentTimelineFetchResult,
  AgentTimelineRow,
  AgentTimelineStore,
} from "@thoth/drivers/internal/server/agent/agent-timeline-store-types";
import type {
  AgentTimelineItem,
  ProviderMessageAnchorReceipt,
  ProviderRewindScope,
} from "@thoth/drivers/agent-runtime";
import type { WorkspaceAuthorityManager } from "./workspace-authority-manager.js";
import type { WorkspaceAuthorityStore } from "./workspace-authority-store.js";

/** Visible Agent timeline journal sharded with its owning Workspace authority. */
export class WorkspaceAgentTimelineStore implements AgentTimelineStore {
  private readonly workspaceByAgent = new Map<string, string>();

  constructor(private readonly authority: WorkspaceAuthorityManager) {}

  bindAgentWorkspace(agentId: string, workspaceId: string): void {
    this.workspaceByAgent.set(agentId, workspaceId);
  }

  async appendCommitted(
    agentId: string,
    item: AgentTimelineItem,
    options?: { timestamp?: string },
  ): Promise<AgentTimelineRow> {
    const store = this.store(agentId);
    const meta = store.getAgentTimelineMeta(agentId);
    const row = {
      seq: meta?.nextSeq ?? 1,
      timestamp: options?.timestamp ?? new Date().toISOString(),
      item,
    };
    store.appendAgentTimelineRows(agentId, [row]);
    return row;
  }

  async fetchCommitted(
    agentId: string,
    options?: AgentTimelineFetchOptions,
  ): Promise<AgentTimelineFetchResult> {
    const store = this.store(agentId);
    const meta = store.getAgentTimelineMeta(agentId);
    const memory = new InMemoryAgentTimelineStore();
    memory.initialize(agentId, {
      epoch: meta?.epoch ?? randomUUID(),
      nextSeq: meta?.nextSeq ?? 1,
      rows: store.listAgentTimelineRows(agentId),
    });
    return memory.fetch(agentId, options);
  }

  async getLatestCommittedSeq(agentId: string): Promise<number> {
    const meta = this.store(agentId).getAgentTimelineMeta(agentId);
    return meta ? Math.max(0, meta.nextSeq - 1) : 0;
  }

  async getCommittedRows(agentId: string): Promise<AgentTimelineRow[]> {
    return this.store(agentId).listAgentTimelineRows(agentId);
  }

  async getLastItem(agentId: string): Promise<AgentTimelineItem | null> {
    return (await this.getCommittedRows(agentId)).at(-1)?.item ?? null;
  }

  async getLastAssistantMessage(agentId: string): Promise<string | null> {
    const rows = await this.getCommittedRows(agentId);
    const chunks: string[] = [];
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const item = rows[index]?.item;
      if (item?.type !== "assistant_message") {
        if (chunks.length > 0) break;
        continue;
      }
      chunks.push(item.text);
    }
    return chunks.length > 0 ? chunks.toReversed().join("") : null;
  }

  async deleteAgent(agentId: string): Promise<void> {
    this.store(agentId).deleteAgentTimeline(agentId);
  }

  async bulkInsert(agentId: string, rows: readonly AgentTimelineRow[]): Promise<void> {
    this.store(agentId).appendAgentTimelineRows(agentId, rows);
  }

  async getProviderMessageAnchor(
    agentId: string,
    canonicalMessageId: string,
    scope: ProviderRewindScope,
  ): Promise<ProviderMessageAnchorReceipt | null> {
    return this.store(agentId).getProviderMessageAnchor(agentId, canonicalMessageId, scope);
  }

  async bindProviderMessageAnchor(
    agentId: string,
    canonicalMessageId: string,
    receipt: ProviderMessageAnchorReceipt,
    scopes: readonly ProviderRewindScope[],
  ): Promise<void> {
    this.store(agentId).bindProviderMessageAnchor(agentId, canonicalMessageId, receipt, scopes);
  }

  async truncateFromMessage(agentId: string, canonicalMessageId: string): Promise<void> {
    this.store(agentId).truncateAgentTimelineFromMessage(agentId, canonicalMessageId);
  }

  close(): void {}

  private store(agentId: string): WorkspaceAuthorityStore {
    const workspaceId = this.workspaceByAgent.get(agentId);
    const store = workspaceId
      ? this.authority.forWorkspace(workspaceId)
      : this.authority.forAgent(agentId);
    if (!store) {
      throw new Error(`Agent ${agentId} has no Workspace timeline authority`);
    }
    return store;
  }
}
