import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { PersistedProjectRecord, PersistedWorkspaceRecord } from "../workspace-registry.js";

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

export class WorkspaceCatalogStore {
  private readonly database: DatabaseSync;

  constructor(thothHome: string) {
    mkdirSync(thothHome, { recursive: true });
    this.database = new DatabaseSync(path.join(thothHome, "catalog.sqlite"), {
      enableForeignKeyConstraints: true,
    });
    this.database.exec(
      "PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;",
    );
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS catalog_schema_migrations (
        version INTEGER PRIMARY KEY NOT NULL,
        checksum TEXT NOT NULL,
        applied_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS catalog_workspaces (
        workspace_id TEXT PRIMARY KEY NOT NULL,
        canonical_path TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('workspace', 'worktree')),
        parent_workspace_id TEXT,
        archived_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS catalog_projects (
        project_id TEXT PRIMARY KEY NOT NULL,
        root_path TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL CHECK(kind IN ('git', 'non_git')),
        display_name TEXT NOT NULL,
        custom_name TEXT,
        archived_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS catalog_provider_profiles (
        profile_id TEXT PRIMARY KEY NOT NULL,
        adapter_id TEXT NOT NULL,
        config_json TEXT NOT NULL,
        enabled INTEGER NOT NULL CHECK(enabled IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS catalog_settings (
        setting_key TEXT PRIMARY KEY NOT NULL,
        value_json TEXT NOT NULL,
        revision INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS catalog_task_locator (
        task_id TEXT PRIMARY KEY NOT NULL,
        workspace_id TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        revision INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(workspace_id) REFERENCES catalog_workspaces(workspace_id)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS catalog_task_locator_workspace_updated
        ON catalog_task_locator(workspace_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS catalog_agent_locator (
        agent_id TEXT PRIMARY KEY NOT NULL,
        workspace_id TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(workspace_id) REFERENCES catalog_workspaces(workspace_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS catalog_turn_locator (
        turn_id TEXT PRIMARY KEY NOT NULL,
        workspace_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(workspace_id) REFERENCES catalog_workspaces(workspace_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS catalog_card_locator (
        card_id TEXT PRIMARY KEY NOT NULL,
        workspace_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(workspace_id) REFERENCES catalog_workspaces(workspace_id)
      ) STRICT;
    `);
    this.ensureColumn("catalog_workspaces", "project_id", "TEXT");
    this.ensureColumn("catalog_workspaces", "registry_kind", "TEXT");
    this.ensureColumn("catalog_workspaces", "title", "TEXT");
    this.ensureColumn("catalog_workspaces", "branch", "TEXT");
    this.ensureColumn("catalog_workspaces", "base_branch", "TEXT");
    this.database
      .prepare(
        `INSERT OR IGNORE INTO catalog_schema_migrations(version, checksum, applied_at)
         VALUES (1, 'workspace-task-authority-v1', ?)`,
      )
      .run(new Date().toISOString());
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

  locateAgent(agentId: string): string | null {
    const row = this.database
      .prepare("SELECT workspace_id FROM catalog_agent_locator WHERE agent_id = ?")
      .get(agentId) as { workspace_id: string } | undefined;
    return row?.workspace_id ?? null;
  }

  locateTurn(turnId: string): string | null {
    const row = this.database
      .prepare("SELECT workspace_id FROM catalog_turn_locator WHERE turn_id = ?")
      .get(turnId) as { workspace_id: string } | undefined;
    return row?.workspace_id ?? null;
  }

  locateCard(cardId: string): string | null {
    const row = this.database
      .prepare("SELECT workspace_id FROM catalog_card_locator WHERE card_id = ?")
      .get(cardId) as { workspace_id: string } | undefined;
    return row?.workspace_id ?? null;
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
  }

  removeAgentLocator(agentId: string): void {
    this.database.prepare("DELETE FROM catalog_agent_locator WHERE agent_id = ?").run(agentId);
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
  }

  close(): void {
    this.database.close();
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

  private ensureColumn(table: string, column: string, definition: string): void {
    const columns = this.database.prepare(`PRAGMA table_info(${table})`).all() as Array<{
      name: string;
    }>;
    if (!columns.some((entry) => entry.name === column)) {
      this.database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }
}
