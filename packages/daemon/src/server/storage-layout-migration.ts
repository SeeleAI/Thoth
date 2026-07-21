import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Logger } from "pino";
import type { HarnessAdapterRegistry } from "@thoth/drivers/harness";
import {
  ThothGoalsCardModelSchema,
  ThothTaskCardModelSchema,
} from "@thoth/protocol/thoth/rpc-schemas";
import { TaskProjectionSchema, type TaskProjection } from "@thoth/protocol/task-authority";
import {
  AgentStorage,
  parseStoredAgentRecord,
  type StoredAgentRecord,
} from "./agent/agent-storage.js";
import type { AgentTimelineItem } from "@thoth/drivers/agent-runtime";
import {
  CatalogProjectRegistry,
  CatalogWorkspaceRegistry,
  FileBackedProjectRegistry,
  FileBackedWorkspaceRegistry,
  createPersistedProjectRecord,
  createPersistedWorkspaceRecord,
  type PersistedProjectRecord,
  type PersistedWorkspaceRecord,
} from "./workspace-registry.js";
import {
  WorkspaceAgentStorage,
  WorkspaceAgentTimelineStore,
  WorkspaceAuthorityManager,
} from "./workspace-authority/index.js";
import { deriveDurableGoalId } from "./workspace-authority/task-identity.js";
import { ChatStorePayloadSchema } from "./chat/chat-service.js";
import { StoredScheduleSchema } from "@thoth/protocol/schedule/types";

const STORAGE_LAYOUT_VERSION = 1;
const MARKER_NAME = "storage-layout.json";
const JOURNAL_NAME = "migration-journal.json";
const MIGRATION_SOURCE_SUFFIX = ".migration-source-v1";
const GLOBAL_FILES = [
  "config.json",
  "daemon-keypair.json",
  "relay-credentials.json",
  "server-id",
  "cli-client-id",
  "push-tokens.json",
] as const;

interface MigrationJournal {
  version: 1;
  status: "running" | "failed" | "awaiting_provider_threads" | "complete";
  sourcePath: string;
  sourceDigest: string;
  completedSteps: string[];
  counts: {
    projects: number;
    workspaces: number;
    agents: number;
    timelineRows: number;
    foregroundTurns: number;
    humanDecisions: number;
    tasks: number;
    providerThreadsAdopted: number;
    providerThreadsReplaced: number;
    chatRooms: number;
    chatMessages: number;
    schedules: number;
    scheduleRuns: number;
  };
  error: string | null;
  updatedAt: string;
}

export interface ThothStorageLayoutPreparation {
  requiresProviderThreadFinalization: boolean;
}

function writeJsonAtomic(target: string, value: unknown): void {
  mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, target);
}

function listFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const result: string[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop()!;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(candidate);
      else if (entry.isFile()) result.push(candidate);
    }
  }
  return result.sort();
}

function sourceAuthorityFiles(sourcePath: string): string[] {
  const candidates = [
    ...GLOBAL_FILES.map((name) => path.join(sourcePath, name)),
    ...listFiles(path.join(sourcePath, "agents")),
    ...listFiles(path.join(sourcePath, "projects")),
    ...listFiles(path.join(sourcePath, "agent-timeline")),
    ...listFiles(path.join(sourcePath, "foreground-thoth")),
    ...listFiles(path.join(sourcePath, "thoth-loop")),
    ...listFiles(path.join(sourcePath, "loops")),
    ...listFiles(path.join(sourcePath, "chat")),
    ...listFiles(path.join(sourcePath, "schedules")),
  ];
  return [
    ...new Set(
      candidates.filter(
        (candidate) =>
          existsSync(candidate) &&
          !candidate.endsWith("-shm") &&
          !candidate.endsWith("-wal") &&
          !path.basename(candidate).includes(".tmp-"),
      ),
    ),
  ].sort();
}

function checkpointLegacyDatabases(sourcePath: string): void {
  for (const file of sourceAuthorityFiles(sourcePath).filter((candidate) =>
    candidate.endsWith(".sqlite"),
  )) {
    const database = new DatabaseSync(file);
    try {
      database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } finally {
      database.close();
    }
  }
}

function digestSource(sourcePath: string): string {
  const hash = createHash("sha256");
  for (const file of sourceAuthorityFiles(sourcePath)) {
    const relative = path.relative(sourcePath, file);
    const stat = statSync(file);
    hash.update(relative);
    hash.update(String(stat.size));
    hash.update(readFileSync(file));
  }
  return hash.digest("hex");
}

function acquireMigrationLock(thothHome: string): { path: string; fd: number } {
  const lockPath = `${thothHome}.migration.lock`;
  if (existsSync(lockPath)) {
    try {
      const existing = JSON.parse(readFileSync(lockPath, "utf8")) as { pid?: unknown };
      if (typeof existing.pid === "number") {
        try {
          process.kill(existing.pid, 0);
          throw new Error(`Thoth storage migration is already running in process ${existing.pid}`);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        }
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("already running")) throw error;
    }
    unlinkSync(lockPath);
  }
  const fd = openSync(lockPath, "wx", 0o600);
  writeSync(fd, `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`);
  return { path: lockPath, fd };
}

function releaseMigrationLock(lock: { path: string; fd: number }): void {
  closeSync(lock.fd);
  rmSync(lock.path, { force: true });
}

function isFreshDirectory(thothHome: string): boolean {
  if (!existsSync(thothHome)) return true;
  return readdirSync(thothHome).length === 0;
}

function deterministicId(prefix: string, value: string): string {
  return `${prefix}-${createHash("sha256").update(value).digest("hex").slice(0, 20)}`;
}

function copyGlobalState(sourcePath: string, thothHome: string): void {
  for (const name of GLOBAL_FILES) {
    const source = path.join(sourcePath, name);
    const target = path.join(thothHome, name);
    if (existsSync(source) && !existsSync(target)) copyFileSync(source, target);
  }
}

async function importCoordinationState(input: {
  sourcePath: string;
  authority: WorkspaceAuthorityManager;
}): Promise<{ chatRooms: number; chatMessages: number; schedules: number; scheduleRuns: number }> {
  let chatRooms = 0;
  let chatMessages = 0;
  const chatPath = path.join(input.sourcePath, "chat", "rooms.json");
  if (existsSync(chatPath)) {
    const snapshot = ChatStorePayloadSchema.parse(
      JSON.parse(readFileSync(chatPath, "utf8")) as unknown,
    );
    for (const room of snapshot.rooms) {
      const messages = snapshot.messages.filter((message) => message.roomId === room.id);
      const workspaceId = resolveLegacyCoordinationWorkspace(
        input.authority,
        messages.flatMap((message) => [message.authorAgentId, ...message.mentionAgentIds]),
      );
      input.authority
        .forWorkspace(workspaceId)
        .coordination.importChatSnapshot({ rooms: [room], messages });
      chatRooms += 1;
      chatMessages += messages.length;
    }
  }

  let schedules = 0;
  let scheduleRuns = 0;
  for (const file of listFiles(path.join(input.sourcePath, "schedules")).filter((candidate) =>
    candidate.endsWith(".json"),
  )) {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    const schedule = StoredScheduleSchema.parse(raw);
    const target = raw.target as
      | { type?: unknown; agentId?: unknown; config?: { cwd?: unknown } }
      | undefined;
    const agentIds =
      target?.type === "agent" && typeof target.agentId === "string" ? [target.agentId] : [];
    const cwd =
      target?.type === "new-agent" && typeof target.config?.cwd === "string"
        ? target.config.cwd
        : null;
    const workspaceId = resolveLegacyCoordinationWorkspace(input.authority, agentIds, cwd);
    input.authority.forWorkspace(workspaceId).coordination.putSchedule(schedule);
    schedules += 1;
    scheduleRuns += schedule.runs.length;
  }
  return { chatRooms, chatMessages, schedules, scheduleRuns };
}

function resolveLegacyCoordinationWorkspace(
  authority: WorkspaceAuthorityManager,
  agentIds: readonly string[],
  cwd?: string | null,
): string {
  for (const agentId of agentIds) {
    const workspaceId = authority.catalog.locateAgent(agentId);
    if (workspaceId) return workspaceId;
  }
  if (cwd) {
    const resolved = path.resolve(cwd);
    const workspace = authority.catalog
      .listWorkspaces()
      .find((candidate) => path.resolve(candidate.canonicalPath) === resolved);
    if (workspace) return workspace.id;
  }
  const fallback = authority.catalog.listWorkspaces()[0];
  if (!fallback) {
    throw new Error("Legacy coordination state has no Workspace authority owner");
  }
  return fallback.id;
}

async function importWorkspaceRegistry(input: {
  sourcePath: string;
  authority: WorkspaceAuthorityManager;
  logger: Logger;
}): Promise<{ projects: PersistedProjectRecord[]; workspaces: PersistedWorkspaceRecord[] }> {
  const projectsPath = path.join(input.sourcePath, "projects", "projects.json");
  const workspacesPath = path.join(input.sourcePath, "projects", "workspaces.json");
  const legacyProjects = new FileBackedProjectRegistry(
    path.join(input.sourcePath, "projects", "projects.json"),
    input.logger,
  );
  const legacyWorkspaces = new FileBackedWorkspaceRegistry(
    path.join(input.sourcePath, "projects", "workspaces.json"),
    input.logger,
  );
  await Promise.all([legacyProjects.initialize(), legacyWorkspaces.initialize()]);
  const projects = await legacyProjects.list();
  const workspaces = await legacyWorkspaces.list();
  for (const [filePath, importedCount, label] of [
    [projectsPath, projects.length, "Project"],
    [workspacesPath, workspaces.length, "Workspace"],
  ] as const) {
    if (!existsSync(filePath)) continue;
    const raw = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    if (!Array.isArray(raw) || raw.length !== importedCount) {
      throw new Error(`Legacy ${label} registry could not be imported exactly`);
    }
  }
  const projectRegistry = new CatalogProjectRegistry(input.authority.catalog);
  const workspaceRegistry = new CatalogWorkspaceRegistry(input.authority.catalog);
  for (const project of projects) await projectRegistry.upsert(project);
  for (const workspace of workspaces) await workspaceRegistry.upsert(workspace);
  return { projects, workspaces };
}

async function ensureAgentWorkspace(input: {
  record: Awaited<ReturnType<AgentStorage["list"]>>[number];
  projects: PersistedProjectRecord[];
  workspaces: PersistedWorkspaceRecord[];
  authority: WorkspaceAuthorityManager;
}): Promise<PersistedWorkspaceRecord> {
  const resolvedCwd = path.resolve(input.record.cwd);
  const existing = input.workspaces.find(
    (workspace) =>
      workspace.workspaceId === input.record.workspaceId ||
      path.resolve(workspace.cwd) === resolvedCwd,
  );
  if (existing) return existing;
  const projectId = deterministicId("project-migrated", resolvedCwd);
  const workspaceId =
    input.record.workspaceId ?? deterministicId("workspace-migrated", resolvedCwd);
  const now = input.record.updatedAt || input.record.createdAt || new Date().toISOString();
  const project = createPersistedProjectRecord({
    projectId,
    rootPath: resolvedCwd,
    kind: "non_git",
    displayName: path.basename(resolvedCwd),
    createdAt: input.record.createdAt || now,
    updatedAt: now,
  });
  const workspace = createPersistedWorkspaceRecord({
    workspaceId,
    projectId,
    cwd: resolvedCwd,
    kind: "directory",
    displayName: path.basename(resolvedCwd),
    createdAt: input.record.createdAt || now,
    updatedAt: now,
  });
  const projects = new CatalogProjectRegistry(input.authority.catalog);
  const workspaces = new CatalogWorkspaceRegistry(input.authority.catalog);
  await projects.upsert(project);
  await workspaces.upsert(workspace);
  input.projects.push(project);
  input.workspaces.push(workspace);
  return workspace;
}

async function importAgentsAndTimeline(input: {
  sourcePath: string;
  authority: WorkspaceAuthorityManager;
  projects: PersistedProjectRecord[];
  workspaces: PersistedWorkspaceRecord[];
  logger: Logger;
}): Promise<{ agents: number; timelineRows: number; records: StoredAgentRecord[] }> {
  for (const file of listFiles(path.join(input.sourcePath, "agents")).filter((candidate) =>
    candidate.endsWith(".json"),
  )) {
    try {
      parseStoredAgentRecord(JSON.parse(readFileSync(file, "utf8")) as unknown);
    } catch (error) {
      throw new Error(
        `Legacy Agent record is malformed: ${path.relative(input.sourcePath, file)}`,
        {
          cause: error,
        },
      );
    }
  }
  const legacy = new AgentStorage(path.join(input.sourcePath, "agents"), input.logger);
  await legacy.initialize();
  const records = await legacy.list();
  const target = new WorkspaceAgentStorage(input.authority);
  const timeline = new WorkspaceAgentTimelineStore(input.authority);
  for (const record of records) {
    const workspace = await ensureAgentWorkspace({ ...input, record });
    input.authority.registerWorkspace(workspace);
    await target.upsert({ ...record, workspaceId: workspace.workspaceId });
    timeline.bindAgentWorkspace(record.id, workspace.workspaceId);
  }

  let timelineRows = 0;
  const timelinePath = path.join(input.sourcePath, "agent-timeline", "timeline.sqlite");
  if (existsSync(timelinePath)) {
    const database = new DatabaseSync(timelinePath, { readOnly: true });
    try {
      for (const record of records) {
        const rows = database
          .prepare(
            `SELECT seq, timestamp, item_json FROM agent_timeline_rows
             WHERE agent_id = ? ORDER BY seq ASC`,
          )
          .all(record.id) as Array<{ seq: number; timestamp: string; item_json: string }>;
        const parsed = rows.map((row) => {
          try {
            return {
              seq: row.seq,
              timestamp: row.timestamp,
              item: JSON.parse(row.item_json) as AgentTimelineItem,
            };
          } catch (error) {
            throw new Error(`Legacy Agent timeline row is malformed: ${record.id}:${row.seq}`, {
              cause: error,
            });
          }
        });
        if (parsed.length > 0) await timeline.bulkInsert(record.id, parsed);
        timelineRows += parsed.length;
      }
    } finally {
      database.close();
    }
  }
  return { agents: records.length, timelineRows, records };
}

function mapTaskStatus(value: unknown): TaskProjection["status"] {
  switch (value) {
    case "done":
      return "completed";
    case "paused":
      return "paused";
    case "stopped":
      return "stopped";
    case "blocked":
      return "blocked";
    case "budget_wait":
      return "budget_wait";
    case "awaiting_user_decision":
      return "awaiting_user";
    case "queued":
      return "queued";
    case "running":
    case "awaiting_provider":
    case "interrupted":
    default:
      return "interrupted";
  }
}

function mapForegroundLifecycle(value: unknown) {
  switch (value) {
    case "awaiting_card":
    case "background_handoff":
    case "done":
    case "canceled":
    case "unsupported":
    case "idle":
      return value;
    case "running":
    case "quick_exec":
    case "interrupted":
    default:
      return "interrupted" as const;
  }
}

function importForegroundAuthority(input: {
  sourcePath: string;
  authority: WorkspaceAuthorityManager;
}): { foregroundTurns: number; humanDecisions: number } {
  const databasePath = path.join(input.sourcePath, "foreground-thoth", "authority.sqlite");
  if (!existsSync(databasePath)) return { foregroundTurns: 0, humanDecisions: 0 };
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const hasTable = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'foreground_agents'")
      .get();
    if (!hasTable) return { foregroundTurns: 0, humanDecisions: 0 };
    const agents = database.prepare("SELECT * FROM foreground_agents").all() as Array<
      Record<string, unknown>
    >;
    let foregroundTurns = 0;
    let humanDecisions = 0;
    for (const agent of agents) {
      const agentId = String(agent.agent_id);
      const workspaceId = input.authority.catalog.locateAgent(agentId);
      if (!workspaceId) {
        throw new Error(`Legacy foreground authority references unknown Agent ${agentId}`);
      }
      const turnRows = database
        .prepare("SELECT * FROM foreground_turns WHERE agent_id = ? ORDER BY started_at ASC")
        .all(agentId) as Array<Record<string, unknown>>;
      const turns = turnRows.map((turn) => {
        const turnId = String(turn.turn_id);
        const cardRows = database
          .prepare("SELECT * FROM foreground_cards WHERE turn_id = ? ORDER BY created_at ASC")
          .all(turnId) as Array<Record<string, unknown>>;
        return {
          id: turnId,
          generation: String(turn.generation),
          kind: turn.turn_kind === "thoth" ? ("thoth" as const) : ("raw" as const),
          lifecycle: mapForegroundLifecycle(turn.lifecycle),
          controls: typeof turn.controls_json === "string" ? JSON.parse(turn.controls_json) : null,
          sourceMessageId:
            typeof turn.source_message_id === "string" ? turn.source_message_id : null,
          workspacePath: String(turn.workspace_path),
          userText: String(turn.user_text ?? ""),
          providerTurnId: typeof turn.provider_turn_id === "string" ? turn.provider_turn_id : null,
          backgroundTaskId:
            typeof turn.background_task_id === "string" ? turn.background_task_id : null,
          error: typeof turn.error === "string" ? turn.error : null,
          startedAt: String(turn.started_at),
          updatedAt: String(turn.updated_at),
          cards: cardRows.map((card) => {
            const command = database
              .prepare(
                "SELECT command_id FROM foreground_commands WHERE card_id = ? ORDER BY created_at ASC LIMIT 1",
              )
              .get(card.card_id) as { command_id: string } | undefined;
            const answer =
              typeof card.answer_json === "string" ? JSON.parse(card.answer_json) : null;
            if (answer !== null) humanDecisions += 1;
            return {
              id: String(card.card_id),
              kind: String(card.card_kind) as "clarify_card" | "task_card" | "goal_card",
              status: String(card.status) as "pending" | "answered" | "canceled" | "blocked",
              card: JSON.parse(String(card.card_json)) as unknown,
              answer,
              submittedSummary:
                typeof card.submitted_summary === "string" ? card.submitted_summary : null,
              runtime: JSON.parse(String(card.runtime_json)) as {
                provider: string;
                threadId: string;
                providerTurnId: string;
                callId: string;
                toolName: string;
                redactedRawInputHash: string;
              },
              commandId: command?.command_id ?? null,
              createdAt: String(card.created_at),
              updatedAt: String(card.updated_at),
            };
          }),
        };
      });
      foregroundTurns += turns.length;
      input.authority.forWorkspace(workspaceId).importLegacyForeground({
        agentId,
        revision: Math.max(0, Number(agent.revision ?? 0)),
        activeTurnId: typeof agent.active_turn_id === "string" ? agent.active_turn_id : null,
        lifecycle: mapForegroundLifecycle(agent.lifecycle),
        backgroundTaskId:
          typeof agent.background_task_id === "string" ? agent.background_task_id : null,
        error: typeof agent.error === "string" ? agent.error : null,
        updatedAt: String(agent.updated_at),
        turns,
      });
    }
    return { foregroundTurns, humanDecisions };
  } finally {
    database.close();
  }
}

function mapGoalStatus(value: unknown): TaskProjection["goals"][number]["status"] {
  switch (value) {
    case "passed":
      return "passed";
    case "paused":
      return "paused";
    case "stopped":
      return "stopped";
    case "blocked":
      return "blocked";
    case "awaiting_user_decision":
      return "awaiting_user";
    case "queued":
      return "queued";
    default:
      return "interrupted";
  }
}

function mapExecutionStatus(value: unknown) {
  switch (value) {
    case "completed":
      return "succeeded" as const;
    case "failed":
    case "blocked":
    case "interrupted":
      return "failed" as const;
    case "canceled":
      return "canceled" as const;
    case "queued":
      return "created" as const;
    case "running":
    case "awaiting_provider":
    default:
      return "orphaned" as const;
  }
}

async function importLoopTasks(input: {
  sourcePath: string;
  authority: WorkspaceAuthorityManager;
  projects: PersistedProjectRecord[];
  workspaces: PersistedWorkspaceRecord[];
  legacyAgents: ReadonlyMap<string, StoredAgentRecord>;
}): Promise<number> {
  const databasePath = path.join(input.sourcePath, "thoth-loop", "authority.sqlite");
  if (!existsSync(databasePath)) return 0;
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const table = database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'loop_task_projections'",
      )
      .get();
    if (!table) return 0;
    const hasTable = (name: string): boolean =>
      Boolean(
        database
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
          .get(name),
      );
    const rows = database
      .prepare("SELECT projection_json FROM loop_task_projections")
      .all() as Array<{
      projection_json: string;
    }>;
    let imported = 0;
    for (const row of rows) {
      const legacy = JSON.parse(row.projection_json) as Record<string, unknown>;
      const taskCard = ThothTaskCardModelSchema.safeParse(legacy.taskCard);
      const goalsCard = ThothGoalsCardModelSchema.safeParse(legacy.goalsCard);
      if (!taskCard.success || !goalsCard.success || typeof legacy.id !== "string") {
        throw new Error("Legacy Loop Task projection is malformed and cannot be migrated exactly");
      }
      const workspacePath = typeof legacy.workspacePath === "string" ? legacy.workspacePath : "";
      let workspace = input.workspaces.find(
        (candidate) => path.resolve(candidate.cwd) === path.resolve(workspacePath),
      );
      if (!workspace) {
        const sourceAgentId =
          typeof legacy.sourceAgentId === "string" ? legacy.sourceAgentId : "legacy";
        workspace = await ensureAgentWorkspace({
          record: {
            id: sourceAgentId,
            provider: "legacy",
            cwd: workspacePath,
            createdAt: String(legacy.createdAt ?? new Date(0).toISOString()),
            updatedAt: String(legacy.updatedAt ?? new Date(0).toISOString()),
            labels: {},
            lastStatus: "closed",
          },
          projects: input.projects,
          workspaces: input.workspaces,
          authority: input.authority,
        });
      }
      input.authority.registerWorkspace(workspace);
      const providerBinding =
        legacy.providerBinding && typeof legacy.providerBinding === "object"
          ? (legacy.providerBinding as Record<string, unknown>)
          : {};
      const adapterId =
        typeof providerBinding.provider === "string" ? providerBinding.provider : "legacy";
      const profile = {
        adapterId,
        config: providerBinding,
      };
      const profileDigest = createHash("sha256").update(JSON.stringify(profile)).digest("hex");
      const providerProfileId = `provider-profile-${profileDigest}`;
      input.authority.catalog.upsertProviderProfile({
        id: providerProfileId,
        adapterId,
        config: providerBinding,
        enabled: adapterId !== "legacy",
        createdAt: String(legacy.createdAt ?? new Date(0).toISOString()),
        updatedAt: String(legacy.updatedAt ?? new Date(0).toISOString()),
      });
      const strength =
        legacy.loopStrength === "light"
          ? "light"
          : legacy.loopStrength === "balanced"
            ? "balanced"
            : legacy.loopStrength === "run_until_stopped"
              ? "infinite"
              : "single";
      const goals = Array.isArray(legacy.goals) ? legacy.goals : [];
      const migratedGoals = goals.map((goal, index) => {
        const value = goal as Record<string, unknown>;
        const sourceGoalId = String(value.id ?? `legacy-goal-${index + 1}`);
        const order = Number(value.order ?? index + 1);
        return {
          value,
          sourceGoalId,
          order,
          durableGoalId: deriveDurableGoalId({
            taskId: String(legacy.id),
            sourceGoalId,
            order,
            lineage: "legacy-import",
          }),
        };
      });
      const legacyCurrentGoalId =
        typeof legacy.currentGoalId === "string" ? legacy.currentGoalId : null;
      const projection = TaskProjectionSchema.parse({
        id: legacy.id,
        workspaceId: workspace.workspaceId,
        sourceAgentId: String(legacy.sourceAgentId ?? `legacy-agent-${randomUUID()}`),
        mode: "loop",
        title: taskCard.data.title,
        goal: taskCard.data.goal,
        constraints: taskCard.data.constraints,
        acceptance: taskCard.data.acceptance,
        status: mapTaskStatus(legacy.status),
        summary: String(legacy.summary ?? "Migrated Loop task"),
        currentGoalId:
          migratedGoals.find((goal) => goal.sourceGoalId === legacyCurrentGoalId)?.durableGoalId ??
          null,
        currentExecutionId: null,
        goals: migratedGoals.map(({ value, durableGoalId, order }, index) => {
          return {
            id: durableGoalId,
            order,
            title: String(value.title ?? `Goal ${index + 1}`),
            goal: String(value.goal ?? value.title ?? `Goal ${index + 1}`),
            constraints: Array.isArray(value.constraints) ? value.constraints : [],
            acceptance: Array.isArray(value.acceptance) ? value.acceptance : ["Review legacy goal"],
            status: mapGoalStatus(value.status),
            revision: Math.max(1, Number(value.round ?? 1)),
          };
        }),
        latestReviewDirection:
          typeof legacy.latestVerdictSummary === "string" ? legacy.latestVerdictSummary : null,
        pendingDecision: null,
        budget: {
          strength,
          usedFailedReviews: Number(
            (legacy.budget as Record<string, unknown> | undefined)?.usedFailedReviews ?? 0,
          ),
          maxFailedReviews: Number(
            (legacy.budget as Record<string, unknown> | undefined)?.maxFailedReviews ?? 1,
          ),
          activeDurationMs: Number(
            (legacy.budgetUsage as Record<string, unknown> | undefined)?.activeDurationMs ?? 0,
          ),
          tokenCount: Number(
            (legacy.budgetUsage as Record<string, unknown> | undefined)?.tokens ?? 0,
          ),
          toolCallCount: Number(
            (legacy.budgetUsage as Record<string, unknown> | undefined)?.toolCalls ?? 0,
          ),
        },
        pendingControl: null,
        revision: Math.max(1, Number(legacy.authorityRevision ?? 1)),
        createdAt: String(legacy.createdAt ?? new Date(0).toISOString()),
        updatedAt: String(legacy.updatedAt ?? new Date(0).toISOString()),
      });
      const result = input.authority.forWorkspace(workspace.workspaceId).registerTask({
        task: projection,
        sourceTurnId: `legacy-turn-${projection.id}`,
        sourceGoalsCardId: String(legacy.sourceGoalsCardId ?? goalsCard.data.id),
        providerProfileId,
        taskContract: taskCard.data,
        goalsContract: goalsCard.data,
      });
      const store = input.authority.forWorkspace(workspace.workspaceId);
      for (const migratedGoal of migratedGoals) {
        const goal = migratedGoal.value;
        const phases = Array.isArray(goal.phases) ? goal.phases : [];
        for (const [phaseIndex, phaseValue] of phases.entries()) {
          const phase = phaseValue as Record<string, unknown>;
          if (phase.phase !== "planexec" && phase.phase !== "review") continue;
          const identity = JSON.stringify({
            taskId: projection.id,
            goalId: goal.id,
            phase: phase.phase,
            round: phase.round,
            phaseRunId: phase.phaseRunId,
            phaseIndex,
          });
          const suffix = createHash("sha256").update(identity).digest("hex").slice(0, 24);
          const phaseRunId =
            typeof phase.phaseRunId === "string"
              ? `phase-run-legacy-${phase.phaseRunId}`
              : `phase-run-legacy-${suffix}`;
          const executionId = `execution-legacy-${suffix}`;
          const providerThreadId =
            typeof phase.agentId === "string"
              ? `provider-thread-legacy-${createHash("sha256")
                  .update(phase.agentId)
                  .digest("hex")
                  .slice(0, 24)}`
              : null;
          const legacyAgent =
            typeof phase.agentId === "string" ? input.legacyAgents.get(phase.agentId) : null;
          const providerHandle = legacyAgent?.persistence ?? null;
          const nativeHandleValue = providerHandle?.nativeHandle ?? providerHandle?.sessionId;
          const nativeHandle =
            typeof nativeHandleValue === "string" && nativeHandleValue.trim().length > 0
              ? nativeHandleValue
              : null;
          const legacySessionId =
            phase.phase === "planexec"
              ? `loop-${projection.id}-${String(goal.id)}-planexec`
              : `loop-${projection.id}-${String(goal.id)}-review-${String(phase.round ?? 1)}`;
          const legacyRoot = path.join(input.sourcePath, "provider-sessions", legacySessionId);
          const providerThreadPersistence = providerThreadId
            ? {
                legacyAgentId: typeof phase.agentId === "string" ? phase.agentId : null,
                legacyRootRelative: path.relative(input.sourcePath, legacyRoot),
                nativeHandle,
                providerHandle,
                profile: legacyAgent?.config ?? providerBinding,
              }
            : null;
          store.importLegacyExecution({
            taskId: projection.id,
            goalId: migratedGoal.durableGoalId,
            executionId,
            phaseRunId,
            phase: phase.phase,
            providerThreadId,
            adapterId,
            providerThreadNativeHandle: nativeHandle,
            providerThreadPersistence,
            providerThreadStatus:
              providerThreadId && providerHandle
                ? "legacy_pending_adoption"
                : "native_context_unavailable",
            status: mapExecutionStatus(phase.status),
            generation: `legacy-${String(
              phase.attemptId ?? phase.executionGeneration ?? phase.round ?? phaseIndex + 1,
            )}`,
            startedAt: typeof phase.startedAt === "string" ? phase.startedAt : null,
            completedAt: typeof phase.completedAt === "string" ? phase.completedAt : null,
            summary: typeof phase.summary === "string" ? phase.summary : null,
            semanticHistory: {
              phase,
              ...(phase.phase === "planexec" && goal.latestPlanExecResult
                ? { planExecResult: goal.latestPlanExecResult }
                : {}),
              ...(phase.phase === "review" && goal.latestReview
                ? { review: goal.latestReview }
                : {}),
            },
          });
        }
      }
      if (legacy.pendingUserDecision && typeof legacy.pendingUserDecision === "object") {
        const pending = legacy.pendingUserDecision as Record<string, unknown>;
        store.importLegacyTaskDecision({
          taskId: projection.id,
          decision: pending,
          ...(pending.status === "submitted"
            ? {
                answer: pending.answer ?? "",
                submittedAt:
                  typeof pending.submittedAt === "string" ? pending.submittedAt : undefined,
              }
            : {}),
        });
      }
      const memoryRows = hasTable("loop_task_memory_nodes")
        ? (database
            .prepare(
              `SELECT kind, content_json, created_at FROM loop_task_memory_nodes
               WHERE task_id = ? ORDER BY revision ASC, created_at ASC`,
            )
            .all(projection.id) as Array<{
            kind: string;
            content_json: string;
            created_at: string;
          }>)
        : [];
      for (const memory of memoryRows) {
        const mapped =
          memory.kind === "task_card"
            ? { kind: "task_contract" as const, producer: "secretary" as const }
            : memory.kind === "goals_card"
              ? { kind: "goal_contract" as const, producer: "secretary" as const }
              : memory.kind === "planexec_result"
                ? { kind: "planexec_report" as const, producer: "planexec" as const }
                : memory.kind === "review_verdict"
                  ? { kind: "review_assessment" as const, producer: "review" as const }
                  : memory.kind === "workspace_fact"
                    ? { kind: "workspace_fact" as const, producer: "daemon" as const }
                    : memory.kind === "clarify_transcript"
                      ? { kind: "human_decision" as const, producer: "secretary" as const }
                      : { kind: "evidence_summary" as const, producer: "daemon" as const };
        store.importLegacyTaskMemory({
          taskId: projection.id,
          ...mapped,
          content: JSON.parse(memory.content_json) as unknown,
          createdAt: memory.created_at,
        });
      }
      const commands = hasTable("loop_task_commands")
        ? (database
            .prepare(
              `SELECT command_id, action, result_revision, created_at FROM loop_task_commands
               WHERE task_id = ? ORDER BY created_at ASC`,
            )
            .all(projection.id) as Array<{
            command_id: string;
            action: string;
            result_revision: number | null;
            created_at: string;
          }>)
        : [];
      for (const command of commands) {
        const resultRevision = Math.max(1, command.result_revision ?? projection.revision);
        store.appendDecision({
          taskId: projection.id,
          turnId: null,
          cardId: null,
          kind: `task_${command.action}`,
          displayed: { command: command.action, taskId: projection.id },
          rawAnswer: { command: command.action },
          normalized: { controlIntent: command.action },
          actorId: "legacy-user",
          clientId: "legacy-client",
          deviceId: null,
          commandId: command.command_id,
          expectedRevision: Math.max(0, resultRevision - 1),
          resultRevision,
          supersedesDecisionId: null,
          fidelity: "exact",
        });
      }
      if (result.created) imported += 1;
    }
    return imported;
  } finally {
    database.close();
  }
}

function initialJournal(sourcePath: string, sourceDigest: string): MigrationJournal {
  return {
    version: 1,
    status: "running",
    sourcePath,
    sourceDigest,
    completedSteps: [],
    counts: {
      projects: 0,
      workspaces: 0,
      agents: 0,
      timelineRows: 0,
      foregroundTurns: 0,
      humanDecisions: 0,
      tasks: 0,
      providerThreadsAdopted: 0,
      providerThreadsReplaced: 0,
      chatRooms: 0,
      chatMessages: 0,
      schedules: 0,
      scheduleRuns: 0,
    },
    error: null,
    updatedAt: new Date().toISOString(),
  };
}

export async function ensureThothStorageLayout(
  thothHome: string,
  logger: Logger,
): Promise<ThothStorageLayoutPreparation> {
  const markerPath = path.join(thothHome, MARKER_NAME);
  if (existsSync(markerPath)) {
    const marker = JSON.parse(readFileSync(markerPath, "utf8")) as {
      version?: unknown;
      migrationState?: unknown;
    };
    if (marker.version !== STORAGE_LAYOUT_VERSION) {
      throw new Error(`Unsupported Thoth storage layout version: ${String(marker.version)}`);
    }
    return {
      requiresProviderThreadFinalization: marker.migrationState === "awaiting_provider_threads",
    };
  }

  const lock = acquireMigrationLock(thothHome);
  try {
    if (existsSync(markerPath)) {
      return { requiresProviderThreadFinalization: false };
    }
    const sourcePath = `${thothHome}${MIGRATION_SOURCE_SUFFIX}`;
    if (!existsSync(sourcePath) && isFreshDirectory(thothHome)) {
      mkdirSync(thothHome, { recursive: true });
      writeJsonAtomic(markerPath, {
        version: STORAGE_LAYOUT_VERSION,
        migrated: false,
        migrationState: "complete",
        createdAt: new Date().toISOString(),
      });
      return { requiresProviderThreadFinalization: false };
    }
    if (!existsSync(sourcePath)) {
      renameSync(thothHome, sourcePath);
      mkdirSync(thothHome, { recursive: true });
    } else {
      mkdirSync(thothHome, { recursive: true });
    }

    const journalPath = path.join(thothHome, JOURNAL_NAME);
    checkpointLegacyDatabases(sourcePath);
    const sourceDigest = digestSource(sourcePath);
    const existingJournal = existsSync(journalPath)
      ? (JSON.parse(readFileSync(journalPath, "utf8")) as MigrationJournal)
      : null;
    if (existingJournal && existingJournal.sourceDigest !== sourceDigest) {
      throw new Error("Legacy Thoth storage changed during migration");
    }
    const journal = existingJournal ?? initialJournal(sourcePath, sourceDigest);
    journal.counts.providerThreadsAdopted ??= 0;
    journal.counts.providerThreadsReplaced ??= 0;
    journal.counts.chatRooms ??= 0;
    journal.counts.chatMessages ??= 0;
    journal.counts.schedules ??= 0;
    journal.counts.scheduleRuns ??= 0;
    journal.status = "running";
    journal.error = null;
    writeJsonAtomic(journalPath, journal);

    try {
      copyGlobalState(sourcePath, thothHome);
      journal.completedSteps = [...new Set([...journal.completedSteps, "global-state"])];
      writeJsonAtomic(journalPath, journal);

      const authority = new WorkspaceAuthorityManager(thothHome);
      try {
        const registries = await importWorkspaceRegistry({ sourcePath, authority, logger });
        journal.counts.projects = registries.projects.length;
        journal.counts.workspaces = registries.workspaces.length;
        journal.completedSteps = [...new Set([...journal.completedSteps, "workspace-registry"])];
        writeJsonAtomic(journalPath, journal);

        const agentCounts = await importAgentsAndTimeline({
          sourcePath,
          authority,
          projects: registries.projects,
          workspaces: registries.workspaces,
          logger,
        });
        journal.counts.agents = agentCounts.agents;
        journal.counts.timelineRows = agentCounts.timelineRows;
        journal.counts.projects = authority.catalog.listProjectRecords().length;
        journal.counts.workspaces = authority.catalog.listWorkspaceRecords().length;
        journal.completedSteps = [...new Set([...journal.completedSteps, "agents-and-timeline"])];
        writeJsonAtomic(journalPath, journal);

        const coordination = await importCoordinationState({ sourcePath, authority });
        Object.assign(journal.counts, coordination);
        journal.completedSteps = [...new Set([...journal.completedSteps, "coordination-state"])];
        writeJsonAtomic(journalPath, journal);

        const foregroundCounts = importForegroundAuthority({ sourcePath, authority });
        journal.counts.foregroundTurns = foregroundCounts.foregroundTurns;
        journal.counts.humanDecisions = foregroundCounts.humanDecisions;
        journal.completedSteps = [...new Set([...journal.completedSteps, "foreground-authority"])];
        writeJsonAtomic(journalPath, journal);

        journal.counts.tasks = await importLoopTasks({
          sourcePath,
          authority,
          projects: registries.projects,
          workspaces: registries.workspaces,
          legacyAgents: new Map(agentCounts.records.map((record) => [record.id, record])),
        });
        journal.completedSteps = [...new Set([...journal.completedSteps, "tasks"])];
        writeJsonAtomic(journalPath, journal);

        const importedAgents = new WorkspaceAgentStorage(authority);
        if ((await importedAgents.list()).length !== journal.counts.agents) {
          throw new Error("Agent count mismatch after Workspace authority migration");
        }
      } finally {
        authority.close();
      }

      journal.status = "awaiting_provider_threads";
      journal.error = null;
      journal.updatedAt = new Date().toISOString();
      writeJsonAtomic(journalPath, journal);
      writeJsonAtomic(markerPath, {
        version: STORAGE_LAYOUT_VERSION,
        migrated: false,
        migrationState: "awaiting_provider_threads",
        sourceDigest,
        counts: journal.counts,
        preparedAt: journal.updatedAt,
      });
      logger.info(
        { counts: journal.counts },
        "Prepared Thoth storage migration for provider thread adoption",
      );
      return { requiresProviderThreadFinalization: true };
    } catch (error) {
      journal.status = "failed";
      journal.error = error instanceof Error ? error.message : String(error);
      journal.updatedAt = new Date().toISOString();
      writeJsonAtomic(journalPath, journal);
      throw error;
    }
  } finally {
    releaseMigrationLock(lock);
  }
}

export async function finalizeThothStorageLayoutMigration(input: {
  thothHome: string;
  logger: Logger;
  authority: WorkspaceAuthorityManager;
  adapters: HarnessAdapterRegistry;
}): Promise<void> {
  const markerPath = path.join(input.thothHome, MARKER_NAME);
  const marker = JSON.parse(readFileSync(markerPath, "utf8")) as {
    version?: unknown;
    migrationState?: unknown;
  };
  if (marker.version !== STORAGE_LAYOUT_VERSION) {
    throw new Error(`Unsupported Thoth storage layout version: ${String(marker.version)}`);
  }
  if (marker.migrationState !== "awaiting_provider_threads") {
    return;
  }

  const lock = acquireMigrationLock(input.thothHome);
  const sourcePath = `${input.thothHome}${MIGRATION_SOURCE_SUFFIX}`;
  const journalPath = path.join(input.thothHome, JOURNAL_NAME);
  try {
    if (!existsSync(sourcePath) || !existsSync(journalPath)) {
      throw new Error("Prepared Thoth migration is missing its source or journal");
    }
    const sourceDigest = digestSource(sourcePath);
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as MigrationJournal;
    if (journal.sourceDigest !== sourceDigest) {
      throw new Error("Legacy Thoth storage changed during provider thread migration");
    }
    journal.status = "running";
    journal.error = null;
    journal.counts.providerThreadsAdopted ??= 0;
    journal.counts.providerThreadsReplaced ??= 0;
    journal.counts.chatRooms ??= 0;
    journal.counts.chatMessages ??= 0;
    journal.counts.schedules ??= 0;
    journal.counts.scheduleRuns ??= 0;
    writeJsonAtomic(journalPath, journal);

    let adoptedCount = 0;
    let replacementCount = 0;
    for (const workspace of input.authority.catalog.listWorkspaces()) {
      const store = input.authority.forWorkspace(workspace.id);
      for (const candidate of store.listProviderThreadsByStatus("legacy_pending_adoption")) {
        const metadata = candidate.persistence ?? {};
        const relativeRoot =
          typeof metadata.legacyRootRelative === "string"
            ? metadata.legacyRootRelative
            : "provider-sessions";
        const legacyRoot = path.resolve(sourcePath, relativeRoot);
        const relativeCheck = path.relative(sourcePath, legacyRoot);
        if (relativeCheck.startsWith("..") || path.isAbsolute(relativeCheck)) {
          throw new Error(`Legacy provider thread root escapes migration source: ${candidate.id}`);
        }

        let adopted = null;
        try {
          const adapter = input.adapters.get(candidate.adapterId);
          const inspection = await adapter.inspectLegacyThread({ legacyRoot, metadata });
          if (inspection.resumable) {
            adopted = await adapter.adoptNativeThread({
              inspection,
              workspaceId: workspace.id,
              workspacePath: workspace.canonicalPath,
            });
          }
          if (!adopted || !(await adapter.verifyResume(adopted))) {
            if (adopted) {
              await adapter.deleteOwnedThread(adopted).catch(() => undefined);
            }
            throw new Error("Provider did not verify the adopted native thread");
          }
          store.updateProviderThread({
            threadId: candidate.id,
            nativeHandle: adopted.nativeHandle,
            persistence: {
              ...adopted.persistence,
              migration: { disposition: "adopted", sourceThreadId: candidate.id },
            },
            status: "resumable",
          });
          adoptedCount += 1;
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          store.updateProviderThread({
            threadId: candidate.id,
            nativeHandle: candidate.nativeHandle,
            persistence: {
              ...metadata,
              migration: { disposition: "replacement_required", reason },
            },
            status: "native_context_unavailable",
          });
          replacementCount += 1;
          input.logger.warn(
            { err: error, workspaceId: workspace.id, threadId: candidate.id },
            "Legacy provider thread requires an explicit replacement lineage",
          );
        }
      }
      if (store.listProviderThreadsByStatus("legacy_pending_adoption").length > 0) {
        throw new Error(`Workspace ${workspace.id} still has pending legacy provider threads`);
      }
    }

    adoptedCount = 0;
    replacementCount = 0;
    for (const workspace of input.authority.catalog.listWorkspaces()) {
      const store = input.authority.forWorkspace(workspace.id);
      adoptedCount += store
        .listProviderThreadsByStatus("resumable")
        .filter(
          (thread) =>
            (thread.persistence?.migration as { disposition?: unknown } | undefined)
              ?.disposition === "adopted",
        ).length;
      replacementCount += store
        .listProviderThreadsByStatus("native_context_unavailable")
        .filter(
          (thread) =>
            (thread.persistence?.migration as { disposition?: unknown } | undefined)
              ?.disposition === "replacement_required",
        ).length;
    }
    journal.counts.providerThreadsAdopted = adoptedCount;
    journal.counts.providerThreadsReplaced = replacementCount;
    journal.completedSteps = [...new Set([...journal.completedSteps, "provider-thread-adoption"])];
    journal.status = "complete";
    journal.error = null;
    journal.updatedAt = new Date().toISOString();
    writeJsonAtomic(journalPath, journal);
    writeJsonAtomic(markerPath, {
      version: STORAGE_LAYOUT_VERSION,
      migrated: true,
      migrationState: "complete",
      sourceDigest,
      counts: journal.counts,
      completedAt: journal.updatedAt,
    });
    rmSync(sourcePath, { recursive: true, force: true });
    rmSync(journalPath, { force: true });
    input.logger.info(
      { counts: journal.counts },
      "Migrated Thoth storage to Workspace authority shards",
    );
  } catch (error) {
    if (existsSync(journalPath)) {
      const journal = JSON.parse(readFileSync(journalPath, "utf8")) as MigrationJournal;
      journal.status = "failed";
      journal.error = error instanceof Error ? error.message : String(error);
      journal.updatedAt = new Date().toISOString();
      writeJsonAtomic(journalPath, journal);
    }
    throw error;
  } finally {
    releaseMigrationLock(lock);
  }
}
