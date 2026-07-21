import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  defineHarnessCapabilities,
  HarnessAdapterRegistry,
  type HarnessAdapter,
} from "@thoth/drivers/harness";
import { createTestLogger } from "../test-utils/test-logger.js";
import { AgentStorage } from "./agent/agent-storage.js";
import { SqliteAgentTimelineStore } from "./agent/sqlite-agent-timeline-store.js";
import {
  FileBackedProjectRegistry,
  FileBackedWorkspaceRegistry,
  createPersistedProjectRecord,
  createPersistedWorkspaceRecord,
} from "./workspace-registry.js";
import {
  ensureThothStorageLayout,
  finalizeThothStorageLayoutMigration,
} from "./storage-layout-migration.js";
import {
  WorkspaceAgentStorage,
  WorkspaceAgentTimelineStore,
  WorkspaceAuthorityManager,
} from "./workspace-authority/index.js";

const roots: string[] = [];

function createMigrationAdapter(): HarnessAdapter {
  return {
    id: "codex",
    capabilities: () => defineHarnessCapabilities({ toolAttachment: ["native"] }),
    createThread: async () => {
      throw new Error("not used");
    },
    resumeThread: async ({ descriptor }) => descriptor,
    attachRuntimeBundle: async () => {
      throw new Error("not used");
    },
    startExecution: async () => {
      throw new Error("not used");
    },
    continueExecution: async () => {
      throw new Error("not used");
    },
    interruptExecution: async () => {},
    subscribeEvents: () => () => {},
    describePersistence: async (thread) => thread.persistence,
    archiveThread: async () => {},
    deleteOwnedThread: async () => {},
    inspectLegacyThread: async ({ metadata }) => ({
      resumable: true,
      nativeHandle: String(metadata.nativeHandle),
      metadata,
    }),
    adoptNativeThread: async ({ inspection, workspaceId, workspacePath }) => ({
      id: "adopted-thread",
      adapterId: "codex",
      nativeHandle: inspection.nativeHandle,
      persistence: {
        agentId: "internal-adopted",
        profile: inspection.metadata.profile,
        providerHandle: inspection.metadata.providerHandle,
        workspaceId,
        workspacePath,
      },
    }),
    verifyResume: async () => true,
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Thoth storage layout migration", () => {
  it("atomically imports legacy Workspace, Agent, timeline and Loop truth", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "thoth-storage-migration-"));
    roots.push(root);
    const thothHome = path.join(root, ".thoth");
    const logger = createTestLogger();
    const createdAt = "2026-07-20T00:00:00.000Z";
    const projects = new FileBackedProjectRegistry(
      path.join(thothHome, "projects", "projects.json"),
      logger,
    );
    const workspaces = new FileBackedWorkspaceRegistry(
      path.join(thothHome, "projects", "workspaces.json"),
      logger,
    );
    const project = createPersistedProjectRecord({
      projectId: "project-legacy",
      rootPath: path.join(root, "workspace"),
      kind: "git",
      displayName: "Legacy Project",
      createdAt,
      updatedAt: createdAt,
    });
    const workspace = createPersistedWorkspaceRecord({
      workspaceId: "workspace-legacy",
      projectId: project.projectId,
      cwd: project.rootPath,
      kind: "local_checkout",
      displayName: "main",
      title: "Legacy MVP",
      createdAt,
      updatedAt: createdAt,
    });
    await projects.upsert(project);
    await workspaces.upsert(workspace);
    writeFileSync(path.join(thothHome, "config.json"), '{"appendSystemPrompt":"legacy"}\n');

    const agents = new AgentStorage(path.join(thothHome, "agents"), logger);
    await agents.upsert({
      id: "agent-legacy",
      provider: "codex",
      cwd: workspace.cwd,
      workspaceId: workspace.workspaceId,
      createdAt,
      updatedAt: createdAt,
      labels: {},
      lastStatus: "idle",
      persistence: {
        provider: "codex",
        sessionId: "session-legacy",
        nativeHandle: "thread-legacy",
      },
    });
    const timeline = new SqliteAgentTimelineStore(thothHome);
    timeline.bindAgentWorkspace("agent-legacy", workspace.workspaceId);
    await timeline.bulkInsert("agent-legacy", [
      {
        seq: 1,
        timestamp: createdAt,
        item: { type: "assistant_message", text: "legacy timeline" },
      },
    ]);
    timeline.close();

    const loopRoot = path.join(thothHome, "thoth-loop");
    mkdirSync(loopRoot, { recursive: true });
    const loopDatabasePath = path.join(loopRoot, "authority.sqlite");
    const loopDatabase = new DatabaseSync(loopDatabasePath);
    loopDatabase.exec(`
      CREATE TABLE loop_task_projections (
        task_id TEXT PRIMARY KEY NOT NULL,
        revision INTEGER NOT NULL,
        projection_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
    `);
    const taskCard = {
      id: "task-card-legacy",
      roundLabel: "Task",
      title: "Migrate Loop",
      goal: "Preserve the approved Loop task.",
      constraints: ["No data loss"],
      acceptance: ["Task remains inspectable"],
      provenanceSummary: "Approved by the user.",
      submitted: true,
      submittedSummary: "Approved",
    };
    const goalsCard = {
      id: "goals-card-legacy",
      roundLabel: "Goals",
      title: "Migration goals",
      summary: "Preserve one goal.",
      goals: [
        {
          id: "goal-legacy",
          order: 1,
          title: "Import truth",
          goal: "Import task truth.",
          constraints: ["No duplicate"],
          acceptance: ["Task exists in authority.sqlite"],
          provenance: "Approved Task Card",
        },
      ],
      provenanceSummary: "Approved by the user.",
      submitted: true,
      submittedSummary: "Approved",
    };
    const projection = {
      id: "task-legacy",
      title: taskCard.title,
      workspaceName: "Legacy MVP",
      workspacePath: workspace.cwd,
      sourceAgentId: "agent-legacy",
      sourceGoalsCardId: goalsCard.id,
      status: "paused",
      summary: "Paused by the user.",
      loopStrength: "light",
      budget: { loopStrength: "light", maxFailedReviews: 5, usedFailedReviews: 1 },
      currentGoalId: "goal-legacy",
      currentPhase: null,
      goalRound: 1,
      globalFailureCount: 1,
      goals: [
        {
          ...goalsCard.goals[0],
          status: "paused",
          round: 1,
          phases: [
            {
              phase: "planexec",
              status: "completed",
              round: 1,
              phaseRunId: "legacy-planexec",
              agentId: "agent-legacy",
              startedAt: createdAt,
              completedAt: createdAt,
              summary: "Legacy PlanExec completed.",
            },
          ],
        },
      ],
      taskCard,
      goalsCard,
      providerBinding: { provider: "codex", model: "gpt-test" },
      createdAt,
      updatedAt: createdAt,
      authorityRevision: 3,
    };
    loopDatabase
      .prepare(
        `INSERT INTO loop_task_projections(
           task_id, revision, projection_json, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(projection.id, 3, JSON.stringify(projection), createdAt, createdAt);
    loopDatabase.close();

    const foregroundRoot = path.join(thothHome, "foreground-thoth");
    mkdirSync(foregroundRoot, { recursive: true });
    const foregroundDatabase = new DatabaseSync(path.join(foregroundRoot, "authority.sqlite"));
    foregroundDatabase.exec(`
      CREATE TABLE foreground_agents (
        agent_id TEXT PRIMARY KEY, revision INTEGER, active_turn_id TEXT,
        lifecycle TEXT, background_task_id TEXT, error TEXT, updated_at TEXT
      );
      CREATE TABLE foreground_turns (
        turn_id TEXT PRIMARY KEY, agent_id TEXT, generation TEXT, turn_kind TEXT,
        lifecycle TEXT, controls_json TEXT, source_message_id TEXT, workspace_id TEXT,
        workspace_path TEXT, user_text TEXT, provider_turn_id TEXT,
        background_task_id TEXT, error TEXT, started_at TEXT, updated_at TEXT
      );
      CREATE TABLE foreground_cards (
        card_id TEXT PRIMARY KEY, turn_id TEXT, agent_id TEXT, card_kind TEXT,
        status TEXT, card_json TEXT, answer_json TEXT, submitted_summary TEXT,
        runtime_json TEXT, created_at TEXT, updated_at TEXT
      );
      CREATE TABLE foreground_commands (
        command_id TEXT PRIMARY KEY, agent_id TEXT, card_id TEXT,
        response_json TEXT, created_at TEXT
      );
    `);
    foregroundDatabase
      .prepare(`INSERT INTO foreground_agents VALUES (?, 2, ?, 'done', ?, NULL, ?)`)
      .run("agent-legacy", "turn-legacy", projection.id, createdAt);
    foregroundDatabase
      .prepare(
        `INSERT INTO foreground_turns VALUES (
           ?, ?, ?, 'thoth', 'done', ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?
         )`,
      )
      .run(
        "turn-legacy",
        "agent-legacy",
        "generation-legacy",
        JSON.stringify({ mode: "loop", clarifyStrength: "light", loop: "light" }),
        "message-legacy",
        workspace.workspaceId,
        workspace.cwd,
        "Legacy user request",
        "provider-turn-legacy",
        projection.id,
        createdAt,
        createdAt,
      );
    const cardAnswer = {
      intent: "accept_loop",
      card_id: taskCard.id,
      title: taskCard.title,
      raw_answer: "Approved",
    };
    foregroundDatabase
      .prepare(
        `INSERT INTO foreground_cards VALUES (
           ?, ?, ?, 'task_card', 'answered', ?, ?, ?, ?, ?, ?
         )`,
      )
      .run(
        taskCard.id,
        "turn-legacy",
        "agent-legacy",
        JSON.stringify(taskCard),
        JSON.stringify(cardAnswer),
        "Approved",
        JSON.stringify({
          provider: "codex",
          threadId: "thread-legacy",
          providerTurnId: "provider-turn-legacy",
          callId: "call-legacy",
          toolName: "thoth_submit_task_card",
          redactedRawInputHash: "sha256:legacy",
        }),
        createdAt,
        createdAt,
      );
    foregroundDatabase
      .prepare("INSERT INTO foreground_commands VALUES (?, ?, ?, ?, ?)")
      .run("command-legacy", "agent-legacy", taskCard.id, "{}", createdAt);
    foregroundDatabase.close();

    mkdirSync(path.join(thothHome, "chat"), { recursive: true });
    writeFileSync(
      path.join(thothHome, "chat", "rooms.json"),
      `${JSON.stringify({
        rooms: [
          {
            id: "room-legacy",
            name: "legacy-room",
            purpose: "Preserve coordination history",
            createdAt,
            updatedAt: createdAt,
          },
        ],
        messages: [
          {
            id: "message-legacy",
            roomId: "room-legacy",
            authorAgentId: "agent-legacy",
            body: "Legacy coordination message",
            replyToMessageId: null,
            mentionAgentIds: [],
            createdAt,
          },
        ],
      })}\n`,
    );
    mkdirSync(path.join(thothHome, "schedules"), { recursive: true });
    writeFileSync(
      path.join(thothHome, "schedules", "schedule-legacy.json"),
      `${JSON.stringify({
        id: "schedule-legacy",
        name: "Legacy schedule",
        prompt: "Continue the legacy work",
        cadence: { type: "every", everyMs: 60_000 },
        target: {
          type: "new-agent",
          config: { provider: "codex", cwd: workspace.cwd },
        },
        status: "paused",
        createdAt,
        updatedAt: createdAt,
        nextRunAt: null,
        lastRunAt: null,
        pausedAt: createdAt,
        expiresAt: null,
        maxRuns: null,
        runs: [],
      })}\n`,
    );

    const preparation = await ensureThothStorageLayout(thothHome, logger);
    expect(preparation.requiresProviderThreadFinalization).toBe(true);
    const migrationAuthority = new WorkspaceAuthorityManager(thothHome);
    const migrationStore = migrationAuthority.forWorkspace(workspace.workspaceId);
    const preparedTask = migrationStore.getTask("task-legacy");
    const preparedGoalId = preparedTask?.goals[0]?.id;
    expect(preparedGoalId).toBeTruthy();
    migrationStore.importLegacyExecution({
      taskId: "task-legacy",
      goalId: preparedGoalId!,
      executionId: "execution-legacy-review",
      phaseRunId: "phase-run-legacy-review",
      phase: "review",
      providerThreadId: "provider-thread-legacy-review",
      adapterId: "codex",
      providerThreadNativeHandle: "thread-legacy-review",
      providerThreadPersistence: {
        legacyRootRelative: "../outside-migration-source",
        nativeHandle: "thread-legacy-review",
        profile: {},
        providerHandle: { provider: "codex", sessionId: "thread-legacy-review" },
      },
      providerThreadStatus: "legacy_pending_adoption",
      status: "interrupted",
      generation: "generation-legacy-review",
      startedAt: "2026-07-21T00:00:00.000Z",
      completedAt: "2026-07-21T00:01:00.000Z",
      summary: "Interrupted legacy Review",
      semanticHistory: { migrated: true },
    });
    const adapters = new HarnessAdapterRegistry();
    adapters.register(createMigrationAdapter());
    await expect(
      finalizeThothStorageLayoutMigration({
        thothHome,
        logger,
        authority: migrationAuthority,
        adapters,
      }),
    ).rejects.toThrow("escapes migration source");
    expect(existsSync(`${thothHome}.migration-source-v1`)).toBe(true);
    expect(migrationStore.listProviderThreadsByStatus("resumable")).toHaveLength(1);
    expect(migrationStore.listProviderThreadsByStatus("legacy_pending_adoption")).toHaveLength(1);
    migrationStore.updateProviderThread({
      threadId: "provider-thread-legacy-review",
      nativeHandle: "thread-legacy-review",
      persistence: {
        legacyRootRelative: "provider-sessions/legacy-review",
        nativeHandle: "thread-legacy-review",
        profile: {},
        providerHandle: { provider: "codex", sessionId: "thread-legacy-review" },
      },
      status: "legacy_pending_adoption",
    });
    await finalizeThothStorageLayoutMigration({
      thothHome,
      logger,
      authority: migrationAuthority,
      adapters,
    });
    migrationAuthority.close();

    expect(existsSync(`${thothHome}.migration-source-v1`)).toBe(false);
    expect(existsSync(path.join(thothHome, "agents"))).toBe(false);
    expect(existsSync(path.join(thothHome, "agent-timeline"))).toBe(false);
    expect(existsSync(path.join(thothHome, "projects"))).toBe(false);
    expect(existsSync(path.join(thothHome, "chat"))).toBe(false);
    expect(existsSync(path.join(thothHome, "schedules"))).toBe(false);
    expect(
      JSON.parse(readFileSync(path.join(thothHome, "storage-layout.json"), "utf8")),
    ).toMatchObject({
      version: 1,
      migrated: true,
      counts: {
        agents: 1,
        timelineRows: 1,
        foregroundTurns: 1,
        humanDecisions: 1,
        tasks: 1,
        providerThreadsAdopted: 2,
        providerThreadsReplaced: 0,
        chatRooms: 1,
        chatMessages: 1,
        schedules: 1,
        scheduleRuns: 0,
      },
    });
    expect(readFileSync(path.join(thothHome, "config.json"), "utf8")).toContain("legacy");

    const authority = new WorkspaceAuthorityManager(thothHome);
    const migratedAgents = new WorkspaceAgentStorage(authority);
    const migratedTimeline = new WorkspaceAgentTimelineStore(authority);
    expect(await migratedAgents.get("agent-legacy")).toMatchObject({
      workspaceId: workspace.workspaceId,
      persistence: { nativeHandle: "thread-legacy" },
    });
    expect(await migratedTimeline.getLastAssistantMessage("agent-legacy")).toBe("legacy timeline");
    const coordination = authority.forWorkspace(workspace.workspaceId).coordination;
    expect(coordination.readChatMessages({ room: "legacy-room", limit: 0 })).toMatchObject([
      { id: "message-legacy", body: "Legacy coordination message" },
    ]);
    expect(coordination.getSchedule("schedule-legacy")).toMatchObject({
      name: "Legacy schedule",
      status: "paused",
    });
    const migratedTask = authority.forWorkspace(workspace.workspaceId).getTask("task-legacy");
    expect(migratedTask).toMatchObject({
      status: "paused",
      budget: { usedFailedReviews: 1, maxFailedReviews: 5 },
    });
    const migratedGoalId = migratedTask?.goals[0]?.id;
    expect(migratedGoalId).toBeTruthy();
    expect(migratedGoalId).not.toBe("goal-legacy");
    expect(
      authority
        .forWorkspace(workspace.workspaceId)
        .findLatestPlanExecThread("task-legacy", migratedGoalId!),
    ).toMatchObject({ status: "resumable", nativeHandle: "thread-legacy" });
    const migratedDatabase = new DatabaseSync(
      path.join(thothHome, "workspaces", workspace.workspaceId, "authority.sqlite"),
      { readOnly: true },
    );
    expect(
      (
        migratedDatabase.prepare("SELECT COUNT(*) AS count FROM human_decisions").get() as {
          count: number;
        }
      ).count,
    ).toBe(1);
    migratedDatabase.close();
    authority.close();
  });

  it("marks a fresh home without manufacturing a migration source", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "thoth-storage-fresh-"));
    roots.push(root);
    const thothHome = path.join(root, ".thoth");
    await ensureThothStorageLayout(thothHome, createTestLogger());
    expect(existsSync(path.join(thothHome, "storage-layout.json"))).toBe(true);
    expect(existsSync(`${thothHome}.migration-source-v1`)).toBe(false);
  });

  it("resumes after the legacy home was renamed before a journal existed", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "thoth-storage-renamed-"));
    roots.push(root);
    const thothHome = path.join(root, ".thoth");
    mkdirSync(thothHome, { recursive: true });
    writeFileSync(path.join(thothHome, "config.json"), '{"appendSystemPrompt":"legacy"}\n');
    renameSync(thothHome, `${thothHome}.migration-source-v1`);
    mkdirSync(thothHome, { recursive: true });

    const logger = createTestLogger();
    await expect(ensureThothStorageLayout(thothHome, logger)).resolves.toEqual({
      requiresProviderThreadFinalization: true,
    });
    const authority = new WorkspaceAuthorityManager(thothHome);
    await finalizeThothStorageLayoutMigration({
      thothHome,
      logger,
      authority,
      adapters: new HarnessAdapterRegistry(),
    });
    authority.close();

    expect(existsSync(`${thothHome}.migration-source-v1`)).toBe(false);
    expect(readFileSync(path.join(thothHome, "config.json"), "utf8")).toContain("legacy");
  });

  it("refuses changed migration source and preserves it for repair", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "thoth-storage-checksum-"));
    roots.push(root);
    const thothHome = path.join(root, ".thoth");
    mkdirSync(thothHome, { recursive: true });
    writeFileSync(path.join(thothHome, "config.json"), '{"value":1}\n');
    const logger = createTestLogger();
    await ensureThothStorageLayout(thothHome, logger);
    writeFileSync(path.join(`${thothHome}.migration-source-v1`, "config.json"), '{"value":2}\n');
    const authority = new WorkspaceAuthorityManager(thothHome);
    await expect(
      finalizeThothStorageLayoutMigration({
        thothHome,
        logger,
        authority,
        adapters: new HarnessAdapterRegistry(),
      }),
    ).rejects.toThrow("changed during provider thread migration");
    authority.close();
    expect(existsSync(`${thothHome}.migration-source-v1`)).toBe(true);
  });

  it("rejects a concurrent migration lock owned by a live process", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "thoth-storage-lock-"));
    roots.push(root);
    const thothHome = path.join(root, ".thoth");
    mkdirSync(thothHome, { recursive: true });
    writeFileSync(path.join(thothHome, "config.json"), "{}\n");
    writeFileSync(
      `${thothHome}.migration.lock`,
      `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`,
    );
    await expect(ensureThothStorageLayout(thothHome, createTestLogger())).rejects.toThrow(
      "already running",
    );
  });

  it("preserves the source and rejects a malformed legacy Loop Task", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "thoth-storage-malformed-"));
    roots.push(root);
    const thothHome = path.join(root, ".thoth");
    const loopRoot = path.join(thothHome, "thoth-loop");
    mkdirSync(loopRoot, { recursive: true });
    const database = new DatabaseSync(path.join(loopRoot, "authority.sqlite"));
    database.exec(`
      CREATE TABLE loop_task_projections (
        task_id TEXT PRIMARY KEY NOT NULL,
        revision INTEGER NOT NULL,
        projection_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
    `);
    database
      .prepare("INSERT INTO loop_task_projections VALUES (?, 1, ?, ?, ?)")
      .run(
        "broken",
        JSON.stringify({ id: "broken" }),
        new Date().toISOString(),
        new Date().toISOString(),
      );
    database.close();

    await expect(ensureThothStorageLayout(thothHome, createTestLogger())).rejects.toThrow(
      "Legacy Loop Task projection is malformed",
    );
    expect(existsSync(`${thothHome}.migration-source-v1`)).toBe(true);
    expect(existsSync(path.join(thothHome, "migration-journal.json"))).toBe(true);
  });
});
