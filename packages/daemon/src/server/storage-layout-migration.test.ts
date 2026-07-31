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
import {
  WorkspaceAuthorityManager,
  WorkspaceForegroundAuthority,
} from "./workspace-authority/index.js";

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
    const beforeCounts = entityCounts(authorityPath);
    const beforeMigrations = migrationRows(authorityPath);

    await ensureThothStorageLayout(home, createTestLogger());

    const afterCounts = entityCounts(authorityPath);
    for (const table of [
      "agents",
      "provider_threads",
      "turns",
      "human_decisions",
      "tasks",
      "execution_attempts",
      "timeline_entries",
      "agent_timeline_rows",
      "schedules",
      "schedule_runs",
    ]) {
      expect(afterCounts[table], table).toBe(beforeCounts[table]);
    }
    expect(migrationRows(authorityPath)).toEqual([
      ...beforeMigrations,
      expect.objectContaining({ version: 5, checksum: "normalized-authority-v2" }),
      expect.objectContaining({ version: 6, checksum: "schedule-task-execution-v3" }),
      expect.objectContaining({ version: 7, checksum: "schedule-run-workspace-v4" }),
      expect.objectContaining({ version: 8, checksum: "provider-turn-interaction-v5" }),
      expect.objectContaining({ version: 9, checksum: "decision-map-task-anchor-v6" }),
      expect.objectContaining({ version: 10, checksum: "decision-session-tree-v7" }),
    ]);
    expect(schemaVersion(path.join(home, "catalog.sqlite"))).toBe(7);
    expect(schemaVersion(authorityPath)).toBe(7);
    expect(hasTable(path.join(home, "catalog.sqlite"), "catalog_runtime_resource_leases")).toBe(
      true,
    );
    expect(tableColumns(authorityPath, "schedule_runs")).toEqual(
      expect.arrayContaining(["workspace_id", "task_id", "execution_id"]),
    );
    expect(tableColumns(authorityPath, "turns")).toEqual(
      expect.arrayContaining([
        "provider_plan_receipt_json",
        "provider_interaction_json",
        "provider_interaction_revision",
      ]),
    );
    expect(hasTable(authorityPath, "authority_events")).toBe(false);
    expect(hasTable(authorityPath, "task_goals")).toBe(false);
    expect(hasTable(authorityPath, "task_blackboard")).toBe(false);
    expect(hasTable(authorityPath, "phase_runs")).toBe(false);
    expect(hasTable(authorityPath, "intent_contracts")).toBe(true);
    expect(hasTable(authorityPath, "task_working_sets")).toBe(true);
    expect(hasTable(authorityPath, "task_work_units")).toBe(true);
    expect(hasTable(authorityPath, "decision_sessions")).toBe(true);
    expect(hasTable(authorityPath, "decision_tree_nodes")).toBe(true);
    expect(hasTable(authorityPath, "clarify_sessions")).toBe(false);
    expect(hasTable(authorityPath, "clarify_decision_nodes")).toBe(false);
    expect(existsSync(`${path.join(home, "catalog.sqlite")}.release-05775486.bak`)).toBe(true);
    expect(existsSync(`${authorityPath}.release-05775486.bak`)).toBe(true);
    expect(readdirSync(path.dirname(authorityPath)).some((name) => /-(wal|shm)$/u.test(name))).toBe(
      false,
    );
    expect(JSON.parse(readFileSync(path.join(home, "storage-layout.json"), "utf8"))).toMatchObject({
      version: 7,
      schemaVersion: 7,
      sourceRelease: "05775486",
      migrated: true,
      migrationState: "complete",
    });

    const authority = new WorkspaceAuthorityManager(home);
    const taskId = onlyTaskId(authorityPath);
    expect(authority.forWorkspace(fixtureManifest.workspaceId).getTask(taskId)).toMatchObject({
      status: "completed",
      completionAuthority: "legacy",
      intentContract: {
        status: "legacy",
        acceptanceClaims: [expect.objectContaining({ status: "satisfied" })],
      },
    });
    expect(
      JSON.stringify(authority.forWorkspace(fixtureManifest.workspaceId).getTask(taskId)),
    ).not.toContain('"goals"');
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
    expect(schemaVersion(path.join(home, "catalog.sqlite"))).toBe(7);
    expect(JSON.parse(readFileSync(path.join(home, "storage-layout.json"), "utf8"))).toMatchObject({
      version: 7,
      migrated: false,
      workspaceCount: 0,
    });
  });

  it("atomically upgrades a schema-v6 active Card and deterministic multi-parent Decision Map", async () => {
    const fixture = await decisionMapV6Home();
    const authorityPath = workspaceAuthorityPath(fixture.home);

    await ensureThothStorageLayout(fixture.home, createTestLogger());

    expect(schemaVersion(authorityPath)).toBe(7);
    expect(hasTable(authorityPath, "clarify_sessions")).toBe(false);
    expect(hasTable(authorityPath, "clarify_decision_nodes")).toBe(false);
    expect(existsSync(`${authorityPath}.schema-v6.bak`)).toBe(true);
    const manager = new WorkspaceAuthorityManager(fixture.home);
    try {
      const authority = new WorkspaceForegroundAuthority(manager);
      const tree = authority.getDecisionTree(fixture.agentId, fixture.sessionId);
      expect(tree).toMatchObject({
        session: {
          id: fixture.sessionId,
          lifecycle: "awaiting_human",
          activeCardId: fixture.cardId,
          activity: { state: "awaiting_human", activeNodeId: "language" },
        },
        cardReceipts: [expect.objectContaining({ cardId: fixture.cardId, status: "pending" })],
      });
      expect(tree?.nodes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: `decision-root-${fixture.sessionId}`, parentId: null }),
          expect.objectContaining({
            id: "language",
            parentId: "product-boundary",
            crossLinkIds: ["risk-boundary"],
          }),
        ]),
      );
      expect(authority.getState(fixture.agentId)).toMatchObject({
        lifecycle: "awaiting_card",
        pendingCard: { card: { id: fixture.cardId } },
      });
    } finally {
      manager.close();
    }

    const activatedDigest = sha256(authorityPath);
    await expect(ensureThothStorageLayout(fixture.home, createTestLogger())).resolves.toEqual({
      requiresProviderThreadFinalization: false,
    });
    expect(sha256(authorityPath)).toBe(activatedDigest);
  });

  it("preserves and resumes the exact schema-v6 Decision Map source after an interrupted activation", async () => {
    const fixture = await decisionMapV6Home();
    const authorityPath = workspaceAuthorityPath(fixture.home);
    const original = sha256(authorityPath);
    await expect(
      ensureThothStorageLayout(fixture.home, createTestLogger(), {
        onPhase(phase, filePath) {
          if (phase === "before_activate" && filePath === authorityPath) {
            throw new Error("injected:v6-before-activate");
          }
        },
      }),
    ).rejects.toThrow("injected:v6-before-activate");
    expect(sha256(authorityPath)).toBe(original);
    expect(hasTable(authorityPath, "clarify_sessions")).toBe(true);
    expect(hasTable(authorityPath, "decision_sessions")).toBe(false);

    await ensureThothStorageLayout(fixture.home, createTestLogger());
    expect(hasTable(authorityPath, "clarify_sessions")).toBe(false);
    expect(hasTable(authorityPath, "decision_sessions")).toBe(true);
  });

  it("creates fresh authority storage when Desktop attachments exist before daemon startup", async () => {
    const root = temporaryRoot("desktop-attachments-fresh");
    const home = path.join(root, ".thoth");
    const attachment = path.join(home, "desktop-attachments", "pending.txt");
    mkdirSync(path.dirname(attachment), { recursive: true });
    writeFileSync(attachment, "pending desktop attachment\n");

    await expect(ensureThothStorageLayout(home, createTestLogger())).resolves.toEqual({
      requiresProviderThreadFinalization: false,
    });
    expect(schemaVersion(path.join(home, "catalog.sqlite"))).toBe(7);
    expect(readFileSync(attachment, "utf8")).toBe("pending desktop attachment\n");
  });

  it("uses platform-correct durability for fresh and migrated Windows homes", async () => {
    await withProcessPlatform("win32", async () => {
      const freshHome = path.join(temporaryRoot("windows-fresh"), ".thoth");
      await ensureThothStorageLayout(freshHome, createTestLogger());
      expect(schemaVersion(path.join(freshHome, "catalog.sqlite"))).toBe(7);

      const migratedHome = releaseHome();
      const before = entityCounts(workspaceAuthorityPath(migratedHome));
      await ensureThothStorageLayout(migratedHome, createTestLogger());
      const after = entityCounts(workspaceAuthorityPath(migratedHome));
      expect(after.tasks).toBe(before.tasks);
      expect(after.execution_attempts).toBe(before.execution_attempts);
      expect(schemaVersion(workspaceAuthorityPath(migratedHome))).toBe(7);
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
    expect(schemaVersion(path.join(home, "catalog.sqlite"))).toBe(7);
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
      ALTER TABLE schedule_runs DROP COLUMN workspace_id;
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

async function decisionMapV6Home(): Promise<{
  home: string;
  agentId: string;
  sessionId: string;
  cardId: string;
}> {
  const root = temporaryRoot("decision-map-v6");
  const home = path.join(root, ".thoth");
  const workspaceId = fixtureManifest.workspaceId;
  const agentId = "agent-v6-map";
  const cardId = "card-v6-active";
  const now = "2026-07-30T12:00:00.000Z";
  await ensureThothStorageLayout(home, createTestLogger());
  const manager = new WorkspaceAuthorityManager(home);
  manager.catalog.upsertWorkspace({
    id: workspaceId,
    canonicalPath: path.join(root, "workspace"),
    displayName: "Decision Map v6",
    kind: "workspace",
    parentWorkspaceId: null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  });
  const authority = new WorkspaceForegroundAuthority(manager);
  const started = authority.startTurn({
    agentId,
    kind: "thoth",
    controls: { mode: "quick", clarifyStrength: "dive", loop: null },
    sourceMessageId: "message-v6-map",
    workspaceId,
    workspacePath: path.join(root, "workspace"),
    userText: "Design the durable provider-neutral runtime.",
  });
  const created = authority.startDecisionSession({
    agentId,
    turnId: started.turn.id,
    requestedStrength: "dive",
  });
  authority.updateDecisionTree({
    agentId,
    sessionId: created.session.id,
    update: {
      effectiveStrength: "dive",
      activity: "expanding",
      activeNodeId: "language",
      publicSummary: "The implementation language remains Human-owned.",
      nodes: [
        {
          id: "language",
          parentId: created.session.rootNodeId,
          crossLinkIds: [],
          title: "Implementation language",
          summary: "Choose the public implementation boundary.",
          owner: "human",
          materiality: "structural",
          status: "open",
          resolutionRef: null,
          sourceRefs: [],
        },
      ],
    },
  });
  authority.openCard({
    agentId,
    turnId: started.turn.id,
    generation: started.turn.generation,
    card: {
      kind: "clarify_card",
      card: {
        id: cardId,
        sessionId: created.session.id,
        roundIndex: 1,
        submitted: false,
        card: {
          title: "Choose implementation language",
          whyNow: "This changes the public product boundary.",
          publicSummary: "Waiting for the implementation language decision.",
          questions: [
            {
              nodeId: "language",
              question: "Which public implementation boundary should be frozen?",
              selectionMode: "single",
              choices: [
                { id: "typescript", label: "TypeScript" },
                { id: "rust", label: "Rust" },
              ],
              recommendedChoiceId: "typescript",
            },
          ],
          allowChoiceNotes: true,
          allowNoteOnly: true,
          allowSingleNodeRecommendation: true,
          allowSubtreeDelegation: true,
        },
      },
    },
    runtime: {
      provider: "fixture",
      threadId: "thread-v6",
      providerTurnId: "provider-turn-v6",
      callId: "call-v6",
      toolName: "thoth_clarify_ask",
      redactedRawInputHash: `sha256:${"a".repeat(64)}`,
    },
    decisionSession: { sessionId: created.session.id, awaitingNodeIds: ["language"] },
  });
  manager.close();

  const authorityPath = workspaceAuthorityPath(home);
  const database = new DatabaseSync(authorityPath);
  try {
    database.exec(`
      PRAGMA foreign_keys = OFF;
      BEGIN IMMEDIATE;
      DROP TABLE decision_tree_activity;
      DROP TABLE decision_tree_cross_links;
      DROP TABLE decision_tree_nodes;
      DROP TABLE decision_session_turns;
      DROP TABLE decision_sessions;
      CREATE TABLE clarify_sessions (
        session_id TEXT PRIMARY KEY NOT NULL,
        workspace_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        turn_id TEXT NOT NULL UNIQUE,
        requested_strength TEXT NOT NULL,
        effective_strength TEXT,
        lifecycle TEXT NOT NULL,
        challenger_used INTEGER NOT NULL CHECK(challenger_used IN (0, 1)),
        priority_node_id TEXT,
        intent_contract_id TEXT,
        revision INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(agent_id) REFERENCES agents(agent_id) ON DELETE CASCADE,
        FOREIGN KEY(turn_id) REFERENCES turns(turn_id) ON DELETE CASCADE
      ) STRICT;
      CREATE TABLE clarify_decision_nodes (
        node_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        parent_ids_json TEXT NOT NULL,
        title TEXT NOT NULL,
        owner TEXT NOT NULL CHECK(owner IN ('human', 'agent', 'evidence')),
        materiality TEXT NOT NULL CHECK(materiality IN ('structural', 'material', 'local')),
        status TEXT NOT NULL CHECK(status IN ('open', 'awaiting_human', 'resolved', 'delegated', 'pruned')),
        resolution_ref TEXT,
        source_refs_json TEXT NOT NULL,
        priority INTEGER NOT NULL,
        revision INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(session_id, node_id),
        FOREIGN KEY(session_id) REFERENCES clarify_sessions(session_id) ON DELETE CASCADE
      ) STRICT;
      DELETE FROM authority_schema_migrations;
      INSERT INTO authority_schema_migrations(version, checksum, applied_at)
        VALUES (9, 'decision-map-task-anchor-v6', '${now}');
      PRAGMA user_version = 6;
      COMMIT;
    `);
    database
      .prepare(
        `INSERT INTO clarify_sessions(
           session_id, workspace_id, agent_id, turn_id, requested_strength, effective_strength,
           lifecycle, challenger_used, priority_node_id, intent_contract_id, revision,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, 'dive', 'dive', 'awaiting_human', 0, 'language', NULL, 7, ?, ?)`,
      )
      .run(created.session.id, workspaceId, agentId, started.turn.id, now, now);
    const insertNode = database.prepare(
      `INSERT INTO clarify_decision_nodes(
         node_id, session_id, parent_ids_json, title, owner, materiality, status,
         resolution_ref, source_refs_json, priority, revision, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    );
    insertNode.run(
      "product-boundary",
      created.session.id,
      "[]",
      "Product boundary",
      "human",
      "structural",
      "resolved",
      "decision:product",
      "[]",
      4,
      now,
      now,
    );
    insertNode.run(
      "risk-boundary",
      created.session.id,
      "[]",
      "Risk boundary",
      "human",
      "structural",
      "resolved",
      "decision:risk",
      "[]",
      3,
      now,
      now,
    );
    insertNode.run(
      "language",
      created.session.id,
      JSON.stringify(["product-boundary", "risk-boundary"]),
      "Implementation language",
      "human",
      "structural",
      "awaiting_human",
      null,
      "[]",
      2,
      now,
      now,
    );
  } finally {
    database.close();
  }

  const catalog = new DatabaseSync(path.join(home, "catalog.sqlite"));
  try {
    catalog.exec(`
      DELETE FROM catalog_schema_migrations;
      INSERT INTO catalog_schema_migrations(version, checksum, applied_at)
        VALUES (6, 'decision-map-task-anchor-v6-catalog', '${now}');
      PRAGMA user_version = 6;
    `);
  } finally {
    catalog.close();
  }
  writeFileSync(
    path.join(home, "storage-layout.json"),
    `${JSON.stringify({ version: 6, schemaVersion: 6, migrationState: "complete" })}\n`,
  );
  return { home, agentId, sessionId: created.session.id, cardId };
}

async function normalizedV3Home(): Promise<string> {
  const root = temporaryRoot("normalized-v3");
  const home = path.join(root, ".thoth");
  const workspaceId = fixtureManifest.workspaceId;
  const now = "2026-07-28T00:00:00.000Z";
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
      .run(workspaceId, path.join(root, "workspace"), "Normalized v3", now, now);
    catalog.exec(`
      DELETE FROM catalog_schema_migrations;
      INSERT INTO catalog_schema_migrations(version, checksum, applied_at)
        VALUES (2, 'normalized-catalog-v2', '${now}');
      INSERT INTO catalog_schema_migrations(version, checksum, applied_at)
        VALUES (3, 'host-runtime-resources-v3', '${now}');
      PRAGMA user_version = 3;
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
      ALTER TABLE schedule_runs DROP COLUMN workspace_id;
      DELETE FROM authority_schema_migrations;
      INSERT INTO authority_schema_migrations(version, checksum, applied_at)
        VALUES (5, 'normalized-authority-v2', '${now}');
      INSERT INTO authority_schema_migrations(version, checksum, applied_at)
        VALUES (6, 'schedule-task-execution-v3', '${now}');
      PRAGMA user_version = 3;
    `);
    authority
      .prepare(
        `INSERT INTO schedules(
           schedule_id, name, prompt, cadence_json, target_json, status,
           created_at, updated_at, next_run_at, last_run_at, paused_at, expires_at, max_runs
         ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, NULL, NULL, NULL, NULL)`,
      )
      .run(
        "schedule-v3",
        "Schema v3 schedule",
        "Run from v3",
        JSON.stringify({ type: "every", everyMs: 60_000 }),
        JSON.stringify({ type: "agent", agentId: "agent-v3" }),
        now,
        now,
        now,
      );
    authority
      .prepare(
        `INSERT INTO schedule_runs(
           run_id, schedule_id, task_id, execution_id, scheduled_for, started_at, ended_at,
           status, agent_id, output, error
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'succeeded', ?, ?, NULL)`,
      )
      .run(
        "run-v3",
        "schedule-v3",
        "task-v3",
        "execution-v3",
        now,
        now,
        now,
        "agent-v3",
        "v3 output",
      );
  } finally {
    authority.close();
  }

  writeFileSync(
    path.join(home, "storage-layout.json"),
    `${JSON.stringify({ version: 3, schemaVersion: 3, migrationState: "complete" })}\n`,
  );
  return home;
}

async function normalizedV4Home(): Promise<string> {
  const root = temporaryRoot("normalized-v4");
  const home = path.join(root, ".thoth");
  const workspaceId = fixtureManifest.workspaceId;
  const now = "2026-07-29T00:00:00.000Z";
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
      .run(workspaceId, path.join(root, "workspace"), "Normalized v4", now, now);
    catalog.exec(`
      DELETE FROM catalog_schema_migrations;
      INSERT INTO catalog_schema_migrations(version, checksum, applied_at)
        VALUES (2, 'normalized-catalog-v2', '${now}');
      INSERT INTO catalog_schema_migrations(version, checksum, applied_at)
        VALUES (3, 'host-runtime-resources-v3', '${now}');
      INSERT INTO catalog_schema_migrations(version, checksum, applied_at)
        VALUES (4, 'schedule-run-workspace-v4-catalog', '${now}');
      PRAGMA user_version = 4;
    `);
  } finally {
    catalog.close();
  }

  const authorityPath = workspaceAuthorityPath(home);
  createWorkspaceDatabase(authorityPath, workspaceId);
  const authority = new DatabaseSync(authorityPath);
  try {
    authority.exec(`
      ALTER TABLE turns DROP COLUMN provider_plan_receipt_json;
      ALTER TABLE turns DROP COLUMN provider_interaction_json;
      ALTER TABLE turns DROP COLUMN provider_interaction_revision;
      DELETE FROM authority_schema_migrations;
      INSERT INTO authority_schema_migrations(version, checksum, applied_at)
        VALUES (5, 'normalized-authority-v2', '${now}');
      INSERT INTO authority_schema_migrations(version, checksum, applied_at)
        VALUES (6, 'schedule-task-execution-v3', '${now}');
      INSERT INTO authority_schema_migrations(version, checksum, applied_at)
        VALUES (7, 'schedule-run-workspace-v4', '${now}');
      INSERT INTO agents(
        agent_id, visible, authority_revision, thoth_lifecycle, created_at, updated_at
      ) VALUES ('agent-v4', 1, 1, 'done', '${now}', '${now}');
      INSERT INTO turns(
        turn_id, agent_id, generation, status, turn_kind, provider_run_mode,
        workspace_path, created_at, updated_at
      ) VALUES (
        'turn-v4', 'agent-v4', 'generation-v4', 'done', 'raw', 'default',
        '/tmp/workspace-v4', '${now}', '${now}'
      );
      PRAGMA user_version = 4;
    `);
  } finally {
    authority.close();
  }
  writeFileSync(
    path.join(home, "storage-layout.json"),
    `${JSON.stringify({ version: 4, schemaVersion: 4, migrationState: "complete" })}\n`,
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
): { workspace_id: string | null; task_id: string | null; execution_id: string | null } {
  const database = new DatabaseSync(filePath, { readOnly: true });
  try {
    return database
      .prepare("SELECT workspace_id, task_id, execution_id FROM schedule_runs WHERE run_id = ?")
      .get(runId) as {
      workspace_id: string | null;
      task_id: string | null;
      execution_id: string | null;
    };
  } finally {
    database.close();
  }
}

function foregroundTurnInteractionDefaults(filePath: string, turnId: string): unknown {
  const database = new DatabaseSync(filePath, { readOnly: true });
  try {
    return database
      .prepare(
        `SELECT provider_plan_receipt_json, provider_interaction_json,
                provider_interaction_revision
           FROM turns WHERE turn_id = ?`,
      )
      .get(turnId);
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
              (name !== "schedule_runs" ||
                (column !== "workspace_id" && column !== "task_id" && column !== "execution_id")) &&
              (name !== "turns" ||
                ![
                  "provider_plan_receipt_json",
                  "provider_interaction_json",
                  "provider_interaction_revision",
                ].includes(column)),
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
