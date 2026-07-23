#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const releaseCommit = "05775486ba72457f4c7f9506b217ca7c88ebd07a";
const baseline = readJson(resolve(repoRoot, "scripts/refactor-baseline.json"));
const outputRoot = resolve(repoRoot, "packages/daemon/src/test-fixtures/refactor-release-05775486");
const manifestPath = join(outputRoot, "manifest.json");
const stagingRoot = resolve(repoRoot, ".dev/refactor-release-05775486-home");
const sourceProofPaths = [
  "packages/daemon/src/server/agent/agent-storage.ts",
  "packages/daemon/src/server/workspace-authority/catalog-store.ts",
  "packages/daemon/src/server/workspace-authority/workspace-agent-storage.ts",
  "packages/daemon/src/server/workspace-authority/workspace-agent-timeline-store.ts",
  "packages/daemon/src/server/workspace-authority/workspace-authority-store.ts",
  "packages/protocol/src/task-authority.ts",
];

const mode = process.argv[2];
if (mode === "--write") {
  generateFixture();
} else if (mode === "--verify") {
  verifyFixture();
} else {
  throw new Error("Usage: refactor-storage-fixture.mjs --write | --verify");
}

function generateFixture() {
  assertReleaseEquivalentSources();
  rmSync(stagingRoot, { recursive: true, force: true });
  mkdirSync(stagingRoot, { recursive: true });
  const result = spawnSync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    [
      "run",
      "test:e2e:foreground-thoth",
      "--workspace=@thoth/daemon",
      "--",
      "--testNamePattern=UT-05",
    ],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        NO_COLOR: "1",
        THOTH_REFACTOR_RELEASE_FIXTURE_HOME: stagingRoot,
      },
      stdio: "inherit",
    },
  );
  if (result.status !== 0) {
    throw new Error(`Release fixture journey failed with ${result.signal ?? result.status}`);
  }

  const sourceHome = join(stagingRoot, ".thoth");
  const sourceCatalog = join(sourceHome, "catalog.sqlite");
  const workspaceIds = readWorkspaceIds(sourceCatalog);
  if (workspaceIds.length !== 1) {
    throw new Error(`Expected one fixture Workspace, received ${workspaceIds.join(", ")}`);
  }
  const workspaceId = workspaceIds[0];
  const sourceAuthority = join(sourceHome, "workspaces", workspaceId, "authority.sqlite");
  checkpoint(sourceCatalog);
  checkpoint(sourceAuthority);

  rmSync(outputRoot, { recursive: true, force: true });
  mkdirSync(outputRoot, { recursive: true });
  const catalogPath = join(outputRoot, "catalog.sqlite");
  const authorityPath = join(outputRoot, "authority.sqlite");
  copyFileSync(sourceCatalog, catalogPath);
  copyFileSync(sourceAuthority, authorityPath);
  finalizeFixtureDatabase(catalogPath);
  finalizeFixtureDatabase(authorityPath);

  const manifest = buildManifest({ catalogPath, authorityPath, workspaceId });
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  verifyFixture();
  console.log(
    `Wrote Release ${releaseCommit.slice(0, 8)} storage fixture (${manifest.behavior.executionPhases.length} executions).`,
  );
}

function verifyFixture() {
  if (!existsSync(manifestPath)) throw new Error(`Missing fixture manifest: ${manifestPath}`);
  const expected = readJson(manifestPath);
  const current = buildManifest({
    catalogPath: join(outputRoot, "catalog.sqlite"),
    authorityPath: join(outputRoot, "authority.sqlite"),
    workspaceId: expected.workspaceId,
  });
  if (JSON.stringify(current) !== JSON.stringify(expected)) {
    throw new Error("Release storage fixture or its canonical digest changed");
  }
  console.log(
    `Release storage fixture verified: workspace=${expected.workspaceId} digest=${expected.semanticDigest.slice(0, 12)}`,
  );
}

function buildManifest({ catalogPath, authorityPath, workspaceId }) {
  for (const path of [catalogPath, authorityPath]) {
    if (!existsSync(path)) throw new Error(`Missing fixture database: ${path}`);
    for (const suffix of ["-shm", "-wal"]) {
      if (existsSync(`${path}${suffix}`)) {
        throw new Error(`Fixture must not depend on SQLite sidecar: ${path}${suffix}`);
      }
    }
  }
  const catalog = inspectDatabase(catalogPath);
  const authority = inspectDatabase(authorityPath);
  const behavior = behaviorTranscript(authorityPath);
  return {
    schemaVersion: 1,
    releaseCommit,
    cleanBaselineCommit: baseline.commit,
    node: baseline.node,
    workspaceId,
    sourceProof: sourceProofPaths.map((path) => ({
      path,
      sha256: hash(
        execFileSync("git", ["show", `${releaseCommit}:${path}`], {
          cwd: repoRoot,
        }),
      ),
    })),
    databases: { catalog, authority },
    behavior,
    semanticDigest: hashJson(behavior),
  };
}

function inspectDatabase(path) {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    const integrity = database
      .prepare("PRAGMA integrity_check")
      .all()
      .map((row) => row.integrity_check);
    const foreignKeyFailures = database.prepare("PRAGMA foreign_key_check").all();
    if (integrity.length !== 1 || integrity[0] !== "ok") {
      throw new Error(`${path} failed integrity_check: ${JSON.stringify(integrity)}`);
    }
    if (foreignKeyFailures.length > 0) {
      throw new Error(`${path} failed foreign_key_check: ${JSON.stringify(foreignKeyFailures)}`);
    }
    const schema = database
      .prepare(
        `SELECT type, name, tbl_name, sql
           FROM sqlite_master
          WHERE name NOT LIKE 'sqlite_%'
          ORDER BY type, name`,
      )
      .all()
      .map((row) => ({
        type: row.type,
        name: row.name,
        table: row.tbl_name,
        sql: normalizeSql(row.sql),
      }));
    const tableNames = schema
      .filter((entry) => entry.type === "table")
      .map((entry) => entry.name)
      .sort();
    const tables = tableNames.map((table) => inspectTable(database, table));
    return {
      file: path.endsWith("catalog.sqlite") ? "catalog.sqlite" : "authority.sqlite",
      bytes: statSync(path).size,
      sha256: hash(readFileSync(path)),
      integrity: "ok",
      foreignKeyFailures: 0,
      schemaDigest: hashJson(schema),
      schema,
      dataDigest: hashJson(
        tables.map(({ name, count, rowDigest }) => ({ name, count, rowDigest })),
      ),
      tables,
    };
  } finally {
    database.close();
  }
}

function inspectTable(database, table) {
  const columns = database
    .prepare(`PRAGMA table_xinfo(${quoteIdentifier(table)})`)
    .all()
    .map((column) => ({
      name: column.name,
      type: column.type,
      notNull: Number(column.notnull),
      defaultValue: column.dflt_value ?? null,
      primaryKeyOrder: Number(column.pk),
      hidden: Number(column.hidden),
    }));
  const rows = database
    .prepare(`SELECT * FROM ${quoteIdentifier(table)}`)
    .all()
    .map(canonicalSqlRow)
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return {
    name: table,
    count: rows.length,
    columns,
    rowDigest: hashJson(rows),
  };
}

function behaviorTranscript(authorityPath) {
  const database = new DatabaseSync(authorityPath, { readOnly: true });
  try {
    const tasks = selectRows(
      database,
      `SELECT execution_mode, status, budget_strength, used_failed_reviews,
              max_failed_reviews, pending_control, revision
         FROM tasks ORDER BY created_at, task_id`,
    );
    const goals = selectRows(
      database,
      `SELECT goal_order, status, revision
         FROM task_goals ORDER BY goal_order, goal_id`,
    );
    const executionPhases = selectRows(
      database,
      `SELECT phase_kind, status, run_mode_receipt_json IS NOT NULL AS has_run_mode_receipt,
              revision
         FROM execution_attempts ORDER BY started_at, execution_id`,
    );
    const cards = selectRows(
      database,
      `SELECT kind, status, answer_digest IS NOT NULL AS answered,
              runtime_digest IS NOT NULL AS has_runtime
         FROM cards ORDER BY created_at, card_id`,
    );
    const decisions = selectRows(
      database,
      `SELECT kind, fidelity FROM human_decisions ORDER BY decided_at, decision_id`,
    );
    const attachments = selectRows(
      database,
      `SELECT status, bundle_id, instruction_attachment, tool_attachment
         FROM runtime_attachments ORDER BY attached_at, attachment_id`,
    );
    const providerThreads = selectRows(
      database,
      `SELECT adapter_id, native_handle IS NOT NULL AS has_native_handle, status,
              lineage_parent_id IS NOT NULL AS has_lineage_parent
         FROM provider_threads ORDER BY created_at, thread_id`,
    );
    const timeline = database
      .prepare("SELECT seq, item_json FROM agent_timeline_rows ORDER BY agent_id, seq")
      .all()
      .map((row) => {
        const item = JSON.parse(row.item_json);
        return {
          seq: Number(row.seq),
          type: item.type ?? null,
          detailType: item.detail?.type ?? null,
          status: item.status ?? null,
        };
      });
    const executionTimeline = database
      .prepare("SELECT seq, item_json FROM timeline_entries ORDER BY execution_id, seq")
      .all()
      .map((row) => {
        const item = row.item_json ? JSON.parse(row.item_json) : null;
        return {
          seq: Number(row.seq),
          type: item?.type ?? null,
          detailType: item?.detail?.type ?? null,
          status: item?.status ?? null,
        };
      });
    return {
      tasks,
      goals,
      executionPhases,
      cards,
      decisions,
      attachments,
      providerThreads,
      timeline,
      executionTimeline,
    };
  } finally {
    database.close();
  }
}

function selectRows(database, sql) {
  return database.prepare(sql).all().map(canonicalSqlRow);
}

function checkpoint(path) {
  if (!existsSync(path)) throw new Error(`Missing SQLite database: ${path}`);
  const database = new DatabaseSync(path);
  try {
    database.exec("PRAGMA optimize; PRAGMA wal_checkpoint(TRUNCATE);");
  } finally {
    database.close();
  }
  for (const suffix of ["-shm", "-wal"]) rmSync(`${path}${suffix}`, { force: true });
}

function finalizeFixtureDatabase(path) {
  const database = new DatabaseSync(path);
  try {
    database.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE; VACUUM;");
  } finally {
    database.close();
  }
  for (const suffix of ["-shm", "-wal"]) rmSync(`${path}${suffix}`, { force: true });
}

function readWorkspaceIds(catalogPath) {
  const database = new DatabaseSync(catalogPath, { readOnly: true });
  try {
    return database
      .prepare("SELECT workspace_id FROM catalog_workspaces ORDER BY workspace_id")
      .all()
      .map((row) => String(row.workspace_id));
  } finally {
    database.close();
  }
}

function assertReleaseEquivalentSources() {
  if (baseline.commit !== "743e8d29f8a3e752bd4b53af31bcf0a15a5bed14") {
    throw new Error(`Unexpected clean baseline commit: ${baseline.commit}`);
  }
  for (const path of sourceProofPaths) {
    const releaseSource = execFileSync("git", ["show", `${releaseCommit}:${path}`], {
      cwd: repoRoot,
    });
    const currentSource = readFileSync(resolve(repoRoot, path));
    if (hash(releaseSource) !== hash(currentSource)) {
      throw new Error(`${path} differs from Release ${releaseCommit.slice(0, 8)}`);
    }
  }
}

function canonicalSqlRow(row) {
  return Object.fromEntries(
    Object.entries(row)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, canonicalSqlValue(value)]),
  );
}

function canonicalSqlValue(value) {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return Buffer.from(value).toString("base64");
  return value;
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function normalizeSql(value) {
  return typeof value === "string" ? value.replace(/\s+/gu, " ").trim() : null;
}

function hashJson(value) {
  return hash(Buffer.from(JSON.stringify(value)));
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
