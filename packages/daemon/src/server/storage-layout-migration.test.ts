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
    ]);
    expect(schemaVersion(path.join(home, "catalog.sqlite"))).toBe(2);
    expect(schemaVersion(authorityPath)).toBe(2);
    expect(hasTable(authorityPath, "authority_events")).toBe(false);
    expect(existsSync(`${path.join(home, "catalog.sqlite")}.release-05775486.bak`)).toBe(true);
    expect(existsSync(`${authorityPath}.release-05775486.bak`)).toBe(true);
    expect(readdirSync(path.dirname(authorityPath)).some((name) => /-(wal|shm)$/u.test(name))).toBe(
      false,
    );
    expect(JSON.parse(readFileSync(path.join(home, "storage-layout.json"), "utf8"))).toMatchObject({
      version: 2,
      schemaVersion: 2,
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
    expect(schemaVersion(path.join(home, "catalog.sqlite"))).toBe(2);
    expect(JSON.parse(readFileSync(path.join(home, "storage-layout.json"), "utf8"))).toMatchObject({
      version: 2,
      migrated: false,
      workspaceCount: 0,
    });
  });

  it("uses platform-correct durability for fresh and migrated Windows homes", async () => {
    await withProcessPlatform("win32", async () => {
      const freshHome = path.join(temporaryRoot("windows-fresh"), ".thoth");
      await ensureThothStorageLayout(freshHome, createTestLogger());
      expect(schemaVersion(path.join(freshHome, "catalog.sqlite"))).toBe(2);

      const migratedHome = releaseHome();
      const before = entityDigest(migratedHome);
      await ensureThothStorageLayout(migratedHome, createTestLogger());
      expect(entityDigest(migratedHome)).toBe(before);
      expect(schemaVersion(workspaceAuthorityPath(migratedHome))).toBe(2);
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
    expect(schemaVersion(path.join(home, "catalog.sqlite"))).toBe(2);
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
          ].includes(name),
      );
      for (const { name } of tables) {
        const columns = database
          .prepare(`PRAGMA table_xinfo(${quoteIdentifier(name)})`)
          .all() as Array<{
          name: string;
          pk: number;
        }>;
        const names = columns.map((column) => column.name);
        const primary = columns
          .filter((column) => column.pk > 0)
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
