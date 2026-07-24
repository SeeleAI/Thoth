import type { ManagedAgent } from "../agent/execution-service.js";
import { type AgentRegistry, type StoredAgentRecord } from "../agent/agent-storage.js";
import { toStoredAgentRecord } from "../agent/agent-projections.js";
import type { WorkspaceAuthorityManager } from "./workspace-authority-manager.js";

/** Durable Agent registry backed only by per-Workspace authority shards. */
export class WorkspaceAgentStorage implements AgentRegistry {
  private readonly deleting = new Set<string>();

  constructor(private readonly authority: WorkspaceAuthorityManager) {}

  async initialize(): Promise<void> {}

  async list(): Promise<StoredAgentRecord[]> {
    return this.authority.catalog
      .listWorkspaces()
      .flatMap((workspace) => this.authority.forWorkspace(workspace.id).listAgentRecords());
  }

  async get(agentId: string): Promise<StoredAgentRecord | null> {
    return this.authority.forAgent(agentId)?.getAgentRecord(agentId) ?? null;
  }

  async upsert(record: StoredAgentRecord): Promise<void> {
    if (this.deleting.has(record.id)) {
      return;
    }
    if (!record.workspaceId) {
      throw new Error(`Agent ${record.id} has no Workspace authority`);
    }
    const currentWorkspaceId = this.authority.catalog.locateAgent(record.id);
    if (currentWorkspaceId && currentWorkspaceId !== record.workspaceId) {
      this.authority.forWorkspace(currentWorkspaceId).removeAgentRecord(record.id);
    }
    this.authority.forWorkspace(record.workspaceId).upsertAgentRecord(record);
  }

  beginDelete(agentId: string): void {
    this.deleting.add(agentId);
  }

  async remove(agentId: string): Promise<void> {
    this.beginDelete(agentId);
    this.authority.forAgent(agentId)?.removeAgentRecord(agentId);
  }

  async applySnapshot(
    agent: ManagedAgent,
    options?: { title?: string | null; internal?: boolean },
  ): Promise<void> {
    const existing = await this.get(agent.id);
    const hasTitleOverride = options !== undefined && Object.hasOwn(options, "title");
    const hasInternalOverride = options !== undefined && Object.hasOwn(options, "internal");
    const record = toStoredAgentRecord(agent, {
      title: hasTitleOverride ? (options?.title ?? null) : (existing?.title ?? null),
      createdAt: existing?.createdAt,
      internal: hasInternalOverride ? options?.internal : (agent.internal ?? existing?.internal),
    });
    if (existing?.archivedAt !== undefined) {
      record.archivedAt = existing.archivedAt;
    }
    await this.upsert(record);
  }

  async setTitle(agentId: string, title: string): Promise<void> {
    const record = await this.get(agentId);
    if (!record) {
      throw new Error(`Agent ${agentId} not found`);
    }
    await this.upsert({ ...record, title });
  }

  async flush(): Promise<void> {}
}
