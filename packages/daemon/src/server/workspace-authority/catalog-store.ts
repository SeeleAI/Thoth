import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { PersistedProjectRecord, PersistedWorkspaceRecord } from "../workspace-registry.js";
import { openCatalogDatabase } from "../storage-schema.js";

export interface CatalogWorkspaceRecord {
  id: string;
  canonicalPath: string;
  displayName: string;
  kind: "workspace" | "worktree";
  parentWorkspaceId: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogProviderProfile {
  id: string;
  adapterId: string;
  config: Record<string, unknown>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogRuntimeResourceLease {
  resourceKind: string;
  resourceKey: string;
  workspaceId: string;
  ownerKey: string;
  holderId: string;
  status: "reserved" | "active";
  generation: string;
  value: Record<string, unknown>;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogSettingRecord {
  key: string;
  value: Record<string, unknown>;
  revision: number;
  updatedAt: string;
}

export class WorkspaceCatalogStore {
  private readonly database: DatabaseSync;
  private readonly agentLocations = new Map<string, string | null>();
  private readonly turnLocations = new Map<string, string | null>();
  private readonly cardLocations = new Map<string, string | null>();

  constructor(thothHome: string) {
    this.database = openCatalogDatabase(thothHome);
  }

  upsertWorkspace(record: CatalogWorkspaceRecord): void {
    this.database
      .prepare(
        `INSERT INTO catalog_workspaces(
           workspace_id, canonical_path, display_name, kind, parent_workspace_id,
           archived_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(workspace_id) DO UPDATE SET
           canonical_path = excluded.canonical_path,
           display_name = excluded.display_name,
           kind = excluded.kind,
           parent_workspace_id = excluded.parent_workspace_id,
           archived_at = excluded.archived_at,
           updated_at = excluded.updated_at`,
      )
      .run(
        record.id,
        record.canonicalPath,
        record.displayName,
        record.kind,
        record.parentWorkspaceId,
        record.archivedAt,
        record.createdAt,
        record.updatedAt,
      );
  }

  getWorkspace(workspaceId: string): CatalogWorkspaceRecord | null {
    const row = this.database
      .prepare("SELECT * FROM catalog_workspaces WHERE workspace_id = ?")
      .get(workspaceId) as Record<string, unknown> | undefined;
    return row ? this.toWorkspace(row) : null;
  }

  listWorkspaces(): CatalogWorkspaceRecord[] {
    const rows = this.database
      .prepare("SELECT * FROM catalog_workspaces ORDER BY updated_at DESC")
      .all() as Array<Record<string, unknown>>;
    return rows.map((row) => this.toWorkspace(row));
  }

  hasRegistryProjects(): boolean {
    const row = this.database.prepare("SELECT COUNT(*) AS count FROM catalog_projects").get() as {
      count: number;
    };
    return Number(row.count) > 0;
  }

  hasRegistryWorkspaces(): boolean {
    const row = this.database
      .prepare("SELECT COUNT(*) AS count FROM catalog_workspaces WHERE project_id IS NOT NULL")
      .get() as { count: number };
    return Number(row.count) > 0;
  }

  upsertProjectRecord(record: PersistedProjectRecord): void {
    this.database
      .prepare(
        `INSERT INTO catalog_projects(
           project_id, root_path, kind, display_name, custom_name,
           archived_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_id) DO UPDATE SET
           root_path = excluded.root_path,
           kind = excluded.kind,
           display_name = excluded.display_name,
           custom_name = excluded.custom_name,
           archived_at = excluded.archived_at,
           updated_at = excluded.updated_at`,
      )
      .run(
        record.projectId,
        path.resolve(record.rootPath),
        record.kind,
        record.displayName,
        record.customName,
        record.archivedAt,
        record.createdAt,
        record.updatedAt,
      );
  }

  listProjectRecords(): PersistedProjectRecord[] {
    const rows = this.database
      .prepare("SELECT * FROM catalog_projects ORDER BY updated_at DESC")
      .all() as Array<Record<string, unknown>>;
    return rows.map((row) => this.toProjectRecord(row));
  }

  getProjectRecord(projectId: string): PersistedProjectRecord | null {
    const row = this.database
      .prepare("SELECT * FROM catalog_projects WHERE project_id = ?")
      .get(projectId) as Record<string, unknown> | undefined;
    return row ? this.toProjectRecord(row) : null;
  }

  archiveProjectRecord(projectId: string, archivedAt: string): void {
    this.database
      .prepare("UPDATE catalog_projects SET archived_at = ?, updated_at = ? WHERE project_id = ?")
      .run(archivedAt, archivedAt, projectId);
  }

  removeProjectRecord(projectId: string): void {
    this.database.prepare("DELETE FROM catalog_projects WHERE project_id = ?").run(projectId);
  }

  upsertWorkspaceRecord(record: PersistedWorkspaceRecord): void {
    const authorityKind = record.kind === "worktree" ? "worktree" : "workspace";
    this.database
      .prepare(
        `INSERT INTO catalog_workspaces(
           workspace_id, canonical_path, display_name, kind, parent_workspace_id,
           archived_at, created_at, updated_at, project_id, registry_kind,
           title, branch, base_branch
         ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(workspace_id) DO UPDATE SET
           canonical_path = excluded.canonical_path,
           display_name = excluded.display_name,
           kind = excluded.kind,
           archived_at = excluded.archived_at,
           updated_at = excluded.updated_at,
           project_id = excluded.project_id,
           registry_kind = excluded.registry_kind,
           title = excluded.title,
           branch = excluded.branch,
           base_branch = excluded.base_branch`,
      )
      .run(
        record.workspaceId,
        path.resolve(record.cwd),
        record.displayName,
        authorityKind,
        record.archivedAt,
        record.createdAt,
        record.updatedAt,
        record.projectId,
        record.kind,
        record.title,
        record.branch,
        record.baseBranch,
      );
  }

  listWorkspaceRecords(): PersistedWorkspaceRecord[] {
    const rows = this.database
      .prepare(
        "SELECT * FROM catalog_workspaces WHERE project_id IS NOT NULL ORDER BY updated_at DESC",
      )
      .all() as Array<Record<string, unknown>>;
    return rows.map((row) => this.toWorkspaceRecord(row));
  }

  getWorkspaceRecord(workspaceId: string): PersistedWorkspaceRecord | null {
    const row = this.database
      .prepare("SELECT * FROM catalog_workspaces WHERE workspace_id = ? AND project_id IS NOT NULL")
      .get(workspaceId) as Record<string, unknown> | undefined;
    return row ? this.toWorkspaceRecord(row) : null;
  }

  archiveWorkspaceRecord(workspaceId: string, archivedAt: string): void {
    this.database
      .prepare(
        "UPDATE catalog_workspaces SET archived_at = ?, updated_at = ? WHERE workspace_id = ?",
      )
      .run(archivedAt, archivedAt, workspaceId);
  }

  removeWorkspaceRecord(workspaceId: string): void {
    this.database.prepare("DELETE FROM catalog_workspaces WHERE workspace_id = ?").run(workspaceId);
  }

  updateTaskLocator(input: {
    taskId: string;
    workspaceId: string;
    title: string;
    status: string;
    revision: number;
    updatedAt: string;
  }): void {
    this.database
      .prepare(
        `INSERT INTO catalog_task_locator(task_id, workspace_id, title, status, revision, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(task_id) DO UPDATE SET
           workspace_id = excluded.workspace_id,
           title = excluded.title,
           status = excluded.status,
           revision = excluded.revision,
           updated_at = excluded.updated_at`,
      )
      .run(
        input.taskId,
        input.workspaceId,
        input.title,
        input.status,
        input.revision,
        input.updatedAt,
      );
  }

  upsertProviderProfile(profile: CatalogProviderProfile): void {
    this.database
      .prepare(
        `INSERT INTO catalog_provider_profiles(
           profile_id, adapter_id, config_json, enabled, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(profile_id) DO UPDATE SET
           adapter_id = excluded.adapter_id,
           config_json = excluded.config_json,
           enabled = excluded.enabled,
           updated_at = excluded.updated_at`,
      )
      .run(
        profile.id,
        profile.adapterId,
        JSON.stringify(profile.config),
        profile.enabled ? 1 : 0,
        profile.createdAt,
        profile.updatedAt,
      );
  }

  getProviderProfile(profileId: string): CatalogProviderProfile | null {
    const row = this.database
      .prepare("SELECT * FROM catalog_provider_profiles WHERE profile_id = ?")
      .get(profileId) as Record<string, unknown> | undefined;
    if (!row) {
      return null;
    }
    return {
      id: String(row.profile_id),
      adapterId: String(row.adapter_id),
      config: JSON.parse(String(row.config_json)) as Record<string, unknown>,
      enabled: Number(row.enabled) === 1,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  getSetting(key: string): CatalogSettingRecord | null {
    const row = this.database
      .prepare("SELECT * FROM catalog_settings WHERE setting_key = ?")
      .get(key) as Record<string, unknown> | undefined;
    return row ? this.toSetting(row) : null;
  }

  listSettings(prefix: string): CatalogSettingRecord[] {
    const rows = this.database
      .prepare(
        `SELECT * FROM catalog_settings
         WHERE setting_key LIKE ?
         ORDER BY setting_key`,
      )
      .all(`${prefix}%`) as Array<Record<string, unknown>>;
    return rows.map((row) => this.toSetting(row));
  }

  compareAndSetSetting(input: {
    key: string;
    value: Record<string, unknown>;
    expectedRevision: number | null;
    updatedAt: string;
  }): CatalogSettingRecord | null {
    if (input.expectedRevision === null) {
      const inserted = this.database
        .prepare(
          `INSERT OR IGNORE INTO catalog_settings(setting_key, value_json, revision, updated_at)
           VALUES (?, ?, 0, ?)`,
        )
        .run(input.key, JSON.stringify(input.value), input.updatedAt).changes;
      return Number(inserted) === 1 ? this.getSetting(input.key) : null;
    }
    const changed = this.database
      .prepare(
        `UPDATE catalog_settings
         SET value_json = ?, revision = revision + 1, updated_at = ?
         WHERE setting_key = ? AND revision = ?`,
      )
      .run(JSON.stringify(input.value), input.updatedAt, input.key, input.expectedRevision).changes;
    return Number(changed) === 1 ? this.getSetting(input.key) : null;
  }

  removeSetting(input: { key: string; expectedRevision: number }): boolean {
    const changed = this.database
      .prepare("DELETE FROM catalog_settings WHERE setting_key = ? AND revision = ?")
      .run(input.key, input.expectedRevision).changes;
    return Number(changed) === 1;
  }

  getRuntimeResourceLeaseByOwner(input: {
    resourceKind: string;
    workspaceId: string;
    ownerKey: string;
  }): CatalogRuntimeResourceLease | null {
    const row = this.database
      .prepare(
        `SELECT * FROM catalog_runtime_resource_leases
         WHERE resource_kind = ? AND workspace_id = ? AND owner_key = ?`,
      )
      .get(input.resourceKind, input.workspaceId, input.ownerKey) as
      | Record<string, unknown>
      | undefined;
    return row ? this.toRuntimeResourceLease(row) : null;
  }

  getRuntimeResourceLeaseByKey(input: {
    resourceKind: string;
    resourceKey: string;
  }): CatalogRuntimeResourceLease | null {
    const row = this.database
      .prepare(
        `SELECT * FROM catalog_runtime_resource_leases
         WHERE resource_kind = ? AND resource_key = ?`,
      )
      .get(input.resourceKind, input.resourceKey) as Record<string, unknown> | undefined;
    return row ? this.toRuntimeResourceLease(row) : null;
  }

  listRuntimeResourceLeases(resourceKind: string): CatalogRuntimeResourceLease[] {
    const rows = this.database
      .prepare(
        `SELECT * FROM catalog_runtime_resource_leases
         WHERE resource_kind = ? ORDER BY workspace_id, owner_key`,
      )
      .all(resourceKind) as Array<Record<string, unknown>>;
    return rows.map((row) => this.toRuntimeResourceLease(row));
  }

  tryReserveRuntimeResource(
    input: CatalogRuntimeResourceLease,
  ): CatalogRuntimeResourceLease | null {
    const existing = this.getRuntimeResourceLeaseByOwner(input);
    if (existing) {
      if (
        existing.resourceKey !== input.resourceKey ||
        existing.holderId !== input.holderId ||
        existing.generation !== input.generation
      ) {
        return null;
      }
      const changed = this.database
        .prepare(
          `UPDATE catalog_runtime_resource_leases
           SET value_json = ?, expires_at = ?, updated_at = ?
           WHERE resource_kind = ? AND resource_key = ? AND workspace_id = ?
             AND owner_key = ? AND holder_id = ? AND generation = ?`,
        )
        .run(
          JSON.stringify(input.value),
          input.expiresAt,
          input.updatedAt,
          input.resourceKind,
          input.resourceKey,
          input.workspaceId,
          input.ownerKey,
          input.holderId,
          input.generation,
        ).changes;
      return Number(changed) === 1 ? this.getRuntimeResourceLeaseByOwner(input) : null;
    }

    const inserted = this.database
      .prepare(
        `INSERT OR IGNORE INTO catalog_runtime_resource_leases(
           resource_kind, resource_key, workspace_id, owner_key, holder_id,
           status, generation, value_json, expires_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.resourceKind,
        input.resourceKey,
        input.workspaceId,
        input.ownerKey,
        input.holderId,
        input.status,
        input.generation,
        JSON.stringify(input.value),
        input.expiresAt,
        input.createdAt,
        input.updatedAt,
      ).changes;
    return Number(inserted) === 1 ? this.getRuntimeResourceLeaseByOwner(input) : null;
  }

  reclaimRuntimeResource(input: {
    resourceKind: string;
    resourceKey: string;
    workspaceId: string;
    ownerKey: string;
    expectedGeneration: string;
    holderId: string;
    generation: string;
    value: Record<string, unknown>;
    expiresAt: string;
    updatedAt: string;
  }): CatalogRuntimeResourceLease | null {
    const changed = this.database
      .prepare(
        `UPDATE catalog_runtime_resource_leases
         SET holder_id = ?, status = 'reserved', generation = ?, value_json = ?,
             expires_at = ?, updated_at = ?
         WHERE resource_kind = ? AND resource_key = ? AND workspace_id = ?
           AND owner_key = ? AND generation = ?`,
      )
      .run(
        input.holderId,
        input.generation,
        JSON.stringify(input.value),
        input.expiresAt,
        input.updatedAt,
        input.resourceKind,
        input.resourceKey,
        input.workspaceId,
        input.ownerKey,
        input.expectedGeneration,
      ).changes;
    return Number(changed) === 1 ? this.getRuntimeResourceLeaseByOwner(input) : null;
  }

  updateRuntimeResourceLease(input: {
    resourceKind: string;
    resourceKey: string;
    workspaceId: string;
    ownerKey: string;
    holderId: string;
    generation: string;
    fromStatuses: readonly ("reserved" | "active")[];
    status: "reserved" | "active";
    expiresAt: string;
    updatedAt: string;
  }): boolean {
    if (input.fromStatuses.length === 0) return false;
    const placeholders = input.fromStatuses.map(() => "?").join(", ");
    const changed = this.database
      .prepare(
        `UPDATE catalog_runtime_resource_leases
         SET status = ?, expires_at = ?, updated_at = ?
         WHERE resource_kind = ? AND resource_key = ? AND workspace_id = ?
           AND owner_key = ? AND holder_id = ? AND generation = ?
           AND status IN (${placeholders})`,
      )
      .run(
        input.status,
        input.expiresAt,
        input.updatedAt,
        input.resourceKind,
        input.resourceKey,
        input.workspaceId,
        input.ownerKey,
        input.holderId,
        input.generation,
        ...input.fromStatuses,
      ).changes;
    return Number(changed) === 1;
  }

  releaseRuntimeResource(input: {
    resourceKind: string;
    resourceKey: string;
    workspaceId: string;
    ownerKey: string;
    holderId: string;
    generation: string;
  }): boolean {
    const changed = this.database
      .prepare(
        `DELETE FROM catalog_runtime_resource_leases
         WHERE resource_kind = ? AND resource_key = ? AND workspace_id = ?
           AND owner_key = ? AND holder_id = ? AND generation = ?`,
      )
      .run(
        input.resourceKind,
        input.resourceKey,
        input.workspaceId,
        input.ownerKey,
        input.holderId,
        input.generation,
      ).changes;
    return Number(changed) === 1;
  }

  locateAgent(agentId: string): string | null {
    return this.locate(
      this.agentLocations,
      "SELECT workspace_id FROM catalog_agent_locator WHERE agent_id = ?",
      agentId,
    );
  }

  locateTurn(turnId: string): string | null {
    return this.locate(
      this.turnLocations,
      "SELECT workspace_id FROM catalog_turn_locator WHERE turn_id = ?",
      turnId,
    );
  }

  locateCard(cardId: string): string | null {
    return this.locate(
      this.cardLocations,
      "SELECT workspace_id FROM catalog_card_locator WHERE card_id = ?",
      cardId,
    );
  }

  updateAgentLocator(input: { agentId: string; workspaceId: string; updatedAt: string }): void {
    this.database
      .prepare(
        `INSERT INTO catalog_agent_locator(agent_id, workspace_id, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(agent_id) DO UPDATE SET
           workspace_id = excluded.workspace_id,
           updated_at = excluded.updated_at`,
      )
      .run(input.agentId, input.workspaceId, input.updatedAt);
    this.agentLocations.set(input.agentId, input.workspaceId);
  }

  removeAgentLocator(agentId: string): void {
    this.database.prepare("DELETE FROM catalog_agent_locator WHERE agent_id = ?").run(agentId);
    this.agentLocations.set(agentId, null);
  }

  updateTurnLocator(input: {
    turnId: string;
    workspaceId: string;
    agentId: string;
    updatedAt: string;
  }): void {
    this.database
      .prepare(
        `INSERT INTO catalog_turn_locator(turn_id, workspace_id, agent_id, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(turn_id) DO UPDATE SET
           workspace_id = excluded.workspace_id,
           agent_id = excluded.agent_id,
           updated_at = excluded.updated_at`,
      )
      .run(input.turnId, input.workspaceId, input.agentId, input.updatedAt);
    this.turnLocations.set(input.turnId, input.workspaceId);
  }

  updateCardLocator(input: {
    cardId: string;
    workspaceId: string;
    agentId: string;
    turnId: string;
    updatedAt: string;
  }): void {
    this.database
      .prepare(
        `INSERT INTO catalog_card_locator(card_id, workspace_id, agent_id, turn_id, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(card_id) DO UPDATE SET
           workspace_id = excluded.workspace_id,
           agent_id = excluded.agent_id,
           turn_id = excluded.turn_id,
           updated_at = excluded.updated_at`,
      )
      .run(input.cardId, input.workspaceId, input.agentId, input.turnId, input.updatedAt);
    this.cardLocations.set(input.cardId, input.workspaceId);
  }

  close(): void {
    this.agentLocations.clear();
    this.turnLocations.clear();
    this.cardLocations.clear();
    this.database.close();
  }

  private locate(cache: Map<string, string | null>, query: string, id: string): string | null {
    if (cache.has(id)) return cache.get(id) ?? null;
    const row = this.database.prepare(query).get(id) as { workspace_id: string } | undefined;
    const workspaceId = row?.workspace_id ?? null;
    cache.set(id, workspaceId);
    return workspaceId;
  }

  private toWorkspace(row: Record<string, unknown>): CatalogWorkspaceRecord {
    return {
      id: String(row.workspace_id),
      canonicalPath: String(row.canonical_path),
      displayName: String(row.display_name),
      kind: row.kind === "worktree" ? "worktree" : "workspace",
      parentWorkspaceId:
        typeof row.parent_workspace_id === "string" ? row.parent_workspace_id : null,
      archivedAt: typeof row.archived_at === "string" ? row.archived_at : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private toRuntimeResourceLease(row: Record<string, unknown>): CatalogRuntimeResourceLease {
    const status = String(row.status);
    if (status !== "reserved" && status !== "active") {
      throw new Error(`Invalid runtime resource lease status: ${status}`);
    }
    return {
      resourceKind: String(row.resource_kind),
      resourceKey: String(row.resource_key),
      workspaceId: String(row.workspace_id),
      ownerKey: String(row.owner_key),
      holderId: String(row.holder_id),
      status,
      generation: String(row.generation),
      value: JSON.parse(String(row.value_json)) as Record<string, unknown>,
      expiresAt: String(row.expires_at),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private toSetting(row: Record<string, unknown>): CatalogSettingRecord {
    return {
      key: String(row.setting_key),
      value: JSON.parse(String(row.value_json)) as Record<string, unknown>,
      revision: Number(row.revision),
      updatedAt: String(row.updated_at),
    };
  }

  private toProjectRecord(row: Record<string, unknown>): PersistedProjectRecord {
    return {
      projectId: String(row.project_id),
      rootPath: String(row.root_path),
      kind: row.kind === "git" ? "git" : "non_git",
      displayName: String(row.display_name),
      customName: typeof row.custom_name === "string" ? row.custom_name : null,
      archivedAt: typeof row.archived_at === "string" ? row.archived_at : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private toWorkspaceRecord(row: Record<string, unknown>): PersistedWorkspaceRecord {
    const registryKind = String(row.registry_kind);
    if (!["local_checkout", "worktree", "directory"].includes(registryKind)) {
      throw new Error(`Invalid Workspace registry kind: ${registryKind}`);
    }
    return {
      workspaceId: String(row.workspace_id),
      projectId: String(row.project_id),
      cwd: String(row.canonical_path),
      kind: registryKind as PersistedWorkspaceRecord["kind"],
      displayName: String(row.display_name),
      title: typeof row.title === "string" ? row.title : null,
      branch: typeof row.branch === "string" ? row.branch : null,
      baseBranch: typeof row.base_branch === "string" ? row.base_branch : null,
      archivedAt: typeof row.archived_at === "string" ? row.archived_at : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }
}
