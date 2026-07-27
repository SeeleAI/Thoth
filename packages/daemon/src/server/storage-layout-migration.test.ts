import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createTestLogger } from "../test-utils/test-logger.js";
import { ensureThothStorageLayout } from "./storage-layout-migration.js";
import { createWorkspaceDatabase } from "./storage-schema.js";
import { WorkspaceAuthorityManager } from "./workspace-authority/index.js";

const fixtureRoot = fileURLToPath(
  new URL("../test-fixtures/refactor-release-05775486/", import.meta.url),
);
const fixtureManifest = JSON.parse(
  readFileSync(path.join(fixtureRoot, "manifest.json"), "utf8"),
) as { workspaceId: string; semanticDigest: string; behavior: unknown };
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Thoth storage layout migration", () => {
  it("losslessly upgrades the frozen Release 05775486 authority and removes the duplicate event log", async () => {
    const home = releaseHome();
    const authorityPath = workspaceAuthorityPath(home);
    const before = entityDigest(home);
    const beforeCounts = entityCounts(authorityPath);
    const beforeMigrations = migrationRows(authorityPath);

    await ensureThothStorageLayout(home, createTestLogger());

    expect(entityDigest(home)).toBe(before);
    const behavior = behaviorTranscript(authorityPath);
    expect(behavior).toEqual(fixtureManifest.behavior);
    expect(hashJson(behavior)).toBe(fixtureManifest.semanticDigest);
    expect(entityCounts(authorityPath)).toEqual(beforeCounts);
    expect(migrationRows(authorityPath)).toEqual([
      ...beforeMigrations,
      expect.objectContaining({ version: 5, checksum: "normalized-authority-v2" }),
      expect.objectContaining({ version: 6, checksum: "schedule-task-execution-v3" }),
    ]);
    expect(schemaVersion(path.join(home, "catalog.sqlite"))).toBe(3);
    expect(schemaVersion(authorityPath)).toBe(3);
    expect(hasTable(path.join(home, "catalog.sqlite"), "catalog_runtime_resource_leases")).toBe(
      true,
    );
    expect(tableColumns(authorityPath, "schedule_runs")).toEqual(
      expect.arrayContaining(["task_id", "execution_id"]),
    );
    expect(hasTable(authorityPath, "authority_events")).toBe(false);
    expect(existsSync(`${path.join(home, "catalog.sqlite")}.release-05775486.bak`)).toBe(true);
    expect(existsSync(`${authorityPath}.release-05775486.bak`)).toBe(true);
    expect(readdirSync(path.dirname(authorityPath)).some((name) => /-(wal|shm)$/u.test(name))).toBe(
      false,
    );
    expect(JSON.parse(readFileSync(path.join(home, "storage-layout.json"), "utf8"))).toMatchObject({
      version: 3,
      schemaVersion: 3,
      sourceRelease: "05775486",
      migrated: true,
      migrationState: "complete",
    });

    const authority = new WorkspaceAuthorityManager(home);
    const taskId = onlyTaskId(authorityPath);
    expect(authority.forWorkspace(fixtureManifest.workspaceId).getTask(taskId)).toMatchObject({
      status: "completed",
      goals: [{ status: "passed" }, { status: "passed" }],
    });
    authority.close();
  });

  for (const phase of [
    "copied",
    "transformed",
    "validated",
    "before_activate",
    "source_backed_up",
  ] as const) {
    it(`preserves the original database when failure is injected at ${phase}`, async () => {
      const home = releaseHome();
      const authorityPath = workspaceAuthorityPath(home);
      const original = sha256(authorityPath);
      await expect(
        ensureThothStorageLayout(home, createTestLogger(), {
          onPhase(current, filePath) {
            if (current === phase && filePath === authorityPath)
              throw new Error(`injected:${phase}`);
          },
        }),
      ).rejects.toThrow(`injected:${phase}`);
      expect(sha256(authorityPath)).toBe(original);
      expect(hasTable(authorityPath, "authority_events")).toBe(true);
      expect(readdirSync(path.dirname(authorityPath)).some((name) => name.includes(".tmp-"))).toBe(
        false,
      );
      expect(
        JSON.parse(readFileSync(path.join(home, "storage-layout.json"), "utf8")),
      ).toMatchObject({
        version: 1,
      });

      await expect(ensureThothStorageLayout(home, createTestLogger())).resolves.toEqual({
        requiresProviderThreadFinalization: false,
      });
      expect(hasTable(authorityPath, "authority_events")).toBe(false);
    });
  }

  it("creates a versioned normalized schema for a fresh home", async () => {
    const root = temporaryRoot("fresh");
    const home = path.join(root, ".thoth");
    await ensureThothStorageLayout(home, createTestLogger());
    expect(schemaVersion(path.join(home, "catalog.sqlite"))).toBe(3);
    expect(JSON.parse(readFileSync(path.join(home, "storage-layout.json"), "utf8"))).toMatchObject({
      version: 3,
      migrated: false,
      workspaceCount: 0,
    });
  });

  it("upgrades normalized schema v2 catalog and authority without changing old schedule rows", async () => {
    const home = await normalizedV2Home();
    const catalogPath = path.join(home, "catalog.sqlite");
    const authorityPath = workspaceAuthorityPath(home);

    await ensureThothStorageLayout(home, createTestLogger());

    expect(schemaVersion(catalogPath)).toBe(3);
    expect(schemaVersion(authorityPath)).toBe(3);
    expect(hasTable(catalogPath, "catalog_runtime_resource_leases")).toBe(true);
    expect(tableColumns(authorityPath, "schedule_runs")).toEqual(
      expect.arrayContaining(["task_id", "execution_id"]),
    );
    expect(scheduleRunAuthority(authorityPath, "run-v2")).toEqual({
      task_id: null,
      execution_id: null,
    });
    expect(catalogMigrationRows(catalogPath)).toEqual([
      { version: 2, checksum: "normalized-catalog-v2" },
      { version: 3, checksum: "host-runtime-resources-v3" },
    ]);
    expect(
      migrationRows(authorityPath).map(({ version, checksum }) => ({ version, checksum })),
    ).toEqual([
      { version: 5, checksum: "normalized-authority-v2" },
      { version: 6, checksum: "schedule-task-execution-v3" },
    ]);
    expect(existsSync(`${catalogPath}.schema-v2.bak`)).toBe(true);
    expect(existsSync(`${authorityPath}.schema-v2.bak`)).toBe(true);
  });

  it("rolls back a failed normalized-v2 authority upgrade and succeeds on retry", async () => {
    const home = await normalizedV2Home();
    const authorityPath = workspaceAuthorityPath(home);
    const original = sha256(authorityPath);

    await expect(
      ensureThothStorageLayout(home, createTestLogger(), {
        onPhase(phase, filePath) {
          if (phase === "transformed" && filePath === authorityPath) {
            throw new Error("injected:v2-authority");
          }
        },
      }),
    ).rejects.toThrow("injected:v2-authority");

    expect(sha256(authorityPath)).toBe(original);
    expect(schemaVersion(authorityPath)).toBe(2);
    expect(tableColumns(authorityPath, "schedule_runs")).not.toContain("task_id");
    expect(JSON.parse(readFileSync(path.join(home, "storage-layout.json"), "utf8"))).toMatchObject({
      version: 2,
    });

    await expect(ensureThothStorageLayout(home, createTestLogger())).resolves.toEqual({
      requiresProviderThreadFinalization: false,
    });
    expect(schemaVersion(authorityPath)).toBe(3);
    expect(scheduleRunAuthority(authorityPath, "run-v2")).toEqual({
      task_id: null,
      execution_id: null,
    });
  });

  it("uses platform-correct durability for fresh and migrated Windows homes", async () => {
    await withProcessPlatform("win32", async () => {
      const freshHome = path.join(temporaryRoot("windows-fresh"), ".thoth");
      await ensureThothStorageLayout(freshHome, createTestLogger());
      expect(schemaVersion(path.join(freshHome, "catalog.sqlite"))).toBe(3);

      const migratedHome = releaseHome();
      const before = entityDigest(migratedHome);
      await ensureThothStorageLayout(migratedHome, createTestLogger());
      expect(entityDigest(migratedHome)).toBe(before);
      expect(schemaVersion(workspaceAuthorityPath(migratedHome))).toBe(3);
    });
  });

  it("creates fresh authority storage after pairing metadata already exists", async () => {
    const root = temporaryRoot("paired-fresh");
    const home = path.join(root, ".thoth");
    mkdirSync(home, { recursive: true });
    for (const fileName of [
      "cli-client-id",
      "config.json",
      "daemon.log",
      "daemon-keypair.json",
      "relay-credentials.json",
      "server-id",
    ]) {
      writeFileSync(path.join(home, fileName), `${fileName}\n`);
    }

    await expect(ensureThothStorageLayout(home, createTestLogger())).resolves.toEqual({
      requiresProviderThreadFinalization: false,
    });
    expect(schemaVersion(path.join(home, "catalog.sqlite"))).toBe(3);
    expect(readFileSync(path.join(home, "server-id"), "utf8")).toBe("server-id\n");
  });

  it("rejects a concurrent migration lock owned by a live process", async () => {
    const root = temporaryRoot("lock");
    const home = path.join(root, ".thoth");
    mkdirSync(home, { recursive: true });
    writeFileSync(
      `${home}.migration.lock`,
      `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`,
    );
    await expect(ensureThothStorageLayout(home, createTestLogger())).rejects.toThrow(
      "already running",
    );
  });

  it("rejects older unrecognized storage without moving or rewriting it", async () => {
    const root = temporaryRoot("old");
    const home = path.join(root, ".thoth");
    mkdirSync(path.join(home, "agents"), { recursive: true });
    const legacy = path.join(home, "agents", "legacy.json");
    writeFileSync(legacy, '{"legacy":true}\n');
    const original = sha256(legacy);
    await expect(ensureThothStorageLayout(home, createTestLogger())).rejects.toThrow(
      "older than Release 05775486",
    );
    expect(sha256(legacy)).toBe(original);
    expect(existsSync(`${home}.migration-source-v1`)).toBe(false);
  });

  it("rejects a malformed Release marker without activating a guessed schema", async () => {
    const root = temporaryRoot("malformed");
    const home = path.join(root, ".thoth");
    mkdirSync(home, { recursive: true });
    const catalogPath = path.join(home, "catalog.sqlite");
    const database = new DatabaseSync(catalogPath);
    database.exec("CREATE TABLE unknown_layout(id TEXT PRIMARY KEY)");
    database.close();
    writeFileSync(path.join(home, "storage-layout.json"), '{"version":1}\n');
    const original = sha256(catalogPath);
    await expect(ensureThothStorageLayout(home, createTestLogger())).rejects.toThrow(
      "before Release 05775486",
    );
    expect(sha256(catalogPath)).toBe(original);
  });

  it("rejects a changed Release migration ledger without rewriting authority", async () => {
    const home = releaseHome();
    const authorityPath = workspaceAuthorityPath(home);
    const database = new DatabaseSync(authorityPath);
    database
      .prepare("UPDATE authority_schema_migrations SET checksum = ? WHERE version = 4")
      .run("unknown-future-layout");
    database.close();
    const original = sha256(authorityPath);

    await expect(ensureThothStorageLayout(home, createTestLogger())).rejects.toThrow(
      "migration ledger before Release 05775486",
    );
    expect(sha256(authorityPath)).toBe(original);
    expect(hasTable(authorityPath, "authority_events")).toBe(true);
    expect(existsSync(`${authorityPath}.release-05775486.bak`)).toBe(false);
  });
});

function releaseHome(): string {
  const root = temporaryRoot("release");
  const home = path.join(root, ".thoth");
  const workspaceRoot = path.join(home, "workspaces", fixtureManifest.workspaceId);
  mkdirSync(workspaceRoot, { recursive: true });
  copyFileSync(path.join(fixtureRoot, "catalog.sqlite"), path.join(home, "catalog.sqlite"));
  copyFileSync(
    path.join(fixtureRoot, "authority.sqlite"),
    path.join(workspaceRoot, "authority.sqlite"),
  );
  writeFileSync(
    path.join(home, "storage-layout.json"),
    '{"version":1,"migrationState":"complete"}\n',
  );
  return home;
}

async function normalizedV2Home(): Promise<string> {
  const root = temporaryRoot("normalized-v2");
  const home = path.join(root, ".thoth");
  const workspaceId = fixtureManifest.workspaceId;
  const now = "2026-07-27T00:00:00.000Z";
  await ensureThothStorageLayout(home, createTestLogger());

  const catalogPath = path.join(home, "catalog.sqlite");
  const catalog = new DatabaseSync(catalogPath);
  try {
    catalog
      .prepare(
        `INSERT INTO catalog_workspaces(
           workspace_id, canonical_path, display_name, kind, created_at, updated_at
         ) VALUES (?, ?, ?, 'workspace', ?, ?)`,
      )
      .run(workspaceId, path.join(root, "workspace"), "Normalized v2", now, now);
    catalog.exec(`
      DROP TABLE catalog_runtime_resource_leases;
      DELETE FROM catalog_schema_migrations;
      INSERT INTO catalog_schema_migrations(version, checksum, applied_at)
        VALUES (2, 'normalized-catalog-v2', '${now}');
      PRAGMA user_version = 2;
    `);
  } finally {
    catalog.close();
  }

  const authorityPath = workspaceAuthorityPath(home);
  createWorkspaceDatabase(authorityPath, workspaceId);
  const authority = new DatabaseSync(authorityPath);
  try {
    authority.exec(`
      DROP INDEX schedule_runs_task_execution;
      ALTER TABLE schedule_runs DROP COLUMN task_id;
      ALTER TABLE schedule_runs DROP COLUMN execution_id;
      DELETE FROM authority_schema_migrations;
      INSERT INTO authority_schema_migrations(version, checksum, applied_at)
        VALUES (5, 'normalized-authority-v2', '${now}');
      PRAGMA user_version = 2;
    `);
    authority
      .prepare(
        `INSERT INTO schedules(
           schedule_id, name, prompt, cadence_json, target_json, status,
           created_at, updated_at, next_run_at, last_run_at, paused_at, expires_at, max_runs
         ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, NULL, NULL, NULL, NULL)`,
      )
      .run(
        "schedule-v2",
        "Old schedule",
        "Run from v2",
        JSON.stringify({ type: "cron", expression: "0 * * * *" }),
        JSON.stringify({ type: "agent", agentId: "agent-v2" }),
        now,
        now,
        now,
      );
    authority
      .prepare(
        `INSERT INTO schedule_runs(
           run_id, schedule_id, scheduled_for, started_at, ended_at,
           status, agent_id, output, error
         ) VALUES (?, ?, ?, ?, ?, 'succeeded', ?, ?, NULL)`,
      )
      .run("run-v2", "schedule-v2", now, now, now, "agent-v2", "old output");
  } finally {
    authority.close();
  }

  writeFileSync(
    path.join(home, "storage-layout.json"),
    `${JSON.stringify({ version: 2, schemaVersion: 2, migrationState: "complete" })}\n`,
  );
  return home;
}

async function withProcessPlatform<T>(
  platform: NodeJS.Platform,
  operation: () => Promise<T>,
): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(process, "platform");
  if (!descriptor) throw new Error("process.platform descriptor is unavailable");
  Object.defineProperty(process, "platform", { ...descriptor, value: platform });
  try {
    return await operation();
  } finally {
    Object.defineProperty(process, "platform", descriptor);
  }
}

function temporaryRoot(label: string): string {
  const root = mkdtempSync(path.join(tmpdir(), `thoth-storage-${label}-`));
  roots.push(root);
  return root;
}

function workspaceAuthorityPath(home: string): string {
  return path.join(home, "workspaces", fixtureManifest.workspaceId, "authority.sqlite");
}

function schemaVersion(filePath: string): number {
  const database = new DatabaseSync(filePath, { readOnly: true });
  try {
    return Number(
      (database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version,
    );
  } finally {
    database.close();
  }
}

function hasTable(filePath: string, table: string): boolean {
  const database = new DatabaseSync(filePath, { readOnly: true });
  try {
    return Boolean(
      database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table),
    );
  } finally {
    database.close();
  }
}

function tableColumns(filePath: string, table: string): string[] {
  const database = new DatabaseSync(filePath, { readOnly: true });
  try {
    return (
      database.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all() as Array<{
        name: string;
      }>
    ).map((column) => column.name);
  } finally {
    database.close();
  }
}

function scheduleRunAuthority(
  filePath: string,
  runId: string,
): { task_id: string | null; execution_id: string | null } {
  const database = new DatabaseSync(filePath, { readOnly: true });
  try {
    return database
      .prepare("SELECT task_id, execution_id FROM schedule_runs WHERE run_id = ?")
      .get(runId) as { task_id: string | null; execution_id: string | null };
  } finally {
    database.close();
  }
}

function catalogMigrationRows(filePath: string): Array<{ version: number; checksum: string }> {
  const database = new DatabaseSync(filePath, { readOnly: true });
  try {
    return database
      .prepare("SELECT version, checksum FROM catalog_schema_migrations ORDER BY version")
      .all() as Array<{ version: number; checksum: string }>;
  } finally {
    database.close();
  }
}

function entityCounts(filePath: string): Record<string, number> {
  const database = new DatabaseSync(filePath, { readOnly: true });
  try {
    return Object.fromEntries(
      (
        database
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
          .all() as Array<{ name: string }>
      )
        .filter(
          ({ name }) =>
            !name.startsWith("sqlite_") &&
            !["authority_events", "authority_schema_migrations"].includes(name),
        )
        .map(({ name }) => [
          name,
          Number(
            (
              database.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(name)}`).get() as {
                count: number;
              }
            ).count,
          ),
        ]),
    );
  } finally {
    database.close();
  }
}

function entityDigest(home: string): string {
  const hash = createHash("sha256");
  for (const filePath of [path.join(home, "catalog.sqlite"), workspaceAuthorityPath(home)]) {
    const database = new DatabaseSync(filePath, { readOnly: true });
    try {
      const tables = (
        database
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
          .all() as Array<{ name: string }>
      ).filter(
        ({ name }) =>
          !name.startsWith("sqlite_") &&
          ![
            "authority_events",
            "authority_schema_migrations",
            "catalog_schema_migrations",
            "catalog_runtime_resource_leases",
          ].includes(name),
      );
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
              name !== "schedule_runs" || (column !== "task_id" && column !== "execution_id"),
          );
        const primary = columns
          .filter((column) => column.pk > 0 && names.includes(column.name))
          .sort((left, right) => left.pk - right.pk)
          .map((column) => column.name);
        const rows = database
          .prepare(
            `SELECT ${names.map(quoteIdentifier).join(", ")} FROM ${quoteIdentifier(name)} ORDER BY ${(primary.length > 0 ? primary : names).map(quoteIdentifier).join(", ")}`,
          )
          .all();
        hash.update(JSON.stringify({ name, columns: names, rows }));
      }
    } finally {
      database.close();
    }
  }
  return hash.digest("hex");
}

function behaviorTranscript(filePath: string): unknown {
  const database = new DatabaseSync(filePath, { readOnly: true });
  try {
    const selectRows = (sql: string) =>
      (database.prepare(sql).all() as Array<Record<string, unknown>>).map(canonicalSqlRow);
    return {
      tasks: selectRows(
        `SELECT execution_mode, status, budget_strength, used_failed_reviews,
                max_failed_reviews, pending_control, revision
           FROM tasks ORDER BY created_at, task_id`,
      ),
      goals: selectRows(
        `SELECT goal_order, status, revision
           FROM task_goals ORDER BY goal_order, goal_id`,
      ),
      executionPhases: selectRows(
        `SELECT phase_kind, status, run_mode_receipt_json IS NOT NULL AS has_run_mode_receipt,
                revision
           FROM execution_attempts ORDER BY started_at, execution_id`,
      ),
      cards: selectRows(
        `SELECT kind, status, answer_digest IS NOT NULL AS answered,
                runtime_digest IS NOT NULL AS has_runtime
           FROM cards ORDER BY created_at, card_id`,
      ),
      decisions: selectRows(
        `SELECT kind, fidelity FROM human_decisions ORDER BY decided_at, decision_id`,
      ),
      attachments: selectRows(
        `SELECT status, bundle_id, instruction_attachment, tool_attachment
           FROM runtime_attachments ORDER BY attached_at, attachment_id`,
      ),
      providerThreads: selectRows(
        `SELECT adapter_id, native_handle IS NOT NULL AS has_native_handle, status,
                lineage_parent_id IS NOT NULL AS has_lineage_parent
           FROM provider_threads ORDER BY created_at, thread_id`,
      ),
      timeline: (
        database
          .prepare("SELECT seq, item_json FROM agent_timeline_rows ORDER BY agent_id, seq")
          .all() as Array<{ seq: number; item_json: string }>
      ).map((row) => {
        const item = JSON.parse(row.item_json) as Record<string, unknown>;
        const detail = item.detail as Record<string, unknown> | undefined;
        return {
          seq: Number(row.seq),
          type: item.type ?? null,
          detailType: detail?.type ?? null,
          status: item.status ?? null,
        };
      }),
      executionTimeline: (
        database
          .prepare("SELECT seq, item_json FROM timeline_entries ORDER BY execution_id, seq")
          .all() as Array<{ seq: number; item_json: string | null }>
      ).map((row) => {
        const item = row.item_json ? (JSON.parse(row.item_json) as Record<string, unknown>) : null;
        const detail = item?.detail as Record<string, unknown> | undefined;
        return {
          seq: Number(row.seq),
          type: item?.type ?? null,
          detailType: detail?.type ?? null,
          status: item?.status ?? null,
        };
      }),
    };
  } finally {
    database.close();
  }
}

function canonicalSqlRow(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [
        key,
        typeof value === "bigint"
          ? value.toString()
          : value instanceof Uint8Array
            ? Buffer.from(value).toString("base64")
            : value,
      ]),
  );
}

function migrationRows(filePath: string): Array<{
  version: number;
  checksum: string;
  applied_at: string;
}> {
  const database = new DatabaseSync(filePath, { readOnly: true });
  try {
    return database
      .prepare(
        `SELECT version, checksum, applied_at
           FROM authority_schema_migrations ORDER BY version`,
      )
      .all() as Array<{ version: number; checksum: string; applied_at: string }>;
  } finally {
    database.close();
  }
}

function onlyTaskId(filePath: string): string {
  const database = new DatabaseSync(filePath, { readOnly: true });
  try {
    const rows = database.prepare("SELECT task_id FROM tasks").all() as Array<{ task_id: string }>;
    expect(rows).toHaveLength(1);
    return rows[0]!.task_id;
  } finally {
    database.close();
  }
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function sha256(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
