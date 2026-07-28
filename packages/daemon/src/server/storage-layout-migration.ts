import { createHash } from "node:crypto";
import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Logger } from "pino";
import {
  AUTHORITY_MIGRATION_VERSION,
  CATALOG_MIGRATION_VERSION,
  SQLITE_SCHEMA_VERSION,
  STORAGE_LAYOUT_MARKER,
  STORAGE_LAYOUT_VERSION,
  catalogDatabasePath,
  createCatalogDatabase,
  workspaceDatabasePath,
} from "./storage-schema.js";

const RELEASE_SOURCE = "05775486";
const LOCK_SUFFIX = ".migration.lock";
const NON_AUTHORITY_HOME_ENTRIES = new Set([
  "cli-client-id",
  "config.json",
  "daemon.log",
  "daemon-keypair.json",
  "desktop-attachments",
  "relay-credentials.json",
  "server-id",
]);
const CATALOG_V2_REQUIRED_TABLES = [
  "catalog_agent_locator",
  "catalog_card_locator",
  "catalog_projects",
  "catalog_provider_profiles",
  "catalog_settings",
  "catalog_task_locator",
  "catalog_turn_locator",
  "catalog_workspaces",
  "catalog_schema_migrations",
] as const;
const CATALOG_REQUIRED_TABLES = [
  ...CATALOG_V2_REQUIRED_TABLES,
  "catalog_runtime_resource_leases",
] as const;
const AUTHORITY_REQUIRED_TABLES = [
  "agent_timeline_meta",
  "agent_timeline_rows",
  "agents",
  "authority_commands",
  "authority_schema_migrations",
  "cards",
  "chat_messages",
  "chat_rooms",
  "context_bindings",
  "execution_approvals",
  "execution_attempts",
  "evidence_refs",
  "foreground_continuations",
  "foreground_turn_queue",
  "human_decisions",
  "phase_runs",
  "provider_message_anchors",
  "provider_threads",
  "runtime_attachments",
  "schedule_runs",
  "schedules",
  "task_blackboard",
  "task_decision_requests",
  "task_goals",
  "tasks",
  "timeline_entries",
  "turns",
  "workspace_meta",
] as const;
const RELEASE_CATALOG_MIGRATIONS = [[1, "workspace-task-authority-v1"]] as const;
const RELEASE_AUTHORITY_MIGRATIONS = [
  [1, "workspace-task-authority-v1"],
  [2, "task-decision-request-v2"],
  [3, "provider-control-approvals-v3"],
  [4, "foreground-queue-rewind-anchors-v4"],
] as const;

export type StorageMigrationPhase =
  | "copied"
  | "transformed"
  | "validated"
  | "before_activate"
  | "source_backed_up";

export interface StorageMigrationOptions {
  onPhase?(phase: StorageMigrationPhase, filePath: string): void;
}

export interface ThothStorageLayoutPreparation {
  requiresProviderThreadFinalization: false;
}

export async function ensureThothStorageLayout(
  thothHome: string,
  logger: Logger,
  options: StorageMigrationOptions = {},
): Promise<ThothStorageLayoutPreparation> {
  const markerPath = path.join(thothHome, STORAGE_LAYOUT_MARKER);
  const marker = readMarker(markerPath);
  if (marker?.version === STORAGE_LAYOUT_VERSION) {
    return { requiresProviderThreadFinalization: false };
  }
  if (marker && marker.version !== 1 && marker.version !== 2 && marker.version !== 3) {
    throw new Error(`Unsupported Thoth storage layout version: ${String(marker.version)}`);
  }

  const lock = acquireMigrationLock(thothHome);
  try {
    const currentMarker = readMarker(markerPath);
    if (currentMarker?.version === STORAGE_LAYOUT_VERSION) {
      return { requiresProviderThreadFinalization: false };
    }
    mkdirSync(thothHome, { recursive: true });
    const catalogPath = catalogDatabasePath(thothHome);
    if (!existsSync(catalogPath)) {
      if (!isFreshHome(thothHome)) {
        throw new Error(
          `Unsupported storage older than Release ${RELEASE_SOURCE}; the original files were preserved`,
        );
      }
      createCatalogDatabase(catalogPath);
      writeMarker(markerPath, { migrated: false, workspaceCount: 0 });
      return { requiresProviderThreadFinalization: false };
    }

    migrateDatabase(catalogPath, "catalog", options);
    const workspaceIds = readWorkspaceIds(catalogPath);
    for (const workspaceId of workspaceIds) {
      const authorityPath = workspaceDatabasePath(thothHome, workspaceId);
      if (existsSync(authorityPath)) migrateDatabase(authorityPath, "authority", options);
    }
    writeMarker(markerPath, { migrated: true, workspaceCount: workspaceIds.length });
    logger.info(
      { sourceRelease: RELEASE_SOURCE, workspaceCount: workspaceIds.length },
      "Migrated Thoth storage to normalized authority schema v4",
    );
    return { requiresProviderThreadFinalization: false };
  } finally {
    releaseMigrationLock(lock);
  }
}

function migrateDatabase(
  filePath: string,
  kind: "catalog" | "authority",
  options: StorageMigrationOptions,
): void {
  let sourceVersion = -1;
  const current = new DatabaseSync(filePath);
  try {
    const version = schemaVersion(current);
    sourceVersion = version;
    if (version === SQLITE_SCHEMA_VERSION) {
      validateDatabase(current, kind);
      return;
    }
    if (version !== 0 && version !== 2 && version !== 3) {
      throw new Error(`Unsupported SQLite schema ${version} at ${filePath}`);
    }
    if (version === 0) {
      requireTables(current, kind, 0);
      requireReleaseLedger(current, kind);
    } else if (version === 2) {
      requireTables(current, kind, 2);
      requireNormalizedV2Ledger(current, kind);
    } else {
      requireTables(current, kind, 3);
      requireNormalizedV3Ledger(current, kind);
    }
    if (existsSync(`${filePath}-wal`)) current.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  } finally {
    current.close();
  }

  const temporary = `${filePath}.v${SQLITE_SCHEMA_VERSION}.tmp-${process.pid}`;
  const backup =
    sourceVersion === 0
      ? `${filePath}.release-${RELEASE_SOURCE}.bak`
      : `${filePath}.schema-v${sourceVersion}.bak`;
  rmSync(temporary, { force: true });
  copyFileSync(filePath, temporary);
  try {
    options.onPhase?.("copied", filePath);
    const compatibilityVersion = sourceVersion === 3 ? 3 : 2;
    const beforeDigest = semanticDigest(filePath, kind, compatibilityVersion);
    const candidate = new DatabaseSync(temporary, { enableForeignKeyConstraints: true });
    try {
      candidate.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = DELETE; BEGIN IMMEDIATE;");
      try {
        if (sourceVersion === 0 && kind === "authority") {
          candidate.exec("DROP TABLE authority_events");
        }
        applySchemaV4(candidate, kind);
        const migrationTable =
          kind === "catalog" ? "catalog_schema_migrations" : "authority_schema_migrations";
        const migrationVersion =
          kind === "catalog" ? CATALOG_MIGRATION_VERSION : AUTHORITY_MIGRATION_VERSION;
        if (sourceVersion === 0) {
          candidate
            .prepare(
              `INSERT INTO ${migrationTable}(version, checksum, applied_at)
               VALUES (?, ?, ?)`,
            )
            .run(
              kind === "catalog" ? 2 : 5,
              kind === "catalog" ? "normalized-catalog-v2" : "normalized-authority-v2",
              new Date().toISOString(),
            );
        }
        if (sourceVersion !== 3) {
          candidate
            .prepare(
              `INSERT INTO ${migrationTable}(version, checksum, applied_at)
               VALUES (?, ?, ?)`,
            )
            .run(
              kind === "catalog" ? 3 : 6,
              kind === "catalog" ? "host-runtime-resources-v3" : "schedule-task-execution-v3",
              new Date().toISOString(),
            );
        }
        candidate
          .prepare(
            `INSERT INTO ${migrationTable}(version, checksum, applied_at)
             VALUES (?, ?, ?)`,
          )
          .run(
            migrationVersion,
            kind === "catalog" ? "schedule-run-workspace-v4-catalog" : "schedule-run-workspace-v4",
            new Date().toISOString(),
          );
        candidate.exec(`PRAGMA user_version = ${SQLITE_SCHEMA_VERSION}; COMMIT;`);
      } catch (error) {
        candidate.exec("ROLLBACK;");
        throw error;
      }
      options.onPhase?.("transformed", filePath);
      validateDatabase(candidate, kind);
      const afterDigest = semanticDigest(temporary, kind, compatibilityVersion);
      if (afterDigest !== beforeDigest) {
        throw new Error(`Semantic digest changed while migrating ${filePath}`);
      }
      options.onPhase?.("validated", filePath);
    } finally {
      candidate.close();
    }
    fsyncFile(temporary);
    options.onPhase?.("before_activate", filePath);
    if (existsSync(backup)) {
      throw new Error(`Migration backup already exists: ${backup}`);
    }
    renameSync(filePath, backup);
    options.onPhase?.("source_backed_up", filePath);
    try {
      renameSync(temporary, filePath);
      fsyncDirectory(path.dirname(filePath));
    } catch (error) {
      rmSync(filePath, { force: true });
      renameSync(backup, filePath);
      throw error;
    }
    rmSync(`${backup}-wal`, { force: true });
    rmSync(`${backup}-shm`, { force: true });
  } catch (error) {
    rmSync(temporary, { force: true });
    if (!existsSync(filePath) && existsSync(backup)) renameSync(backup, filePath);
    throw error;
  }
}

function applySchemaV4(database: DatabaseSync, kind: "catalog" | "authority"): void {
  if (kind === "catalog") {
    database.exec(`
      CREATE TABLE IF NOT EXISTS catalog_runtime_resource_leases (
        resource_kind TEXT NOT NULL,
        resource_key TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        owner_key TEXT NOT NULL,
        holder_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('reserved', 'active')),
        generation TEXT NOT NULL,
        value_json TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(resource_kind, resource_key),
        UNIQUE(resource_kind, workspace_id, owner_key)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS catalog_runtime_resource_leases_expiry
        ON catalog_runtime_resource_leases(resource_kind, expires_at);
    `);
    return;
  }

  const columns = new Set(
    (database.prepare("PRAGMA table_info(schedule_runs)").all() as Array<{ name: string }>).map(
      (column) => column.name,
    ),
  );
  if (!columns.has("task_id")) {
    database.exec("ALTER TABLE schedule_runs ADD COLUMN task_id TEXT;");
  }
  if (!columns.has("execution_id")) {
    database.exec("ALTER TABLE schedule_runs ADD COLUMN execution_id TEXT;");
  }
  if (!columns.has("workspace_id")) {
    database.exec("ALTER TABLE schedule_runs ADD COLUMN workspace_id TEXT;");
  }
  database.exec(`
    CREATE INDEX IF NOT EXISTS schedule_runs_task_execution
      ON schedule_runs(task_id, execution_id);
  `);
}

function requireReleaseLedger(database: DatabaseSync, kind: "catalog" | "authority"): void {
  const table = kind === "catalog" ? "catalog_schema_migrations" : "authority_schema_migrations";
  const expected = kind === "catalog" ? RELEASE_CATALOG_MIGRATIONS : RELEASE_AUTHORITY_MIGRATIONS;
  const actual = (
    database.prepare(`SELECT version, checksum FROM ${table} ORDER BY version`).all() as Array<{
      version: number;
      checksum: string;
    }>
  ).map((row) => [row.version, row.checksum]);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Unsupported ${kind} migration ledger before Release ${RELEASE_SOURCE}; the original database was preserved`,
    );
  }
}

function requireNormalizedV2Ledger(database: DatabaseSync, kind: "catalog" | "authority"): void {
  const table = kind === "catalog" ? "catalog_schema_migrations" : "authority_schema_migrations";
  const expectedVersion = kind === "catalog" ? 2 : 5;
  const expectedChecksum = kind === "catalog" ? "normalized-catalog-v2" : "normalized-authority-v2";
  const rows = database
    .prepare(`SELECT version, checksum FROM ${table} ORDER BY version`)
    .all() as Array<{ version: number; checksum: string }>;
  const latest = rows.at(-1);
  if (
    !latest ||
    latest.version !== expectedVersion ||
    latest.checksum !== expectedChecksum ||
    rows.some((row) => row.version > expectedVersion)
  ) {
    throw new Error(
      `Unsupported ${kind} normalized-v2 migration ledger; the original database was preserved`,
    );
  }
}

function requireNormalizedV3Ledger(database: DatabaseSync, kind: "catalog" | "authority"): void {
  const table = kind === "catalog" ? "catalog_schema_migrations" : "authority_schema_migrations";
  const expectedVersion = kind === "catalog" ? 3 : 6;
  const expectedChecksum =
    kind === "catalog" ? "host-runtime-resources-v3" : "schedule-task-execution-v3";
  const rows = database
    .prepare(`SELECT version, checksum FROM ${table} ORDER BY version`)
    .all() as Array<{ version: number; checksum: string }>;
  const latest = rows.at(-1);
  if (
    !latest ||
    latest.version !== expectedVersion ||
    latest.checksum !== expectedChecksum ||
    rows.some((row) => row.version > expectedVersion)
  ) {
    throw new Error(
      `Unsupported ${kind} normalized-v3 migration ledger; the original database was preserved`,
    );
  }
}

function validateDatabase(database: DatabaseSync, kind: "catalog" | "authority"): void {
  requireTables(database, kind);
  if (kind === "authority" && hasTable(database, "authority_events")) {
    throw new Error("Migrated authority database still contains the duplicate authority event log");
  }
  const integrity = database.prepare("PRAGMA integrity_check").get() as {
    integrity_check: string;
  };
  if (integrity.integrity_check !== "ok") throw new Error("SQLite integrity_check failed");
  const foreignKeys = database.prepare("PRAGMA foreign_key_check").all() as unknown[];
  if (foreignKeys.length > 0) throw new Error("SQLite foreign_key_check failed");
  if (schemaVersion(database) !== SQLITE_SCHEMA_VERSION) {
    throw new Error(`SQLite schema activation did not reach version ${SQLITE_SCHEMA_VERSION}`);
  }
}

function requireTables(
  database: DatabaseSync,
  kind: "catalog" | "authority",
  sourceVersion: 0 | 2 | 3 | 4 = 4,
): void {
  const required =
    kind === "catalog" && sourceVersion < 3
      ? CATALOG_V2_REQUIRED_TABLES
      : kind === "catalog"
        ? CATALOG_REQUIRED_TABLES
        : AUTHORITY_REQUIRED_TABLES;
  const missing: string[] = required.filter((table) => !hasTable(database, table));
  if (kind === "authority" && sourceVersion === 0 && !hasTable(database, "authority_events")) {
    missing.push("authority_events");
  }
  if (missing.length > 0) {
    throw new Error(
      `Unsupported ${kind} layout before Release ${RELEASE_SOURCE}; missing ${missing.join(", ")}`,
    );
  }
}

function semanticDigest(
  filePath: string,
  kind: "catalog" | "authority",
  compatibilityVersion?: 2 | 3,
): string {
  const database = new DatabaseSync(filePath, { readOnly: true });
  try {
    const excluded = new Set([
      "authority_events",
      kind === "catalog" ? "catalog_schema_migrations" : "authority_schema_migrations",
      ...(compatibilityVersion === 2 && kind === "catalog"
        ? ["catalog_runtime_resource_leases"]
        : []),
    ]);
    const tables = (
      database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all() as Array<{ name: string }>
    ).filter((row) => !row.name.startsWith("sqlite_") && !excluded.has(row.name));
    const hash = createHash("sha256");
    for (const { name } of tables) {
      const columns = database
        .prepare(`PRAGMA table_xinfo(${quoteIdentifier(name)})`)
        .all() as Array<{
        name: string;
        pk: number;
      }>;
      const names = columns
        .map((column) => column.name)
        .filter(
          (column) =>
            kind !== "authority" ||
            name !== "schedule_runs" ||
            (compatibilityVersion !== 2 && compatibilityVersion !== 3) ||
            (compatibilityVersion === 2
              ? column !== "task_id" && column !== "execution_id" && column !== "workspace_id"
              : column !== "workspace_id"),
        );
      const primary = columns
        .filter((column) => column.pk > 0 && names.includes(column.name))
        .sort((left, right) => left.pk - right.pk)
        .map((column) => column.name);
      const order = primary.length > 0 ? primary : names;
      const rows = database
        .prepare(
          `SELECT ${names.map(quoteIdentifier).join(", ")} FROM ${quoteIdentifier(name)} ORDER BY ${order.map(quoteIdentifier).join(", ")}`,
        )
        .all();
      hash.update(JSON.stringify({ name, columns: names, rows }));
    }
    return hash.digest("hex");
  } finally {
    database.close();
  }
}

function readWorkspaceIds(catalogPath: string): string[] {
  const database = new DatabaseSync(catalogPath, { readOnly: true });
  try {
    return (
      database
        .prepare("SELECT workspace_id FROM catalog_workspaces ORDER BY workspace_id")
        .all() as Array<{ workspace_id: string }>
    ).map((row) => row.workspace_id);
  } finally {
    database.close();
  }
}

function readMarker(markerPath: string): { version: unknown } | null {
  if (!existsSync(markerPath)) return null;
  return JSON.parse(readFileSync(markerPath, "utf8")) as { version: unknown };
}

function writeMarker(
  markerPath: string,
  input: { migrated: boolean; workspaceCount: number },
): void {
  const value = {
    version: STORAGE_LAYOUT_VERSION,
    schemaVersion: SQLITE_SCHEMA_VERSION,
    sourceRelease: RELEASE_SOURCE,
    migrationState: "complete",
    migrated: input.migrated,
    workspaceCount: input.workspaceCount,
    completedAt: new Date().toISOString(),
  };
  const temporary = `${markerPath}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fsyncFile(temporary);
  renameSync(temporary, markerPath);
  fsyncDirectory(path.dirname(markerPath));
}

function acquireMigrationLock(thothHome: string): { path: string; fd: number } {
  const lockPath = `${thothHome}${LOCK_SUFFIX}`;
  if (existsSync(lockPath)) {
    const existing = JSON.parse(readFileSync(lockPath, "utf8")) as { pid?: unknown };
    if (typeof existing.pid === "number") {
      try {
        process.kill(existing.pid, 0);
        throw new Error(`Thoth storage migration is already running in process ${existing.pid}`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    }
    rmSync(lockPath, { force: true });
  }
  mkdirSync(path.dirname(lockPath), { recursive: true });
  const fd = openSync(lockPath, "wx", 0o600);
  writeSync(fd, `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`);
  return { path: lockPath, fd };
}

function releaseMigrationLock(lock: { path: string; fd: number }): void {
  closeSync(lock.fd);
  rmSync(lock.path, { force: true });
}

function schemaVersion(database: DatabaseSync): number {
  return Number(
    (database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version,
  );
}

function hasTable(database: DatabaseSync, table: string): boolean {
  return Boolean(
    database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table),
  );
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function isFreshHome(thothHome: string): boolean {
  if (!existsSync(thothHome)) return true;
  return readdirSync(thothHome).every(
    (name) =>
      name === path.basename(`${thothHome}${LOCK_SUFFIX}`) || NON_AUTHORITY_HOME_ENTRIES.has(name),
  );
}

function fsyncFile(filePath: string): void {
  // Windows FlushFileBuffers requires a handle opened with write access.
  const fd = openSync(filePath, "r+");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function fsyncDirectory(directory: string): void {
  // Node cannot open directory handles for fsync on Windows. The file itself is
  // already synced before the atomic rename; parent-directory fsync is the
  // additional POSIX durability step.
  if (process.platform === "win32") return;
  const fd = openSync(directory, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
