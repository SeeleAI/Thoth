import { createHash } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import {
  HumanDecisionRecordSchema,
  TaskContextEnvelopeSchema,
  TaskProjectionSchema,
  type EvidenceRef,
  type HumanDecisionRecord,
  type TaskProjection,
  type WorkUnitProjection,
} from "@thoth/protocol/task-authority";
import {
  IntentContractProjectionSchema,
  type IntentContractProjection,
} from "@thoth/protocol/intent-contract";
import { createWorkspaceDatabase } from "./storage-schema.js";
import { ContentAddressedBlobStore } from "./workspace-authority/blob-store.js";

const AUTHORITY_V6_CHECKSUM = "decision-map-task-anchor-v6";
const ACTIVE_EXECUTION_STATUSES = new Set([
  "created",
  "starting",
  "planning",
  "awaiting_implementation",
  "implementing",
  "running",
  "awaiting_provider",
  "awaiting_user",
  "cancel_requested",
]);

const UNCHANGED_TABLES = [
  "workspace_meta",
  "agents",
  "provider_threads",
  "turns",
  "foreground_turn_queue",
  "provider_message_anchors",
  "foreground_continuations",
  "chat_rooms",
  "chat_messages",
] as const;

type SqlValue = string | number | bigint | Uint8Array | null;
type SqlRow = Record<string, SqlValue>;

interface LegacyTaskRow extends SqlRow {
  task_id: string;
  workspace_id: string;
  source_agent_id: string;
  execution_mode: string;
  title: string;
  goal: string;
  constraints_json: string;
  acceptance_json: string;
  status: string;
  summary: string;
  current_goal_id: string | null;
  current_execution_id: string | null;
  latest_review_direction: string | null;
  source_turn_id: string | null;
  source_goals_card_id: string | null;
  provider_profile_id: string | null;
  budget_strength: string;
  used_failed_reviews: number;
  max_failed_reviews: number;
  active_duration_ms: number;
  token_count: number;
  tool_call_count: number;
  pending_control: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
}

interface LegacyGoalRow extends SqlRow {
  goal_id: string;
  task_id: string;
  goal_order: number;
  title: string;
  goal: string;
  constraints_json: string;
  acceptance_json: string;
  status: string;
  revision: number;
}

interface LegacyExecutionRow extends SqlRow {
  execution_id: string;
  task_id: string;
  goal_id: string | null;
  phase_run_id: string;
  phase_kind: string;
  provider_thread_id: string | null;
  status: string;
  generation: string;
  run_mode_receipt_json: string | null;
  started_at: string | null;
  last_activity_at: string | null;
  completed_at: string | null;
  summary: string | null;
  revision: number;
}

interface MigratedTaskRecord {
  projection: TaskProjection;
  contract: IntentContractProjection;
  originJson: string | null;
  goals: LegacyGoalRow[];
}

interface ExecutionBinding {
  cycleId: string | null;
  workUnitId: string | null;
}

export interface AuthorityV6MigrationAudit {
  workspaceId: string;
  source: {
    agents: number;
    providerThreads: number;
    turns: number;
    cards: number;
    decisions: number;
    tasks: number;
    goals: number;
    executions: number;
    timelineRows: number;
    schedules: number;
    blackboardEntries: number;
    evidenceRefs: number;
  };
  target: {
    agents: number;
    providerThreads: number;
    turns: number;
    cards: number;
    decisions: number;
    tasks: number;
    contracts: number;
    workingSets: number;
    workUnits: number;
    executions: number;
    timelineRows: number;
    schedules: number;
    evidenceRefs: number;
  };
}

export function rebuildAuthoritySchemaV6(input: {
  sourcePath: string;
  targetPath: string;
  workspaceRoot: string;
  migratedAt: string;
}): AuthorityV6MigrationAudit {
  rmSync(input.targetPath, { force: true });
  rmSync(`${input.targetPath}-wal`, { force: true });
  rmSync(`${input.targetPath}-shm`, { force: true });

  const source = new DatabaseSync(input.sourcePath, { readOnly: true });
  const workspace = source.prepare("SELECT workspace_id FROM workspace_meta").get() as
    | { workspace_id: string }
    | undefined;
  if (!workspace?.workspace_id) {
    source.close();
    throw new Error(`Authority database ${input.sourcePath} has no Workspace identity`);
  }

  createWorkspaceDatabase(input.targetPath, workspace.workspace_id);
  const target = new DatabaseSync(input.targetPath);
  const blobs = new ContentAddressedBlobStore(input.workspaceRoot);
  try {
    target.exec("PRAGMA journal_mode = DELETE; PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE;");
    try {
      target.exec("DELETE FROM authority_schema_migrations; DELETE FROM workspace_meta;");
      for (const table of UNCHANGED_TABLES) copyMatchingRows(source, target, table);
      copyMigrationLedger(source, target, input.migratedAt);

      const legacyTasks = source
        .prepare("SELECT * FROM tasks ORDER BY created_at, task_id")
        .all() as LegacyTaskRow[];
      const goalsByTask = groupBy(
        source
          .prepare("SELECT * FROM task_goals ORDER BY task_id, goal_order, goal_id")
          .all() as LegacyGoalRow[],
        (goal) => goal.task_id,
      );
      const decisionsByTask = groupBy(
        source
          .prepare(
            "SELECT decision_id, task_id FROM human_decisions ORDER BY decided_at, decision_id",
          )
          .all() as Array<{ decision_id: string; task_id: string | null }>,
        (decision) => decision.task_id ?? "",
      );

      const migratedTasks = new Map<string, MigratedTaskRecord>();
      for (const task of legacyTasks) {
        const goals = goalsByTask.get(task.task_id) ?? [];
        const humanDecisionRefs = (decisionsByTask.get(task.task_id) ?? []).map(
          (decision) => decision.decision_id,
        );
        const contract = insertLegacyIntentContract({
          target,
          task,
          humanDecisionRefs,
          migratedAt: input.migratedAt,
        });
        const taskStatus = migrateTaskStatus(task);
        const originJson = readLegacyOriginJson(source, blobs, task.task_id);
        const projection = insertMigratedTask({
          target,
          task,
          contract,
          goals,
          status: taskStatus,
          originJson,
          migratedAt: input.migratedAt,
        });
        migratedTasks.set(task.task_id, { projection, contract, originJson, goals });
      }

      const legacyExecutions = source
        .prepare("SELECT * FROM execution_attempts ORDER BY COALESCE(started_at, ''), execution_id")
        .all() as LegacyExecutionRow[];
      const executionBindings = insertLegacyExecutionHistory({
        source,
        target,
        migratedTasks,
        executions: legacyExecutions,
        migratedAt: input.migratedAt,
      });

      copyLegacyCards(source, target, blobs, input.migratedAt);
      copyLegacyHumanDecisions(source, target, blobs);
      copyLegacyExecutionApprovals(source, target, blobs, input.migratedAt);
      copyMatchingRows(source, target, "runtime_attachments");
      copyLegacyTaskDecisionRequests(source, target, input.migratedAt);
      copyMatchingRows(source, target, "timeline_entries");
      copyMatchingRows(source, target, "agent_timeline_meta");
      copyLegacyEvidence({
        source,
        target,
        blobs,
        executionBindings,
        migratedAt: input.migratedAt,
      });
      copyLegacyContextBindings({
        source,
        target,
        blobs,
        migratedTasks,
        migratedAt: input.migratedAt,
      });
      copyLegacyAgentTimeline({ source, target, blobs, migratedTasks });
      copyLegacyCommands(source, target);
      copyLegacyLeases(source, target, migratedTasks, input.migratedAt);
      copyLegacySchedules(source, target);
      copyMatchingRows(source, target, "schedule_runs");

      target.exec("PRAGMA user_version = 6; COMMIT;");
    } catch (error) {
      target.exec("ROLLBACK;");
      throw error;
    }
    target.exec("PRAGMA foreign_keys = ON;");

    const audit = buildAudit(source, target, workspace.workspace_id);
    assertAudit(audit, target);
    return audit;
  } finally {
    target.close();
    source.close();
    rmSync(`${input.targetPath}-wal`, { force: true });
    rmSync(`${input.targetPath}-shm`, { force: true });
  }
}

function copyMigrationLedger(source: DatabaseSync, target: DatabaseSync, migratedAt: string): void {
  const rows = source
    .prepare(
      "SELECT version, checksum, applied_at FROM authority_schema_migrations ORDER BY version",
    )
    .all() as Array<{ version: number; checksum: string; applied_at: string }>;
  const insert = target.prepare(
    "INSERT INTO authority_schema_migrations(version, checksum, applied_at) VALUES (?, ?, ?)",
  );
  for (const row of rows) insert.run(row.version, row.checksum, row.applied_at);
  insert.run(9, AUTHORITY_V6_CHECKSUM, migratedAt);
}

function insertLegacyIntentContract(input: {
  target: DatabaseSync;
  task: LegacyTaskRow;
  humanDecisionRefs: string[];
  migratedAt: string;
}): IntentContractProjection {
  const acceptance = parseStringArray(input.task.acceptance_json);
  if (acceptance.length === 0) {
    throw new Error(`Legacy Task ${input.task.task_id} has no acceptance claim`);
  }
  const contractId = stableId("legacy-contract", input.task.task_id);
  const contract = IntentContractProjectionSchema.parse({
    id: contractId,
    workspaceId: input.task.workspace_id,
    sourceAgentId: input.task.source_agent_id,
    taskId: input.task.task_id,
    title: input.task.title,
    objective: input.task.goal,
    nonGoals: [],
    invariants: parseStringArray(input.task.constraints_json),
    acceptanceClaims: acceptance.map((statement, index) => ({
      id: stableId("legacy-claim", input.task.task_id, String(index + 1)),
      statement,
      status: input.task.status === "completed" ? "satisfied" : "open",
      evidenceRefs: [],
      revision: 1,
    })),
    riskBoundary: [],
    humanDecisionRefs: input.humanDecisionRefs,
    escalationPolicy: { returnToHumanWhen: [], finalConfirmation: "automatic" },
    status: "legacy",
    revision: 1,
    confirmedAt: input.task.created_at,
    createdAt: input.task.created_at,
    updatedAt: input.migratedAt,
  });
  input.target
    .prepare(
      `INSERT INTO intent_contracts(
         contract_id, workspace_id, source_agent_id, task_id, title, objective,
         non_goals_json, invariants_json, risk_boundary_json, human_decision_refs_json,
         escalation_policy_json, status, revision, confirmed_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'legacy', 1, ?, ?, ?)`,
    )
    .run(
      contract.id,
      contract.workspaceId,
      contract.sourceAgentId,
      contract.taskId,
      contract.title,
      contract.objective,
      JSON.stringify(contract.nonGoals),
      JSON.stringify(contract.invariants),
      JSON.stringify(contract.riskBoundary),
      JSON.stringify(contract.humanDecisionRefs),
      JSON.stringify(contract.escalationPolicy),
      contract.confirmedAt,
      contract.createdAt,
      contract.updatedAt,
    );
  const insertClaim = input.target.prepare(
    `INSERT INTO acceptance_claims(
       claim_id, contract_id, claim_order, statement, status, revision
     ) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  contract.acceptanceClaims.forEach((claim, index) => {
    insertClaim.run(
      claim.id,
      contract.id,
      index + 1,
      claim.statement,
      claim.status,
      claim.revision,
    );
  });
  return contract;
}

function insertMigratedTask(input: {
  target: DatabaseSync;
  task: LegacyTaskRow;
  contract: IntentContractProjection;
  goals: LegacyGoalRow[];
  status: TaskProjection["status"];
  originJson: string | null;
  migratedAt: string;
}): TaskProjection {
  const activeGap = deriveActiveGap(input.task, input.goals, input.status);
  const revision = Math.max(1, input.task.revision + (input.status !== input.task.status ? 1 : 0));
  const maxReviews = reviewLimit(input.task.budget_strength);
  input.target
    .prepare(
      `INSERT INTO tasks(
         task_id, workspace_id, source_agent_workspace_id, source_agent_id, execution_mode, title,
         intent_contract_id, status, summary, current_execution_id,
         current_work_unit_id, completion_authority, source_turn_id,
         source_contract_card_id, provider_profile_id, origin_json, budget_strength,
         used_non_complete_reviews, max_non_complete_reviews, active_duration_ms,
         token_count, tool_call_count, pending_control, revision, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
    )
    .run(
      input.task.task_id,
      input.task.workspace_id,
      input.task.workspace_id,
      input.task.source_agent_id,
      input.task.execution_mode,
      input.task.title,
      input.contract.id,
      input.status,
      input.task.summary,
      input.task.status === "completed" ? "legacy" : "none",
      input.task.source_turn_id,
      input.task.source_goals_card_id,
      input.task.provider_profile_id,
      input.originJson,
      normalizeStrength(input.task.budget_strength),
      input.task.used_failed_reviews,
      maxReviews,
      input.task.active_duration_ms,
      input.task.token_count,
      input.task.tool_call_count,
      revision,
      input.task.created_at,
      input.migratedAt,
    );
  input.target
    .prepare(
      `INSERT INTO task_working_sets(
         task_id, active_gap, current_understanding, current_hypothesis, next_move,
         relevant_evidence_refs_json, rejected_routes_json, blockers_json,
         latest_review_decision_id, no_progress_count, revision, updated_at
       ) VALUES (?, ?, ?, '', ?, '[]', '[]', '[]', NULL, 0, 1, ?)`,
    )
    .run(
      input.task.task_id,
      activeGap,
      input.task.summary || "Legacy Task authority migrated without changing its intent.",
      input.status === "completed"
        ? "No next move; the legacy Task is complete."
        : "Freshly orient against the migrated Intent Contract and current Workspace reality.",
      input.migratedAt,
    );

  return TaskProjectionSchema.parse({
    id: input.task.task_id,
    workspaceId: input.task.workspace_id,
    sourceAgentWorkspaceId: input.task.workspace_id,
    sourceAgentId: input.task.source_agent_id,
    mode: input.task.execution_mode,
    title: input.task.title,
    intentContract: input.contract,
    status: input.status,
    summary: input.task.summary,
    currentExecutionId: null,
    currentWorkUnitId: null,
    workingSet: {
      taskId: input.task.task_id,
      activeGap,
      currentUnderstanding:
        input.task.summary || "Legacy Task authority migrated without changing its intent.",
      currentHypothesis: "",
      nextMove:
        input.status === "completed"
          ? "No next move; the legacy Task is complete."
          : "Freshly orient against the migrated Intent Contract and current Workspace reality.",
      relevantEvidenceRefs: [],
      rejectedRoutes: [],
      blockers: [],
      latestReviewDecisionId: null,
      noProgressCount: 0,
      revision: 1,
      updatedAt: input.migratedAt,
    },
    workUnits: [],
    latestReview: null,
    completionAuthority: input.task.status === "completed" ? "legacy" : "none",
    origin: input.originJson ? JSON.parse(input.originJson) : null,
    pendingDecision: null,
    budget: {
      strength: normalizeStrength(input.task.budget_strength),
      usedNonCompleteReviews: input.task.used_failed_reviews,
      maxNonCompleteReviews: maxReviews,
      activeDurationMs: input.task.active_duration_ms,
      tokenCount: input.task.token_count,
      toolCallCount: input.task.tool_call_count,
    },
    pendingControl: null,
    revision,
    createdAt: input.task.created_at,
    updatedAt: input.migratedAt,
  });
}

function insertLegacyExecutionHistory(input: {
  source: DatabaseSync;
  target: DatabaseSync;
  migratedTasks: Map<string, MigratedTaskRecord>;
  executions: LegacyExecutionRow[];
  migratedAt: string;
}): Map<string, ExecutionBinding> {
  const bindings = new Map<string, ExecutionBinding>();
  const latestExecuteByGoal = new Map<string, ExecutionBinding>();
  const cycles = new Map<
    string,
    { taskId: string; status: string; startedAt: string; completedAt: string | null }
  >();
  const workUnits = new Map<string, WorkUnitProjection>();

  for (const execution of input.executions) {
    const task = input.migratedTasks.get(execution.task_id);
    if (!task) throw new Error(`Execution ${execution.execution_id} lost its Task`);
    if (task.projection.mode === "quick") {
      bindings.set(execution.execution_id, { cycleId: null, workUnitId: null });
      continue;
    }
    const phase = migratePhase(execution.phase_kind);
    const goalKey = `${execution.task_id}:${execution.goal_id ?? "none"}`;
    let binding = phase === "review" ? latestExecuteByGoal.get(goalKey) : undefined;
    if (!binding) {
      const cycleId = stableId("legacy-cycle", execution.execution_id);
      const workUnitId = stableId("legacy-work-unit", execution.execution_id);
      binding = { cycleId, workUnitId };
      const goal = task.goals.find((candidate) => candidate.goal_id === execution.goal_id);
      const active = ACTIVE_EXECUTION_STATUSES.has(execution.status);
      cycles.set(cycleId, {
        taskId: execution.task_id,
        status: active ? "interrupted" : "completed",
        startedAt: execution.started_at ?? task.projection.createdAt,
        completedAt: active
          ? input.migratedAt
          : (execution.completed_at ?? execution.last_activity_at),
      });
      workUnits.set(workUnitId, {
        id: workUnitId,
        taskId: execution.task_id,
        cycleId,
        title: goal?.title ?? `Legacy ${phase === "review" ? "review" : "execution"}`,
        activeGap: goal?.goal ?? task.contract.objective,
        progressClaim: execution.summary ?? "Legacy execution history preserved during migration.",
        unresolvedGap: goal?.status === "passed" ? "" : (goal?.goal ?? task.contract.objective),
        evidenceRefs: [],
        status: active ? "abandoned" : execution.status === "failed" ? "abandoned" : "completed",
        revision: 1,
        createdAt: execution.started_at ?? task.projection.createdAt,
        updatedAt: execution.completed_at ?? execution.last_activity_at ?? input.migratedAt,
      });
    }
    bindings.set(execution.execution_id, binding);
    if (phase === "execute") latestExecuteByGoal.set(goalKey, binding);
  }

  const insertCycle = input.target.prepare(
    `INSERT INTO loop_cycles(
       cycle_id, task_id, cycle_order, status, started_at, completed_at
     ) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const orderByTask = new Map<string, number>();
  for (const [cycleId, cycle] of cycles) {
    const order = (orderByTask.get(cycle.taskId) ?? 0) + 1;
    orderByTask.set(cycle.taskId, order);
    insertCycle.run(cycleId, cycle.taskId, order, cycle.status, cycle.startedAt, cycle.completedAt);
  }
  const insertWorkUnit = input.target.prepare(
    `INSERT INTO task_work_units(
       work_unit_id, task_id, cycle_id, title, active_gap, progress_claim,
       unresolved_gap, evidence_refs_json, status, revision, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?)`,
  );
  for (const workUnit of workUnits.values()) {
    insertWorkUnit.run(
      workUnit.id,
      workUnit.taskId,
      workUnit.cycleId,
      workUnit.title,
      workUnit.activeGap,
      workUnit.progressClaim,
      workUnit.unresolvedGap,
      workUnit.status,
      workUnit.revision,
      workUnit.createdAt,
      workUnit.updatedAt,
    );
  }

  const insertExecution = input.target.prepare(
    `INSERT INTO execution_attempts(
       execution_id, task_id, work_unit_id, cycle_id, phase_kind, provider_thread_id,
       status, generation, run_mode_receipt_json, started_at, last_activity_at,
       completed_at, summary, revision
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const execution of input.executions) {
    const binding = bindings.get(execution.execution_id)!;
    const active = ACTIVE_EXECUTION_STATUSES.has(execution.status);
    insertExecution.run(
      execution.execution_id,
      execution.task_id,
      binding.workUnitId,
      binding.cycleId,
      migratePhase(execution.phase_kind),
      execution.provider_thread_id,
      active ? "canceled" : execution.status,
      execution.generation,
      execution.run_mode_receipt_json,
      execution.started_at,
      execution.last_activity_at ?? (active ? input.migratedAt : null),
      execution.completed_at ?? (active ? input.migratedAt : null),
      active
        ? appendMigrationSummary(
            execution.summary,
            "Interrupted by schema-v6 migration; fresh reorientation is required.",
          )
        : execution.summary,
      Math.max(1, execution.revision + (active ? 1 : 0)),
    );
  }
  return bindings;
}

function copyLegacyCards(
  source: DatabaseSync,
  target: DatabaseSync,
  blobs: ContentAddressedBlobStore,
  migratedAt: string,
): void {
  const rows = source.prepare("SELECT * FROM cards ORDER BY created_at, card_id").all() as SqlRow[];
  const insert = target.prepare(
    `INSERT INTO cards(
       card_id, turn_id, task_id, kind, status, displayed_digest, answer_digest,
       submitted_summary, runtime_digest, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const row of rows) {
    const kind = String(row.kind);
    const migratedKind =
      kind === "task_card"
        ? "legacy_task_card"
        : kind === "goal_card"
          ? "legacy_goal_card"
          : kind === "clarify_card"
            ? "legacy_clarify_card"
            : kind;
    const displayed = ensureReadableDigest(blobs, String(row.displayed_digest), "displayed card");
    const answer =
      typeof row.answer_digest === "string"
        ? ensureReadableDigest(blobs, row.answer_digest, "card answer")
        : null;
    const runtime =
      typeof row.runtime_digest === "string"
        ? ensureReadableDigest(blobs, row.runtime_digest, "card runtime binding")
        : null;
    insert.run(
      row.card_id,
      row.turn_id,
      row.task_id,
      migratedKind,
      row.status === "pending" ? "canceled" : row.status,
      displayed,
      answer,
      row.submitted_summary,
      runtime,
      row.created_at,
      row.status === "pending" ? migratedAt : row.updated_at,
    );
  }
}

function copyLegacyHumanDecisions(
  source: DatabaseSync,
  target: DatabaseSync,
  blobs: ContentAddressedBlobStore,
): void {
  const rows = source
    .prepare("SELECT * FROM human_decisions ORDER BY decided_at, decision_id")
    .all() as SqlRow[];
  const columns = tableColumns(target, "human_decisions");
  const insert = prepareInsert(target, "human_decisions", columns);
  for (const row of rows) {
    const displayed = ensureReadableDigest(
      blobs,
      String(row.displayed_digest),
      "displayed decision",
    );
    const rawAnswer = ensureReadableDigest(blobs, String(row.raw_answer_digest), "raw answer");
    const normalized = ensureReadableDigest(
      blobs,
      String(row.normalized_digest),
      "normalized decision",
    );
    const unavailable =
      displayed !== row.displayed_digest ||
      rawAnswer !== row.raw_answer_digest ||
      normalized !== row.normalized_digest;
    runInsert(insert, columns, {
      ...row,
      displayed_digest: displayed,
      raw_answer_digest: rawAnswer,
      normalized_digest: normalized,
      fidelity: unavailable ? "unavailable" : row.fidelity,
    });
  }
}

function copyLegacyExecutionApprovals(
  source: DatabaseSync,
  target: DatabaseSync,
  blobs: ContentAddressedBlobStore,
  migratedAt: string,
): void {
  const rows = source
    .prepare("SELECT * FROM execution_approvals ORDER BY created_at, approval_id")
    .all() as SqlRow[];
  const columns = tableColumns(target, "execution_approvals");
  const insert = prepareInsert(target, "execution_approvals", columns);
  for (const row of rows) {
    const next: SqlRow = { ...row };
    next.displayed_digest = ensureReadableDigest(
      blobs,
      String(row.displayed_digest),
      "execution approval",
    );
    if (row.status === "pending") {
      next.status = "canceled";
      next.deadline_at = null;
      next.revision = Number(row.revision) + 1;
      next.updated_at = migratedAt;
    }
    runInsert(insert, columns, next);
  }
}

function copyLegacyTaskDecisionRequests(
  source: DatabaseSync,
  target: DatabaseSync,
  migratedAt: string,
): void {
  const rows = source
    .prepare("SELECT * FROM task_decision_requests ORDER BY created_at, decision_id")
    .all() as SqlRow[];
  const columns = tableColumns(target, "task_decision_requests");
  const insert = prepareInsert(target, "task_decision_requests", columns);
  for (const row of rows) {
    runInsert(insert, columns, {
      ...row,
      status: row.status === "pending" ? "answered" : row.status,
      answered_at: row.status === "pending" ? migratedAt : row.answered_at,
    });
  }
}

function copyLegacyEvidence(input: {
  source: DatabaseSync;
  target: DatabaseSync;
  blobs: ContentAddressedBlobStore;
  executionBindings: Map<string, ExecutionBinding>;
  migratedAt: string;
}): void {
  const usedIds = new Set<string>();
  const evidenceByTask = new Map<string, string[]>();
  const insert = input.target.prepare(
    `INSERT INTO evidence_refs(
       evidence_id, task_id, execution_id, work_unit_id, kind, summary,
       content_digest, artifact_ref, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const existing = input.source
    .prepare("SELECT * FROM evidence_refs ORDER BY created_at, evidence_id")
    .all() as SqlRow[];
  for (const row of existing) {
    const id = String(row.evidence_id);
    usedIds.add(id);
    const taskId = String(row.task_id);
    evidenceByTask.set(taskId, [...(evidenceByTask.get(taskId) ?? []), id]);
    const executionId = typeof row.execution_id === "string" ? row.execution_id : null;
    insert.run(
      id,
      row.task_id,
      executionId,
      executionId ? (input.executionBindings.get(executionId)?.workUnitId ?? null) : null,
      row.kind,
      `Migrated ${humanize(String(row.kind))} evidence.`,
      ensureReadableDigest(input.blobs, String(row.content_digest), "legacy evidence"),
      null,
      row.created_at,
    );
  }
  const blackboard = input.source
    .prepare("SELECT * FROM task_blackboard ORDER BY created_at, entry_id")
    .all() as SqlRow[];
  for (const row of blackboard) {
    let id = stableId("legacy-evidence", String(row.entry_id));
    if (usedIds.has(id)) id = stableId("legacy-evidence", String(row.entry_id), "blackboard");
    usedIds.add(id);
    const taskId = String(row.task_id);
    evidenceByTask.set(taskId, [...(evidenceByTask.get(taskId) ?? []), id]);
    insert.run(
      id,
      row.task_id,
      null,
      null,
      `legacy_${String(row.kind)}`,
      `Migrated ${humanize(String(row.kind))} from the legacy Task memory.`,
      ensureReadableDigest(input.blobs, String(row.content_digest), "legacy Task memory"),
      null,
      row.created_at ?? input.migratedAt,
    );
  }
  const updateWorkingSet = input.target.prepare(
    `UPDATE task_working_sets
     SET relevant_evidence_refs_json = ?
     WHERE task_id = ?`,
  );
  for (const [taskId, evidenceIds] of evidenceByTask) {
    updateWorkingSet.run(JSON.stringify(evidenceIds), taskId);
  }
}

function copyLegacyContextBindings(input: {
  source: DatabaseSync;
  target: DatabaseSync;
  blobs: ContentAddressedBlobStore;
  migratedTasks: Map<string, MigratedTaskRecord>;
  migratedAt: string;
}): void {
  const rows = input.source
    .prepare("SELECT * FROM context_bindings ORDER BY created_at, binding_id")
    .all() as SqlRow[];
  const insert = input.target.prepare(
    `INSERT INTO context_bindings(
       binding_id, agent_id, turn_id, task_workspace_id, task_id,
       task_revision, context_digest, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const row of rows) {
    const taskId = String(row.task_id);
    const task = hydrateMigratedTaskProjection(input.target, input.migratedTasks, taskId);
    if (!task) throw new Error(`Context binding ${String(row.binding_id)} lost Task ${taskId}`);
    const context = buildContextEnvelope({
      target: input.target,
      blobs: input.blobs,
      task,
      generatedAt: String(row.created_at ?? input.migratedAt),
    });
    const snapshot = input.blobs.putJson(context);
    insert.run(
      row.binding_id,
      row.agent_id,
      row.turn_id,
      task.workspaceId,
      taskId,
      task.revision,
      snapshot.digest,
      row.created_at,
    );
  }
}

function copyLegacyAgentTimeline(input: {
  source: DatabaseSync;
  target: DatabaseSync;
  blobs: ContentAddressedBlobStore;
  migratedTasks: Map<string, MigratedTaskRecord>;
}): void {
  const cardTask = new Map<string, string>();
  for (const row of input.source
    .prepare("SELECT card_id, task_id FROM cards WHERE task_id IS NOT NULL")
    .all() as Array<{ card_id: string; task_id: string }>) {
    cardTask.set(row.card_id, row.task_id);
  }
  const rows = input.source
    .prepare("SELECT * FROM agent_timeline_rows ORDER BY agent_id, seq")
    .all() as SqlRow[];
  const insert = input.target.prepare(
    `INSERT INTO agent_timeline_rows(agent_id, seq, timestamp, item_json, item_digest)
     VALUES (?, ?, ?, ?, ?)`,
  );
  for (const row of rows) {
    const raw =
      typeof row.item_json === "string"
        ? (JSON.parse(row.item_json) as unknown)
        : input.blobs.readJson(String(row.item_digest));
    const migrated = migrateTimelineItem(raw, cardTask, input.target, input.migratedTasks);
    const serialized = JSON.stringify(migrated);
    const stored =
      Buffer.byteLength(serialized, "utf8") > 16_384 ? input.blobs.put(serialized) : null;
    insert.run(
      row.agent_id,
      row.seq,
      row.timestamp,
      stored ? null : serialized,
      stored?.digest ?? null,
    );
  }
}

function migrateTimelineItem(
  raw: unknown,
  cardTask: Map<string, string>,
  target: DatabaseSync,
  migratedTasks: Map<string, MigratedTaskRecord>,
): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const item = raw as Record<string, unknown>;
  if (item.type === "registered_task") {
    const legacyTask = item.task as { id?: unknown } | undefined;
    const taskId = typeof legacyTask?.id === "string" ? legacyTask.id : null;
    return taskId
      ? {
          type: "registered_task",
          task: hydrateMigratedTaskProjection(target, migratedTasks, taskId),
        }
      : raw;
  }
  if (item.type === "task_card") {
    const card = item.card as Record<string, unknown> | undefined;
    const cardId = typeof card?.id === "string" ? card.id : null;
    const taskId = cardId ? cardTask.get(cardId) : undefined;
    const task = taskId ? hydrateMigratedTaskProjection(target, migratedTasks, taskId) : null;
    if (!cardId || !task) return legacyCardSummary("Legacy Task contract", card);
    return {
      type: "intent_contract_card",
      card: {
        id: cardId,
        sessionId: stableId("legacy-clarify-session", task.sourceAgentId, task.id),
        contract: task.intentContract,
        provenanceSummary: "Migrated from the confirmed legacy Task Card.",
        turnControls: normalizeLegacyTurnControls(card?.turnControls),
        submitted: card?.submitted === true,
        ...(typeof card?.submittedSummary === "string"
          ? { submittedSummary: card.submittedSummary }
          : {}),
      },
    };
  }
  if (item.type === "goal_card") {
    const card = item.card as Record<string, unknown> | undefined;
    const goals = Array.isArray(card?.goals) ? card.goals : [];
    return {
      type: "legacy_execution_plan",
      title: typeof card?.title === "string" ? card.title : "Legacy execution plan",
      summary:
        typeof card?.summary === "string"
          ? card.summary
          : "This plan is preserved for history and is not active Task authority.",
      items: goals.map((goal) => {
        const value = goal && typeof goal === "object" ? (goal as Record<string, unknown>) : {};
        return {
          title: typeof value.title === "string" ? value.title : "Legacy step",
          outcome: "Preserved as read-only history",
          objective: typeof value.goal === "string" ? value.goal : "",
          constraints: parseUnknownStringArray(value.constraints),
          acceptance: parseUnknownStringArray(value.acceptance),
        };
      }),
    };
  }
  if (item.type === "clarify_card") {
    const card = item.card as Record<string, unknown> | undefined;
    return legacyCardSummary("Legacy Clarify decision", card);
  }
  return raw;
}

function legacyCardSummary(title: string, card: Record<string, unknown> | undefined): unknown {
  return {
    type: "assistant_message",
    text: [
      title,
      typeof card?.title === "string" ? card.title : null,
      typeof card?.submittedSummary === "string" ? card.submittedSummary : null,
    ]
      .filter((value): value is string => Boolean(value))
      .join(": "),
  };
}

function copyLegacyCommands(source: DatabaseSync, target: DatabaseSync): void {
  const rows = source
    .prepare("SELECT * FROM authority_commands ORDER BY created_at, command_id")
    .all() as SqlRow[];
  const columns = tableColumns(target, "authority_commands");
  const insert = prepareInsert(target, "authority_commands", columns, "OR IGNORE");
  for (const row of rows) runInsert(insert, columns, row);
}

function copyLegacyLeases(
  source: DatabaseSync,
  target: DatabaseSync,
  migratedTasks: Map<string, MigratedTaskRecord>,
  migratedAt: string,
): void {
  const rows = source
    .prepare("SELECT * FROM workspace_leases ORDER BY lease_key")
    .all() as SqlRow[];
  const columns = tableColumns(target, "workspace_leases");
  const insert = prepareInsert(target, "workspace_leases", columns);
  for (const row of rows) {
    const task = migratedTasks.get(String(row.task_id));
    if (!task || ["reorienting", "interrupted"].includes(task.projection.status)) continue;
    runInsert(insert, columns, { ...row, updated_at: migratedAt });
  }
}

function copyLegacySchedules(source: DatabaseSync, target: DatabaseSync): void {
  const rows = source
    .prepare("SELECT * FROM schedules ORDER BY created_at, schedule_id")
    .all() as SqlRow[];
  const insert = target.prepare(
    `INSERT INTO schedules(
       schedule_id, name, prompt, cadence_json, target_json, intent_contract_id,
       status, created_at, updated_at, next_run_at, last_run_at, paused_at,
       expires_at, max_runs
     ) VALUES (?, ?, ?, ?, ?, NULL, 'needs_contract', ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const row of rows) {
    insert.run(
      row.schedule_id,
      row.name,
      row.prompt,
      row.cadence_json,
      row.target_json,
      row.created_at,
      row.updated_at,
      row.next_run_at,
      row.last_run_at,
      row.paused_at,
      row.expires_at,
      row.max_runs,
    );
  }
}

function hydrateMigratedTaskProjection(
  target: DatabaseSync,
  migratedTasks: Map<string, MigratedTaskRecord>,
  taskId: string,
): TaskProjection | null {
  const record = migratedTasks.get(taskId);
  if (!record) return null;
  const workUnits = target
    .prepare("SELECT * FROM task_work_units WHERE task_id = ? ORDER BY created_at, work_unit_id")
    .all(taskId) as SqlRow[];
  const evidence = target
    .prepare(
      "SELECT evidence_id FROM evidence_refs WHERE task_id = ? ORDER BY created_at, evidence_id",
    )
    .all(taskId) as Array<{ evidence_id: string }>;
  return TaskProjectionSchema.parse({
    ...record.projection,
    workingSet: {
      ...record.projection.workingSet,
      relevantEvidenceRefs: evidence.map((item) => item.evidence_id),
    },
    workUnits: workUnits.map(toWorkUnitProjection),
  });
}

function buildContextEnvelope(input: {
  target: DatabaseSync;
  blobs: ContentAddressedBlobStore;
  task: TaskProjection;
  generatedAt: string;
}): unknown {
  const decisions = input.target
    .prepare("SELECT * FROM human_decisions WHERE task_id = ? ORDER BY decided_at, decision_id")
    .all(input.task.id) as SqlRow[];
  const evidence = input.target
    .prepare("SELECT * FROM evidence_refs WHERE task_id = ? ORDER BY created_at, evidence_id")
    .all(input.task.id) as SqlRow[];
  return TaskContextEnvelopeSchema.parse({
    reference: {
      kind: "task",
      workspaceId: input.task.workspaceId,
      taskId: input.task.id,
      revision: input.task.revision,
    },
    task: input.task,
    decisions: decisions.map((row) => toHumanDecision(row, input.task.workspaceId, input.blobs)),
    evidence: evidence.map(toEvidenceProjection),
    generatedAt: input.generatedAt,
  });
}

function toHumanDecision(
  row: SqlRow,
  workspaceId: string,
  blobs: ContentAddressedBlobStore,
): HumanDecisionRecord {
  const displayed = readJsonOrUnavailable(
    blobs,
    String(row.displayed_digest),
    "displayed decision",
  );
  const rawAnswer = readJsonOrUnavailable(blobs, String(row.raw_answer_digest), "raw answer");
  const normalized = readJsonOrUnavailable(
    blobs,
    String(row.normalized_digest),
    "normalized decision",
  );
  const unavailable = [displayed, rawAnswer, normalized].some(isUnavailablePayload);
  return HumanDecisionRecordSchema.parse({
    id: row.decision_id,
    workspaceId,
    taskId: row.task_id,
    turnId: row.turn_id,
    cardId: row.card_id,
    kind: row.kind,
    displayed,
    rawAnswer,
    normalized,
    actorId: row.actor_id,
    clientId: row.client_id,
    deviceId: row.device_id,
    commandId: row.command_id,
    expectedRevision: row.expected_revision,
    resultRevision: row.result_revision,
    supersedesDecisionId: row.supersedes_decision_id,
    fidelity: unavailable ? "unavailable" : row.fidelity,
    decidedAt: row.decided_at,
  });
}

function toEvidenceProjection(row: SqlRow): EvidenceRef {
  return {
    id: String(row.evidence_id),
    taskId: String(row.task_id),
    executionId: typeof row.execution_id === "string" ? row.execution_id : null,
    workUnitId: typeof row.work_unit_id === "string" ? row.work_unit_id : null,
    kind: String(row.kind),
    summary: String(row.summary),
    contentDigest: String(row.content_digest),
    artifactRef: typeof row.artifact_ref === "string" ? row.artifact_ref : null,
    createdAt: String(row.created_at),
  };
}

function toWorkUnitProjection(row: SqlRow): WorkUnitProjection {
  return {
    id: String(row.work_unit_id),
    taskId: String(row.task_id),
    cycleId: String(row.cycle_id),
    title: String(row.title),
    activeGap: String(row.active_gap),
    progressClaim: String(row.progress_claim),
    unresolvedGap: String(row.unresolved_gap),
    evidenceRefs: parseStringArray(String(row.evidence_refs_json)),
    status: row.status as WorkUnitProjection["status"],
    revision: Number(row.revision),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function readLegacyOriginJson(
  source: DatabaseSync,
  blobs: ContentAddressedBlobStore,
  taskId: string,
): string | null {
  const row = source
    .prepare(
      `SELECT content_digest FROM task_blackboard
       WHERE task_id = ? AND kind = 'task_contract'
       ORDER BY created_at DESC, entry_id DESC LIMIT 1`,
    )
    .get(taskId) as { content_digest: string } | undefined;
  if (!row || !blobs.has(row.content_digest)) return null;
  const content = blobs.readJson(row.content_digest);
  if (!content || typeof content !== "object" || Array.isArray(content)) return null;
  const contract = content as Record<string, unknown>;
  if (
    contract.source !== "schedule" ||
    typeof contract.ownerWorkspaceId !== "string" ||
    typeof contract.scheduleId !== "string" ||
    typeof contract.runId !== "string"
  ) {
    return null;
  }
  return JSON.stringify({
    type: "schedule",
    ownerWorkspaceId: contract.ownerWorkspaceId,
    scheduleId: contract.scheduleId,
    runId: contract.runId,
  });
}

function buildAudit(
  source: DatabaseSync,
  target: DatabaseSync,
  workspaceId: string,
): AuthorityV6MigrationAudit {
  return {
    workspaceId,
    source: {
      agents: countRows(source, "agents"),
      providerThreads: countRows(source, "provider_threads"),
      turns: countRows(source, "turns"),
      cards: countRows(source, "cards"),
      decisions: countRows(source, "human_decisions"),
      tasks: countRows(source, "tasks"),
      goals: countRows(source, "task_goals"),
      executions: countRows(source, "execution_attempts"),
      timelineRows: countRows(source, "agent_timeline_rows"),
      schedules: countRows(source, "schedules"),
      blackboardEntries: countRows(source, "task_blackboard"),
      evidenceRefs: countRows(source, "evidence_refs"),
    },
    target: {
      agents: countRows(target, "agents"),
      providerThreads: countRows(target, "provider_threads"),
      turns: countRows(target, "turns"),
      cards: countRows(target, "cards"),
      decisions: countRows(target, "human_decisions"),
      tasks: countRows(target, "tasks"),
      contracts: countRows(target, "intent_contracts"),
      workingSets: countRows(target, "task_working_sets"),
      workUnits: countRows(target, "task_work_units"),
      executions: countRows(target, "execution_attempts"),
      timelineRows: countRows(target, "agent_timeline_rows"),
      schedules: countRows(target, "schedules"),
      evidenceRefs: countRows(target, "evidence_refs"),
    },
  };
}

function assertAudit(audit: AuthorityV6MigrationAudit, target: DatabaseSync): void {
  for (const key of [
    "agents",
    "providerThreads",
    "turns",
    "cards",
    "decisions",
    "tasks",
    "executions",
    "timelineRows",
    "schedules",
  ] as const) {
    if (audit.source[key] !== audit.target[key]) {
      throw new Error(
        `Authority v6 migration changed ${key} count from ${audit.source[key]} to ${audit.target[key]}`,
      );
    }
  }
  if (
    audit.target.contracts !== audit.source.tasks ||
    audit.target.workingSets !== audit.source.tasks
  ) {
    throw new Error(
      "Authority v6 migration did not create exactly one Contract and Working Set per Task",
    );
  }
  if (audit.target.evidenceRefs !== audit.source.evidenceRefs + audit.source.blackboardEntries) {
    throw new Error(
      "Authority v6 migration did not preserve every Evidence and legacy Blackboard entry",
    );
  }
  for (const removed of ["task_goals", "task_blackboard", "phase_runs", "authority_events"]) {
    if (hasTable(target, removed)) throw new Error(`Authority v6 still contains ${removed}`);
  }
  const activeLegacyExecutions = Number(
    (
      target
        .prepare(
          `SELECT COUNT(*) AS count FROM execution_attempts
           WHERE status IN (
             'created', 'starting', 'planning', 'awaiting_implementation', 'implementing',
             'running', 'awaiting_provider', 'awaiting_user', 'cancel_requested'
           )`,
        )
        .get() as { count: number }
    ).count,
  );
  if (activeLegacyExecutions !== 0) {
    throw new Error("Authority v6 migration left a legacy Execution active");
  }
}

function copyMatchingRows(source: DatabaseSync, target: DatabaseSync, table: string): void {
  if (!hasTable(source, table) || !hasTable(target, table)) return;
  const sourceColumns = new Set(tableColumns(source, table));
  const columns = tableColumns(target, table).filter((column) => sourceColumns.has(column));
  if (columns.length === 0) return;
  const rows = source
    .prepare(`SELECT ${columns.map(quoteIdentifier).join(", ")} FROM ${quoteIdentifier(table)}`)
    .all() as SqlRow[];
  const insert = prepareInsert(target, table, columns);
  for (const row of rows) runInsert(insert, columns, row);
}

function prepareInsert(
  database: DatabaseSync,
  table: string,
  columns: string[],
  modifier = "",
): StatementSync {
  return database.prepare(
    `INSERT ${modifier} INTO ${quoteIdentifier(table)}(${columns.map(quoteIdentifier).join(", ")})
     VALUES (${columns.map(() => "?").join(", ")})`,
  );
}

function runInsert(statement: StatementSync, columns: string[], row: SqlRow): void {
  statement.run(...columns.map((column) => row[column] ?? null));
}

function tableColumns(database: DatabaseSync, table: string): string[] {
  return (
    database.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all() as Array<{
      name: string;
    }>
  ).map((column) => column.name);
}

function countRows(database: DatabaseSync, table: string): number {
  return Number(
    (
      database.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`).get() as {
        count: number;
      }
    ).count,
  );
}

function hasTable(database: DatabaseSync, table: string): boolean {
  return Boolean(
    database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table),
  );
}

function stableId(prefix: string, ...parts: string[]): string {
  return `${prefix}-${createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 32)}`;
}

function migrateTaskStatus(task: LegacyTaskRow): TaskProjection["status"] {
  if (task.status === "completed") return "completed";
  if (task.status === "stopped") return "stopped";
  if (task.status === "paused") return "paused";
  if (task.status === "budget_wait") return "budget_wait";
  return task.execution_mode === "quick" ? "interrupted" : "reorienting";
}

function migratePhase(value: string): "quick_exec" | "execute" | "review" {
  switch (value) {
    case "quick_exec":
      return "quick_exec";
    case "planexec":
      return "execute";
    case "review":
    case "audit":
      return "review";
    default:
      throw new Error(`Unsupported legacy execution phase: ${value}`);
  }
}

function normalizeStrength(value: string): "single" | "light" | "balanced" | "infinite" {
  switch (value) {
    case "single":
    case "light":
    case "balanced":
    case "infinite":
      return value;
    default:
      throw new Error(`Unsupported legacy Task strength: ${value}`);
  }
}

function reviewLimit(value: string): number | null {
  switch (normalizeStrength(value)) {
    case "single":
      return 1;
    case "light":
      return 5;
    case "balanced":
      return 10;
    case "infinite":
      return null;
  }
}

function deriveActiveGap(
  task: LegacyTaskRow,
  goals: LegacyGoalRow[],
  status: TaskProjection["status"],
): string {
  if (status === "completed") return "No remaining gap; this legacy Task was completed.";
  const current = goals.find((goal) => goal.goal_id === task.current_goal_id);
  return current?.goal ?? task.goal;
}

function normalizeLegacyTurnControls(value: unknown): unknown {
  const controls = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const strength = controls.clarifyStrength === "deep" ? "dive" : controls.clarifyStrength;
  return {
    mode: controls.mode === "loop" ? "loop" : "quick",
    clarifyStrength:
      typeof strength === "string" &&
      ["none", "auto", "light", "balanced", "dive"].includes(strength)
        ? strength
        : "auto",
    loop: typeof controls.loop === "string" ? controls.loop : null,
  };
}

function ensureReadableDigest(
  blobs: ContentAddressedBlobStore,
  digest: string,
  label: string,
): string {
  if (blobs.has(digest)) return digest;
  return blobs.putJson({
    unavailable: true,
    reason: `The ${label} blob was already absent before schema-v6 migration.`,
    originalDigest: digest,
  }).digest;
}

function readJsonOrUnavailable(
  blobs: ContentAddressedBlobStore,
  digest: string,
  label: string,
): unknown {
  if (blobs.has(digest)) return blobs.readJson(digest);
  return {
    unavailable: true,
    reason: `The ${label} blob was already absent before schema-v6 migration.`,
    originalDigest: digest,
  };
}

function isUnavailablePayload(value: unknown): boolean {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).unavailable === true,
  );
}

function parseStringArray(value: string): string[] {
  return parseUnknownStringArray(JSON.parse(value) as unknown);
}

function parseUnknownStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
}

function appendMigrationSummary(current: string | null, suffix: string): string {
  return current ? `${current}\n\n${suffix}` : suffix;
}

function humanize(value: string): string {
  return value.replaceAll("_", " ");
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const id = key(row);
    const values = grouped.get(id) ?? [];
    values.push(row);
    grouped.set(id, values);
  }
  return grouped;
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export function removeMigrationTarget(filePath: string): void {
  rmSync(filePath, { force: true });
  rmSync(`${filePath}-wal`, { force: true });
  rmSync(`${filePath}-shm`, { force: true });
}

export function authorityV6TargetExists(filePath: string): boolean {
  return existsSync(filePath) || existsSync(`${filePath}-wal`) || existsSync(`${filePath}-shm`);
}

export function workspaceRootForAuthority(filePath: string): string {
  return path.dirname(filePath);
}
