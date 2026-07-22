import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  ExecutionApprovalProjectionSchema,
  ExecutionProjectionSchema,
  HumanDecisionRecordSchema,
  TaskBlackboardEntrySchema,
  TaskContextEnvelopeSchema,
  TaskProjectionSchema,
  TaskUserDecisionProjectionSchema,
  type ExecutionLifecycle,
  type ExecutionApprovalDecision,
  type ExecutionApprovalProjection,
  type ExecutionProjection,
  type HumanDecisionRecord,
  type RuntimeAttachmentProjection,
  type TaskBlackboardEntry,
  type TaskCommand,
  type TaskContextEnvelope,
  type TaskContextReference,
  type TaskProjection,
  type TaskUserDecisionProjection,
} from "@thoth/protocol/task-authority";
import type { HarnessApprovalRequest, RuntimeAttachmentReceipt } from "@thoth/drivers/harness";
import {
  ProviderRunModeReceiptSchema,
  ProviderRunModeSchema,
  type ProviderRunModeReceipt,
} from "@thoth/protocol/provider-control";
import { parseStoredAgentRecord, type StoredAgentRecord } from "../agent/agent-storage.js";
import type {
  AgentTimelineItem,
  ProviderMessageAnchorReceipt,
  ProviderRewindScope,
} from "@thoth/drivers/agent-runtime";
import type { AgentTimelineRow } from "@thoth/drivers/internal/server/agent/agent-timeline-store-types";
import {
  AgentThothLifecycleSchema,
  ThothApprovalGoalCardModelSchema,
  ThothCardAnswerPayloadSchema,
  ThothClarifyCardModelSchema,
  ThothTaskCardModelSchema,
  ThothTurnControlSnapshotSchema,
  type AgentThothLifecycle,
  type AgentThothState,
  type ThothCardAnswerPayload,
} from "@thoth/protocol/thoth/rpc-schemas";
import type {
  ThothLoopPlanExecResultInput,
  ThothLoopReportBlockedInput,
  ThothLoopReviewIndependentAssessmentInput,
  ThothLoopReviewVerdictInput,
} from "@thoth/protocol/thoth-runtime-contract";
import {
  AgentMessageDeliveryModeSchema,
  AgentQueuedTurnSchema,
  type AgentQueuedTurn,
} from "@thoth/protocol/agent-turn-queue";
import { ContentAddressedBlobStore } from "./blob-store.js";
import type { WorkspaceCatalogStore } from "./catalog-store.js";
import {
  WorkspaceForegroundProjection,
  type ForegroundAgentAuthorityRow,
  type ForegroundCardRow,
  type ForegroundTurnRow,
} from "./foreground-projection.js";
import type {
  AnswerForegroundCardResult,
  ForegroundAuthorityCard,
  ForegroundAuthorityCardKind,
  ForegroundAuthorityRuntimeBinding,
  ForegroundAuthorityUpdateReason,
  ForegroundCardAuthorityRecord,
  ForegroundQueuedSubmission,
  ForegroundQueueCommandInput,
  ForegroundQueueCommandResult,
  ForegroundTurnAuthorityRecord,
  StartForegroundTurnInput,
  StartForegroundTurnResult,
} from "./foreground-authority-types.js";
import { deriveDurableGoalId } from "./task-identity.js";
import { WorkspaceCoordinationRepository } from "./coordination-repository.js";

export interface WorkspaceAuthorityUpdate {
  workspaceId: string;
  seq: number;
  changedTaskIds: string[];
  changedExecutionIds: string[];
}

interface TaskRow extends Record<string, unknown> {
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

interface ExecutionRow extends Record<string, unknown> {
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

function updateQueuedSubmissionText(payload: unknown, text: string): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Queued turn payload is invalid.");
  }
  const submission = payload as Record<string, unknown>;
  const normalizedText = text.trim();
  const rawPrompt = submission.rawPrompt;
  let updatedPrompt: unknown;
  if (typeof rawPrompt === "string") {
    updatedPrompt = normalizedText;
  } else if (Array.isArray(rawPrompt)) {
    const nonTextBlocks = rawPrompt.filter(
      (block) =>
        !block ||
        typeof block !== "object" ||
        Array.isArray(block) ||
        (block as Record<string, unknown>).type !== "text",
    );
    updatedPrompt = normalizedText
      ? [{ type: "text", text: normalizedText }, ...nonTextBlocks]
      : nonTextBlocks;
  } else {
    throw new Error("Queued turn prompt is invalid.");
  }
  return {
    ...submission,
    text,
    rawPrompt: updatedPrompt,
  };
}

interface ExecutionApprovalRow extends Record<string, unknown> {
  approval_id: string;
  provider_request_id: string;
  task_id: string;
  execution_id: string;
  generation: string;
  kind: string;
  title: string;
  description: string | null;
  displayed_digest: string;
  auto_approve_eligible: number;
  deadline_at: string | null;
  status: string;
  resolution_decision: string | null;
  resolution_actor_id: string | null;
  resolved_at: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
}

export interface ExecutionApprovalAuthorityResult {
  task: TaskProjection;
  execution: ExecutionProjection;
  approval: ExecutionApprovalProjection;
  duplicate: boolean;
}

export interface TaskRuntimeMetadata {
  sourceTurnId: string;
  sourceGoalsCardId: string;
  providerProfileId: string;
  goalsRevision: number;
}

export interface ProviderThreadRecord {
  id: string;
  adapterId: string;
  nativeHandle: string | null;
  persistence: Record<string, unknown> | null;
  lineageParentId: string | null;
  status: string;
}

export interface LegacyForegroundImport {
  agentId: string;
  revision: number;
  activeTurnId: string | null;
  lifecycle: AgentThothLifecycle;
  backgroundTaskId: string | null;
  error: string | null;
  updatedAt: string;
  turns: Array<{
    id: string;
    generation: string;
    kind: "raw" | "thoth";
    lifecycle: AgentThothLifecycle;
    controls: unknown | null;
    sourceMessageId: string | null;
    workspacePath: string;
    userText: string;
    providerTurnId: string | null;
    backgroundTaskId: string | null;
    error: string | null;
    startedAt: string;
    updatedAt: string;
    cards: Array<{
      id: string;
      kind: ForegroundAuthorityCardKind;
      status: "pending" | "answered" | "canceled" | "blocked";
      card: unknown;
      answer: unknown | null;
      submittedSummary: string | null;
      runtime: ForegroundAuthorityRuntimeBinding;
      commandId: string | null;
      createdAt: string;
      updatedAt: string;
    }>;
  }>;
}

type WorkspaceAuthoritySubscriber = (update: WorkspaceAuthorityUpdate) => void;
type ForegroundAuthoritySubscriber = (
  state: AgentThothState,
  reason: ForegroundAuthorityUpdateReason,
) => void;

function nowIso(): string {
  return new Date().toISOString();
}

function digestJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function parseStringArray(value: string): string[] {
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed)
    ? parsed.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function assertWorkspaceId(workspaceId: string): void {
  if (!/^[A-Za-z0-9._-]+$/u.test(workspaceId)) {
    throw new Error(`Invalid workspace id: ${workspaceId}`);
  }
}

function nextTaskStrength(strength: TaskProjection["budget"]["strength"]): {
  strength: TaskProjection["budget"]["strength"];
  maxFailedReviews: number;
} | null {
  switch (strength) {
    case "single":
      return { strength: "light", maxFailedReviews: 5 };
    case "light":
      return { strength: "balanced", maxFailedReviews: 10 };
    case "balanced":
      return { strength: "infinite", maxFailedReviews: 30 };
    case "infinite":
      return null;
  }
}

export class WorkspaceAuthorityConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceAuthorityConflictError";
  }
}

/**
 * The single durable writer for one Workspace. Current projections and small
 * append-only event deltas commit in the same SQLite transaction.
 */
export class WorkspaceAuthorityStore {
  readonly workspaceId: string;
  readonly workspaceRoot: string;
  readonly blobs: ContentAddressedBlobStore;
  readonly coordination: WorkspaceCoordinationRepository;

  private readonly database: DatabaseSync;
  private readonly catalog: WorkspaceCatalogStore;
  private readonly subscribers = new Set<WorkspaceAuthoritySubscriber>();
  private readonly foregroundSubscribers = new Set<ForegroundAuthoritySubscriber>();

  constructor(input: { thothHome: string; workspaceId: string; catalog: WorkspaceCatalogStore }) {
    assertWorkspaceId(input.workspaceId);
    this.workspaceId = input.workspaceId;
    this.catalog = input.catalog;
    this.workspaceRoot = path.join(input.thothHome, "workspaces", input.workspaceId);
    mkdirSync(this.workspaceRoot, { recursive: true });
    this.blobs = new ContentAddressedBlobStore(this.workspaceRoot);
    this.database = new DatabaseSync(path.join(this.workspaceRoot, "authority.sqlite"), {
      enableForeignKeyConstraints: true,
    });
    this.database.exec(
      "PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;",
    );
    this.coordination = new WorkspaceCoordinationRepository(this.database);
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS authority_schema_migrations (
        version INTEGER PRIMARY KEY NOT NULL,
        checksum TEXT NOT NULL,
        applied_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS workspace_meta (
        workspace_id TEXT PRIMARY KEY NOT NULL,
        authority_revision INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS agents (
        agent_id TEXT PRIMARY KEY NOT NULL,
        provider_thread_id TEXT,
        title TEXT,
        visible INTEGER NOT NULL CHECK(visible IN (0, 1)),
        authority_revision INTEGER NOT NULL DEFAULT 0,
        active_turn_id TEXT,
        thoth_lifecycle TEXT NOT NULL DEFAULT 'idle',
        background_task_id TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS provider_threads (
        thread_id TEXT PRIMARY KEY NOT NULL,
        adapter_id TEXT NOT NULL,
        native_handle TEXT,
        persistence_json TEXT,
        lineage_parent_id TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS turns (
        turn_id TEXT PRIMARY KEY NOT NULL,
        agent_id TEXT NOT NULL,
        task_id TEXT,
        provider_thread_id TEXT,
        generation TEXT NOT NULL,
        status TEXT NOT NULL,
        turn_kind TEXT NOT NULL DEFAULT 'raw',
        controls_json TEXT,
        provider_run_mode TEXT NOT NULL DEFAULT 'default',
        provider_mode_receipt_json TEXT,
        source_message_id TEXT,
        workspace_path TEXT,
        user_text_digest TEXT,
        provider_turn_id TEXT,
        background_task_id TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(agent_id) REFERENCES agents(agent_id),
        FOREIGN KEY(provider_thread_id) REFERENCES provider_threads(thread_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS foreground_turn_queue (
        queued_turn_id TEXT PRIMARY KEY NOT NULL,
        agent_id TEXT NOT NULL,
        source_message_id TEXT NOT NULL,
        delivery_mode TEXT NOT NULL CHECK(delivery_mode IN ('queue', 'interrupt')),
        text_digest TEXT NOT NULL,
        payload_digest TEXT NOT NULL,
        attachment_count INTEGER NOT NULL DEFAULT 0,
        queue_order INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(agent_id, source_message_id),
        FOREIGN KEY(agent_id) REFERENCES agents(agent_id) ON DELETE CASCADE
      ) STRICT;
      CREATE TABLE IF NOT EXISTS provider_message_anchors (
        agent_id TEXT NOT NULL,
        canonical_message_id TEXT NOT NULL,
        provider_thread_id TEXT,
        native_anchor_receipt_json TEXT NOT NULL,
        scopes_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(agent_id, canonical_message_id),
        FOREIGN KEY(agent_id) REFERENCES agents(agent_id) ON DELETE CASCADE,
        FOREIGN KEY(provider_thread_id) REFERENCES provider_threads(thread_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS cards (
        card_id TEXT PRIMARY KEY NOT NULL,
        turn_id TEXT NOT NULL,
        task_id TEXT,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        displayed_digest TEXT NOT NULL,
        answer_digest TEXT,
        submitted_summary TEXT,
        runtime_digest TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(turn_id) REFERENCES turns(turn_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS human_decisions (
        decision_id TEXT PRIMARY KEY NOT NULL,
        task_id TEXT,
        turn_id TEXT,
        card_id TEXT,
        kind TEXT NOT NULL,
        displayed_digest TEXT NOT NULL,
        raw_answer_digest TEXT NOT NULL,
        normalized_digest TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        client_id TEXT NOT NULL,
        device_id TEXT,
        command_id TEXT NOT NULL UNIQUE,
        expected_revision INTEGER NOT NULL,
        result_revision INTEGER NOT NULL,
        supersedes_decision_id TEXT,
        fidelity TEXT NOT NULL,
        decided_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS human_decisions_task_time
        ON human_decisions(task_id, decided_at ASC);
      CREATE TABLE IF NOT EXISTS tasks (
        task_id TEXT PRIMARY KEY NOT NULL,
        workspace_id TEXT NOT NULL,
        source_agent_id TEXT NOT NULL,
        execution_mode TEXT NOT NULL,
        title TEXT NOT NULL,
        goal TEXT NOT NULL,
        constraints_json TEXT NOT NULL,
        acceptance_json TEXT NOT NULL,
        status TEXT NOT NULL,
        summary TEXT NOT NULL,
        current_goal_id TEXT,
        current_execution_id TEXT,
        latest_review_direction TEXT,
        source_turn_id TEXT,
        source_goals_card_id TEXT,
        provider_profile_id TEXT,
        budget_strength TEXT NOT NULL DEFAULT 'single',
        used_failed_reviews INTEGER NOT NULL DEFAULT 0,
        max_failed_reviews INTEGER NOT NULL DEFAULT 1,
        active_duration_ms INTEGER NOT NULL DEFAULT 0,
        token_count INTEGER NOT NULL DEFAULT 0,
        tool_call_count INTEGER NOT NULL DEFAULT 0,
        pending_control TEXT,
        goals_revision INTEGER NOT NULL DEFAULT 0,
        revision INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS tasks_status_updated ON tasks(status, updated_at DESC);
      CREATE TABLE IF NOT EXISTS task_goals (
        goal_id TEXT PRIMARY KEY NOT NULL,
        task_id TEXT NOT NULL,
        goal_order INTEGER NOT NULL,
        title TEXT NOT NULL,
        goal TEXT NOT NULL,
        constraints_json TEXT NOT NULL,
        acceptance_json TEXT NOT NULL,
        status TEXT NOT NULL,
        revision INTEGER NOT NULL,
        FOREIGN KEY(task_id) REFERENCES tasks(task_id) ON DELETE CASCADE,
        UNIQUE(task_id, goal_order)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS phase_runs (
        phase_run_id TEXT PRIMARY KEY NOT NULL,
        task_id TEXT NOT NULL,
        goal_id TEXT,
        phase_kind TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(task_id) REFERENCES tasks(task_id) ON DELETE CASCADE
      ) STRICT;
      CREATE TABLE IF NOT EXISTS execution_attempts (
        execution_id TEXT PRIMARY KEY NOT NULL,
        task_id TEXT NOT NULL,
        goal_id TEXT,
        phase_run_id TEXT NOT NULL,
        phase_kind TEXT NOT NULL,
        provider_thread_id TEXT,
        status TEXT NOT NULL,
        generation TEXT NOT NULL,
        run_mode_receipt_json TEXT,
        started_at TEXT,
        last_activity_at TEXT,
        completed_at TEXT,
        summary TEXT,
        revision INTEGER NOT NULL,
        FOREIGN KEY(task_id) REFERENCES tasks(task_id) ON DELETE CASCADE,
        FOREIGN KEY(phase_run_id) REFERENCES phase_runs(phase_run_id),
        FOREIGN KEY(provider_thread_id) REFERENCES provider_threads(thread_id)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS execution_attempts_task_time
        ON execution_attempts(task_id, started_at DESC);
      CREATE TABLE IF NOT EXISTS execution_approvals (
        approval_id TEXT PRIMARY KEY NOT NULL,
        provider_request_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        execution_id TEXT NOT NULL,
        generation TEXT NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        displayed_digest TEXT NOT NULL,
        auto_approve_eligible INTEGER NOT NULL CHECK(auto_approve_eligible IN (0, 1)),
        deadline_at TEXT,
        status TEXT NOT NULL CHECK(status IN ('pending', 'allowed', 'denied', 'canceled')),
        resolution_decision TEXT,
        resolution_actor_id TEXT,
        resolved_at TEXT,
        revision INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(task_id) REFERENCES tasks(task_id) ON DELETE CASCADE,
        FOREIGN KEY(execution_id) REFERENCES execution_attempts(execution_id) ON DELETE CASCADE,
        UNIQUE(execution_id, provider_request_id)
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS execution_approvals_one_pending
        ON execution_approvals(execution_id) WHERE status = 'pending';
      CREATE TABLE IF NOT EXISTS runtime_attachments (
        attachment_id TEXT PRIMARY KEY NOT NULL,
        execution_id TEXT NOT NULL UNIQUE,
        adapter_id TEXT NOT NULL,
        provider_thread_id TEXT NOT NULL,
        bundle_id TEXT NOT NULL,
        bundle_digest TEXT NOT NULL,
        instruction_attachment TEXT NOT NULL,
        tool_attachment TEXT NOT NULL,
        status TEXT NOT NULL,
        attached_at TEXT NOT NULL,
        FOREIGN KEY(execution_id) REFERENCES execution_attempts(execution_id) ON DELETE CASCADE
      ) STRICT;
      CREATE TABLE IF NOT EXISTS task_blackboard (
        entry_id TEXT PRIMARY KEY NOT NULL,
        task_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        producer TEXT NOT NULL,
        content_digest TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(task_id) REFERENCES tasks(task_id) ON DELETE CASCADE
      ) STRICT;
      CREATE INDEX IF NOT EXISTS task_blackboard_task_time
        ON task_blackboard(task_id, created_at ASC);
      CREATE TABLE IF NOT EXISTS task_decision_requests (
        decision_id TEXT PRIMARY KEY NOT NULL,
        task_id TEXT NOT NULL,
        request_digest TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending', 'answered')),
        answer_decision_id TEXT,
        created_at TEXT NOT NULL,
        answered_at TEXT,
        FOREIGN KEY(task_id) REFERENCES tasks(task_id) ON DELETE CASCADE,
        FOREIGN KEY(answer_decision_id) REFERENCES human_decisions(decision_id)
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS task_decision_requests_one_pending
        ON task_decision_requests(task_id) WHERE status = 'pending';
      CREATE TABLE IF NOT EXISTS context_bindings (
        binding_id TEXT PRIMARY KEY NOT NULL,
        agent_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        task_revision INTEGER NOT NULL,
        context_digest TEXT,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS context_bindings_turn_task
        ON context_bindings(turn_id, task_id);
      CREATE TABLE IF NOT EXISTS timeline_entries (
        execution_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        occurred_at TEXT NOT NULL,
        item_json TEXT,
        item_digest TEXT,
        PRIMARY KEY(execution_id, seq),
        FOREIGN KEY(execution_id) REFERENCES execution_attempts(execution_id) ON DELETE CASCADE
      ) STRICT;
      CREATE TABLE IF NOT EXISTS agent_timeline_meta (
        agent_id TEXT PRIMARY KEY NOT NULL,
        epoch TEXT NOT NULL,
        next_seq INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(agent_id) REFERENCES agents(agent_id) ON DELETE CASCADE
      ) STRICT;
      CREATE TABLE IF NOT EXISTS agent_timeline_rows (
        agent_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        timestamp TEXT NOT NULL,
        item_json TEXT,
        item_digest TEXT,
        PRIMARY KEY(agent_id, seq),
        FOREIGN KEY(agent_id) REFERENCES agent_timeline_meta(agent_id) ON DELETE CASCADE,
        CHECK((item_json IS NOT NULL) != (item_digest IS NOT NULL))
      ) STRICT;
      CREATE TABLE IF NOT EXISTS evidence_refs (
        evidence_id TEXT PRIMARY KEY NOT NULL,
        task_id TEXT NOT NULL,
        execution_id TEXT,
        kind TEXT NOT NULL,
        content_digest TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(task_id) REFERENCES tasks(task_id) ON DELETE CASCADE
      ) STRICT;
      CREATE TABLE IF NOT EXISTS authority_commands (
        command_id TEXT PRIMARY KEY NOT NULL,
        aggregate_type TEXT NOT NULL,
        aggregate_id TEXT NOT NULL,
        command_kind TEXT NOT NULL,
        result_revision INTEGER NOT NULL,
        result_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS foreground_continuations (
        turn_id TEXT NOT NULL,
        continuation_key TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(turn_id, continuation_key),
        FOREIGN KEY(turn_id) REFERENCES turns(turn_id) ON DELETE CASCADE
      ) STRICT;
      CREATE TABLE IF NOT EXISTS workspace_leases (
        lease_key TEXT PRIMARY KEY NOT NULL,
        task_id TEXT NOT NULL,
        execution_id TEXT,
        status TEXT NOT NULL,
        generation TEXT NOT NULL,
        expires_at TEXT,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS authority_events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        aggregate_type TEXT NOT NULL,
        aggregate_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        kind TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        payload_digest TEXT NOT NULL,
        causation_id TEXT NOT NULL,
        correlation_id TEXT NOT NULL,
        occurred_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS authority_events_aggregate_revision
        ON authority_events(aggregate_type, aggregate_id, revision);
      CREATE INDEX IF NOT EXISTS turns_agent_created ON turns(agent_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS foreground_turn_queue_agent_order
        ON foreground_turn_queue(agent_id, queue_order ASC, created_at ASC);
      CREATE INDEX IF NOT EXISTS cards_turn_created ON cards(turn_id, created_at ASC);
    `);
    this.ensureColumn("agents", "authority_revision", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("agents", "active_turn_id", "TEXT");
    this.ensureColumn("agents", "thoth_lifecycle", "TEXT NOT NULL DEFAULT 'idle'");
    this.ensureColumn("agents", "background_task_id", "TEXT");
    this.ensureColumn("agents", "error", "TEXT");
    this.ensureColumn("agents", "provider", "TEXT");
    this.ensureColumn("agents", "cwd", "TEXT");
    this.ensureColumn("agents", "last_activity_at", "TEXT");
    this.ensureColumn("agents", "last_user_message_at", "TEXT");
    this.ensureColumn("agents", "labels_json", "TEXT");
    this.ensureColumn("agents", "last_status", "TEXT");
    this.ensureColumn("agents", "last_mode_id", "TEXT");
    this.ensureColumn("agents", "config_json", "TEXT");
    this.ensureColumn("agents", "runtime_info_json", "TEXT");
    this.ensureColumn("agents", "features_json", "TEXT");
    this.ensureColumn("agents", "persistence_json", "TEXT");
    this.ensureColumn("agents", "last_error", "TEXT");
    this.ensureColumn("agents", "requires_attention", "INTEGER");
    this.ensureColumn("agents", "attention_reason", "TEXT");
    this.ensureColumn("agents", "attention_timestamp", "TEXT");
    this.ensureColumn("agents", "internal", "INTEGER");
    this.ensureColumn("agents", "archived_at", "TEXT");
    this.ensureColumn("turns", "turn_kind", "TEXT NOT NULL DEFAULT 'raw'");
    this.ensureColumn("turns", "provider_run_mode", "TEXT NOT NULL DEFAULT 'default'");
    this.ensureColumn("turns", "provider_mode_receipt_json", "TEXT");
    this.ensureColumn("turns", "source_message_id", "TEXT");
    this.ensureColumn("turns", "workspace_path", "TEXT");
    this.ensureColumn("turns", "provider_turn_id", "TEXT");
    this.ensureColumn("turns", "background_task_id", "TEXT");
    this.ensureColumn("turns", "error", "TEXT");
    this.ensureColumn("provider_message_anchors", "provider_thread_id", "TEXT");
    this.ensureColumn("provider_message_anchors", "native_anchor_receipt_json", "TEXT");
    this.ensureColumn("provider_message_anchors", "scopes_json", "TEXT");
    this.ensureColumn("cards", "answer_digest", "TEXT");
    this.ensureColumn("cards", "submitted_summary", "TEXT");
    this.ensureColumn("cards", "runtime_digest", "TEXT");
    this.ensureColumn("tasks", "source_turn_id", "TEXT");
    this.ensureColumn("tasks", "source_goals_card_id", "TEXT");
    this.ensureColumn("tasks", "provider_profile_id", "TEXT");
    this.ensureColumn("tasks", "budget_strength", "TEXT NOT NULL DEFAULT 'single'");
    this.ensureColumn("tasks", "used_failed_reviews", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("tasks", "max_failed_reviews", "INTEGER NOT NULL DEFAULT 1");
    this.ensureColumn("tasks", "active_duration_ms", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("tasks", "token_count", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("tasks", "tool_call_count", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("tasks", "pending_control", "TEXT");
    this.ensureColumn("tasks", "goals_revision", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("execution_attempts", "run_mode_receipt_json", "TEXT");
    this.ensureColumn("context_bindings", "context_digest", "TEXT");
    this.database.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS turns_agent_source_message
        ON turns(agent_id, source_message_id) WHERE source_message_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS tasks_source_registration
        ON tasks(source_turn_id, source_goals_card_id)
        WHERE source_turn_id IS NOT NULL AND source_goals_card_id IS NOT NULL;
    `);
    this.database
      .prepare(
        `INSERT OR IGNORE INTO authority_schema_migrations(version, checksum, applied_at)
         VALUES (1, 'workspace-task-authority-v1', ?)`,
      )
      .run(nowIso());
    this.database
      .prepare(
        `INSERT OR IGNORE INTO authority_schema_migrations(version, checksum, applied_at)
         VALUES (4, 'foreground-queue-rewind-anchors-v4', ?)`,
      )
      .run(nowIso());
    this.database
      .prepare(
        `INSERT OR IGNORE INTO authority_schema_migrations(version, checksum, applied_at)
         VALUES (3, 'provider-control-approvals-v3', ?)`,
      )
      .run(nowIso());
    this.database
      .prepare(
        `INSERT OR IGNORE INTO authority_schema_migrations(version, checksum, applied_at)
         VALUES (2, 'task-decision-request-v2', ?)`,
      )
      .run(nowIso());
    this.database
      .prepare(
        `INSERT OR IGNORE INTO workspace_meta(workspace_id, authority_revision, updated_at)
         VALUES (?, 0, ?)`,
      )
      .run(this.workspaceId, nowIso());
  }

  subscribe(subscriber: WorkspaceAuthoritySubscriber): () => void {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  subscribeForeground(subscriber: ForegroundAuthoritySubscriber): () => void {
    this.foregroundSubscribers.add(subscriber);
    return () => this.foregroundSubscribers.delete(subscriber);
  }

  startForegroundTurn(input: StartForegroundTurnInput): StartForegroundTurnResult {
    if (input.workspaceId !== this.workspaceId) {
      throw new Error("Foreground turn workspace does not match authority shard");
    }
    const controls = input.controls
      ? ThothTurnControlSnapshotSchema.parse(input.controls)
      : undefined;
    if (input.kind === "thoth" && !controls) {
      throw new Error("A Thoth foreground turn requires frozen turn controls.");
    }
    if (input.kind === "raw" && controls) {
      throw new Error("A raw foreground turn cannot carry Thoth controls.");
    }

    let result!: StartForegroundTurnResult;
    this.transaction(() => {
      if (input.sourceMessageId) {
        const existing = this.database
          .prepare("SELECT * FROM turns WHERE agent_id = ? AND source_message_id = ?")
          .get(input.agentId, input.sourceMessageId) as Record<string, unknown> | undefined;
        if (existing) {
          result = {
            turn: this.toForegroundTurn(existing),
            state: this.getForegroundStateInTransaction(input.agentId),
            created: false,
          };
          return;
        }
      }

      const authority = this.getForegroundAgentRow(input.agentId);
      if (
        authority &&
        ["running", "awaiting_card", "awaiting_implementation", "quick_exec"].includes(
          authority.thoth_lifecycle,
        )
      ) {
        throw new WorkspaceAuthorityConflictError(
          `Agent ${input.agentId} already has an active foreground turn.`,
        );
      }

      const now = nowIso();
      const turnId = `foreground-turn-${randomUUID()}`;
      const generation = randomUUID();
      const userText = this.blobs.putJson(input.userText);
      this.database
        .prepare(
          `INSERT INTO agents(
             agent_id, provider_thread_id, title, visible, authority_revision,
             active_turn_id, thoth_lifecycle, background_task_id, error, created_at, updated_at
           ) VALUES (?, NULL, NULL, 1, 0, NULL, 'idle', NULL, NULL, ?, ?)
           ON CONFLICT(agent_id) DO UPDATE SET visible = 1, updated_at = excluded.updated_at`,
        )
        .run(input.agentId, now, now);
      this.database
        .prepare(
          `INSERT INTO turns(
             turn_id, agent_id, task_id, provider_thread_id, generation, status, turn_kind,
             controls_json, provider_run_mode, provider_mode_receipt_json,
             source_message_id, workspace_path, user_text_digest,
             provider_turn_id, background_task_id, error, created_at, updated_at
           ) VALUES (?, ?, NULL, NULL, ?, 'running', ?, ?, ?, NULL, ?, ?, ?, NULL, NULL, NULL, ?, ?)`,
        )
        .run(
          turnId,
          input.agentId,
          generation,
          input.kind,
          controls ? JSON.stringify(controls) : null,
          input.providerRunMode ?? "default",
          input.sourceMessageId ?? null,
          input.workspacePath,
          userText.digest,
          now,
          now,
        );
      const nextRevision = (authority?.authority_revision ?? 0) + 1;
      this.database
        .prepare(
          `UPDATE agents SET authority_revision = ?, active_turn_id = ?,
             thoth_lifecycle = 'running', background_task_id = NULL, error = NULL, updated_at = ?
           WHERE agent_id = ?`,
        )
        .run(nextRevision, turnId, now, input.agentId);
      this.appendEventInTransaction({
        aggregateType: "turn",
        aggregateId: turnId,
        revision: 1,
        kind: "foreground_turn_started",
        payload: { agentId: input.agentId, turnKind: input.kind },
      });
      result = {
        turn: this.getForegroundTurnInTransaction(turnId)!,
        state: this.getForegroundStateInTransaction(input.agentId),
        created: true,
      };
    });

    if (result.created) {
      this.catalog.updateAgentLocator({
        agentId: input.agentId,
        workspaceId: this.workspaceId,
        updatedAt: result.turn.updatedAt,
      });
      this.catalog.updateTurnLocator({
        turnId: result.turn.id,
        workspaceId: this.workspaceId,
        agentId: input.agentId,
        updatedAt: result.turn.updatedAt,
      });
      this.emit([], []);
      this.emitForeground(result.state, "turn_started");
    }
    return result;
  }

  getForegroundState(agentId: string): AgentThothState {
    return this.getForegroundStateInTransaction(agentId);
  }

  enqueueForegroundTurn(input: ForegroundQueuedSubmission): {
    queuedTurn: AgentQueuedTurn;
    revision: number;
    created: boolean;
  } {
    let output!: { queuedTurn: AgentQueuedTurn; revision: number; created: boolean };
    this.transaction(() => {
      const existing = this.database
        .prepare("SELECT * FROM foreground_turn_queue WHERE agent_id = ? AND source_message_id = ?")
        .get(input.agentId, input.messageId) as Record<string, unknown> | undefined;
      if (existing) {
        const authority = this.getForegroundAgentRow(input.agentId);
        output = {
          queuedTurn: this.toQueuedTurn(existing),
          revision: authority?.authority_revision ?? 0,
          created: false,
        };
        return;
      }

      const now = nowIso();
      this.database
        .prepare(
          `INSERT INTO agents(
             agent_id, provider_thread_id, title, visible, authority_revision,
             active_turn_id, thoth_lifecycle, background_task_id, error, created_at, updated_at
           ) VALUES (?, NULL, NULL, 1, 0, NULL, 'idle', NULL, NULL, ?, ?)
           ON CONFLICT(agent_id) DO UPDATE SET visible = 1, updated_at = excluded.updated_at`,
        )
        .run(input.agentId, now, now);
      const boundary = this.database
        .prepare(
          input.deliveryMode === "interrupt"
            ? "SELECT MIN(queue_order) AS value FROM foreground_turn_queue WHERE agent_id = ?"
            : "SELECT MAX(queue_order) AS value FROM foreground_turn_queue WHERE agent_id = ?",
        )
        .get(input.agentId) as { value: number | null };
      const queueOrder =
        input.deliveryMode === "interrupt" ? (boundary.value ?? 1) - 1 : (boundary.value ?? 0) + 1;
      const text = this.blobs.putJson(input.text);
      const payload = this.blobs.putJson(input.payload);
      const queuedTurnId = `queued-turn-${randomUUID()}`;
      this.database
        .prepare(
          `INSERT INTO foreground_turn_queue(
             queued_turn_id, agent_id, source_message_id, delivery_mode, text_digest,
             payload_digest, attachment_count, queue_order, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          queuedTurnId,
          input.agentId,
          input.messageId,
          input.deliveryMode,
          text.digest,
          payload.digest,
          input.attachmentCount,
          queueOrder,
          now,
          now,
        );
      const authority = this.getForegroundAgentRow(input.agentId)!;
      const revision = authority.authority_revision + 1;
      this.database
        .prepare("UPDATE agents SET authority_revision = ?, updated_at = ? WHERE agent_id = ?")
        .run(revision, now, input.agentId);
      this.appendEventInTransaction({
        aggregateType: "agent",
        aggregateId: input.agentId,
        revision,
        kind: "foreground_turn_queued",
        payload: { queuedTurnId, deliveryMode: input.deliveryMode },
      });
      output = {
        queuedTurn: this.toQueuedTurn(
          this.database
            .prepare("SELECT * FROM foreground_turn_queue WHERE queued_turn_id = ?")
            .get(queuedTurnId) as Record<string, unknown>,
        ),
        revision,
        created: true,
      };
    });
    if (output.created) {
      const state = this.getForegroundState(input.agentId);
      this.emit([], []);
      this.emitForeground(state, "queue_changed");
    }
    return output;
  }

  peekForegroundQueue(agentId: string): { queuedTurn: AgentQueuedTurn; payload: unknown } | null {
    const row = this.database
      .prepare(
        `SELECT * FROM foreground_turn_queue
         WHERE agent_id = ? ORDER BY queue_order ASC, created_at ASC LIMIT 1`,
      )
      .get(agentId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      queuedTurn: this.toQueuedTurn(row),
      payload: this.blobs.readJson(String(row.payload_digest)),
    };
  }

  removeForegroundQueuedTurn(agentId: string, queuedTurnId: string): boolean {
    const result = this.database
      .prepare("DELETE FROM foreground_turn_queue WHERE agent_id = ? AND queued_turn_id = ?")
      .run(agentId, queuedTurnId);
    if (result.changes === 0) return false;
    const authority = this.getForegroundAgentRow(agentId);
    if (authority) {
      this.database
        .prepare("UPDATE agents SET authority_revision = ?, updated_at = ? WHERE agent_id = ?")
        .run(authority.authority_revision + 1, nowIso(), agentId);
    }
    this.emit([], []);
    this.emitForeground(this.getForegroundState(agentId), "queue_changed");
    return true;
  }

  clearForegroundQueue(agentId: string): number {
    const result = this.database
      .prepare("DELETE FROM foreground_turn_queue WHERE agent_id = ?")
      .run(agentId);
    if (result.changes > 0) {
      const authority = this.getForegroundAgentRow(agentId);
      if (authority) {
        this.database
          .prepare("UPDATE agents SET authority_revision = ?, updated_at = ? WHERE agent_id = ?")
          .run(authority.authority_revision + 1, nowIso(), agentId);
      }
      this.emit([], []);
      this.emitForeground(this.getForegroundState(agentId), "queue_changed");
    }
    return Number(result.changes);
  }

  commandForegroundQueue(input: ForegroundQueueCommandInput): ForegroundQueueCommandResult {
    let output!: ForegroundQueueCommandResult;
    this.transaction(() => {
      const persistResult = (result: ForegroundQueueCommandResult): void => {
        this.database
          .prepare(
            `INSERT INTO authority_commands(
               command_id, aggregate_type, aggregate_id, command_kind,
               result_revision, result_json, created_at
             ) VALUES (?, 'agent_queue', ?, ?, ?, ?, ?)`,
          )
          .run(
            input.commandId,
            input.agentId,
            input.command,
            result.revision,
            JSON.stringify(result),
            nowIso(),
          );
      };
      const duplicate = this.database
        .prepare("SELECT result_json FROM authority_commands WHERE command_id = ?")
        .get(input.commandId) as { result_json: string } | undefined;
      if (duplicate) {
        output = {
          ...(JSON.parse(duplicate.result_json) as ForegroundQueueCommandResult),
          duplicate: true,
        };
        return;
      }
      const authority = this.getForegroundAgentRow(input.agentId);
      const revision = authority?.authority_revision ?? 0;
      if (revision !== input.expectedRevision) {
        output = {
          accepted: false,
          conflict: true,
          duplicate: false,
          revision,
          queuedTurns: this.listForegroundQueue(input.agentId),
          restoredText: null,
          error: "Agent queue authority revision changed.",
        };
        persistResult(output);
        return;
      }
      const row = this.database
        .prepare("SELECT * FROM foreground_turn_queue WHERE agent_id = ? AND queued_turn_id = ?")
        .get(input.agentId, input.queuedTurnId) as Record<string, unknown> | undefined;
      if (!row) {
        output = {
          accepted: false,
          conflict: false,
          duplicate: false,
          revision,
          queuedTurns: this.listForegroundQueue(input.agentId),
          restoredText: null,
          error: "Queued turn was not found.",
        };
        persistResult(output);
        return;
      }
      if (input.command === "interrupt") {
        const minimum = this.database
          .prepare("SELECT MIN(queue_order) AS value FROM foreground_turn_queue WHERE agent_id = ?")
          .get(input.agentId) as { value: number | null };
        this.database
          .prepare(
            `UPDATE foreground_turn_queue
             SET delivery_mode = 'interrupt', queue_order = ?, updated_at = ?
             WHERE queued_turn_id = ?`,
          )
          .run((minimum.value ?? 1) - 1, nowIso(), input.queuedTurnId);
      } else if (input.command === "edit") {
        const updatedText = this.blobs.putJson(input.text);
        const updatedPayload = this.blobs.putJson(
          updateQueuedSubmissionText(this.blobs.readJson(String(row.payload_digest)), input.text),
        );
        this.database
          .prepare(
            `UPDATE foreground_turn_queue
             SET text_digest = ?, payload_digest = ?, updated_at = ?
             WHERE queued_turn_id = ?`,
          )
          .run(updatedText.digest, updatedPayload.digest, nowIso(), input.queuedTurnId);
      } else {
        this.database
          .prepare("DELETE FROM foreground_turn_queue WHERE queued_turn_id = ?")
          .run(input.queuedTurnId);
      }
      const nextRevision = revision + 1;
      this.database
        .prepare("UPDATE agents SET authority_revision = ?, updated_at = ? WHERE agent_id = ?")
        .run(nextRevision, nowIso(), input.agentId);
      output = {
        accepted: true,
        conflict: false,
        duplicate: false,
        revision: nextRevision,
        queuedTurns: this.listForegroundQueue(input.agentId),
        restoredText: input.command === "edit" ? input.text : null,
        error: null,
      };
      persistResult(output);
    });
    if (output.accepted && !output.duplicate) {
      this.emit([], []);
      this.emitForeground(this.getForegroundState(input.agentId), "queue_changed");
    }
    return output;
  }

  listForegroundQueue(agentId: string): AgentQueuedTurn[] {
    const rows = this.database
      .prepare(
        `SELECT * FROM foreground_turn_queue
         WHERE agent_id = ? ORDER BY queue_order ASC, created_at ASC`,
      )
      .all(agentId) as Array<Record<string, unknown>>;
    return rows.map((row, index) => this.toQueuedTurn(row, index + 1));
  }

  getProviderMessageAnchor(
    agentId: string,
    canonicalMessageId: string,
    scope: ProviderRewindScope,
  ): ProviderMessageAnchorReceipt | null {
    const row = this.database
      .prepare(
        `SELECT native_anchor_receipt_json, scopes_json FROM provider_message_anchors
         WHERE agent_id = ? AND canonical_message_id = ?`,
      )
      .get(agentId, canonicalMessageId) as
      | { native_anchor_receipt_json: string | null; scopes_json: string | null }
      | undefined;
    if (!row || !row.native_anchor_receipt_json || !row.scopes_json) return null;
    const scopes = JSON.parse(row.scopes_json) as unknown;
    if (!Array.isArray(scopes) || !scopes.includes(scope)) return null;
    const receipt = JSON.parse(
      row.native_anchor_receipt_json,
    ) as Partial<ProviderMessageAnchorReceipt>;
    if (receipt.version !== 1 || typeof receipt.opaqueAnchor !== "string") return null;
    return { version: 1, opaqueAnchor: receipt.opaqueAnchor };
  }

  bindProviderMessageAnchor(
    agentId: string,
    canonicalMessageId: string,
    receipt: ProviderMessageAnchorReceipt,
    scopes: readonly ProviderRewindScope[],
  ): void {
    const agent = this.database
      .prepare("SELECT provider_thread_id FROM agents WHERE agent_id = ?")
      .get(agentId) as { provider_thread_id: string | null } | undefined;
    if (!agent) throw new Error(`Agent ${agentId} is not registered in Workspace authority`);
    this.database
      .prepare(
        `INSERT INTO provider_message_anchors(
           agent_id, canonical_message_id, provider_thread_id,
           native_anchor_receipt_json, scopes_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(agent_id, canonical_message_id)
         DO UPDATE SET
           provider_thread_id = excluded.provider_thread_id,
           native_anchor_receipt_json = excluded.native_anchor_receipt_json,
           scopes_json = excluded.scopes_json`,
      )
      .run(
        agentId,
        canonicalMessageId,
        agent.provider_thread_id,
        JSON.stringify(receipt),
        JSON.stringify([...new Set(scopes)]),
        nowIso(),
      );
  }

  truncateAgentTimelineFromMessage(agentId: string, canonicalMessageId: string): void {
    const rows = this.listAgentTimelineRows(agentId);
    const target = rows.find(
      (row) => row.item.type === "user_message" && row.item.messageId === canonicalMessageId,
    );
    if (!target) {
      throw new Error(`Canonical rewind message ${canonicalMessageId} was not found`);
    }
    const removedMessageIds = rows.flatMap((row) =>
      row.seq >= target.seq && row.item.type === "user_message" && row.item.messageId
        ? [row.item.messageId]
        : [],
    );
    this.transaction(() => {
      this.database
        .prepare("DELETE FROM agent_timeline_rows WHERE agent_id = ? AND seq >= ?")
        .run(agentId, target.seq);
      this.database
        .prepare(
          `UPDATE agent_timeline_meta SET epoch = ?, next_seq = ?, updated_at = ?
           WHERE agent_id = ?`,
        )
        .run(randomUUID(), target.seq, nowIso(), agentId);
      const deleteAnchor = this.database.prepare(
        `DELETE FROM provider_message_anchors
         WHERE agent_id = ? AND canonical_message_id = ?`,
      );
      for (const messageId of removedMessageIds) {
        deleteAnchor.run(agentId, messageId);
      }
    });
  }

  getActiveForegroundTurn(agentId: string): ForegroundTurnAuthorityRecord | null {
    const authority = this.getForegroundAgentRow(agentId);
    return authority?.active_turn_id
      ? this.getForegroundTurnInTransaction(authority.active_turn_id)
      : null;
  }

  getForegroundTurn(turnId: string): ForegroundTurnAuthorityRecord | null {
    return this.getForegroundTurnInTransaction(turnId);
  }

  getForegroundTurnBySourceMessage(
    agentId: string,
    sourceMessageId: string,
  ): ForegroundTurnAuthorityRecord | null {
    const row = this.database
      .prepare("SELECT * FROM turns WHERE agent_id = ? AND source_message_id = ?")
      .get(agentId, sourceMessageId) as Record<string, unknown> | undefined;
    return row ? this.toForegroundTurn(row) : null;
  }

  bindForegroundProviderTurn(input: {
    agentId: string;
    turnId: string;
    generation: string;
    providerTurnId: string;
  }): boolean {
    const result = this.database
      .prepare(
        `UPDATE turns SET provider_turn_id = ?, updated_at = ?
         WHERE turn_id = ? AND agent_id = ? AND generation = ?`,
      )
      .run(input.providerTurnId, nowIso(), input.turnId, input.agentId, input.generation);
    return result.changes === 1;
  }

  recordForegroundRunModeReceipt(input: {
    agentId: string;
    turnId: string;
    generation: string;
    receipt: ProviderRunModeReceipt;
  }): ForegroundTurnAuthorityRecord {
    const receipt = ProviderRunModeReceiptSchema.parse(input.receipt);
    const updated = this.database
      .prepare(
        `UPDATE turns SET provider_mode_receipt_json = ?, updated_at = ?
         WHERE turn_id = ? AND agent_id = ? AND generation = ?`,
      )
      .run(JSON.stringify(receipt), nowIso(), input.turnId, input.agentId, input.generation);
    if (updated.changes !== 1) {
      throw new WorkspaceAuthorityConflictError("Foreground turn changed before mode receipt.");
    }
    return this.getForegroundTurnInTransaction(input.turnId)!;
  }

  openForegroundCard(input: {
    agentId: string;
    turnId: string;
    generation: string;
    card: ForegroundAuthorityCard;
    runtime: ForegroundAuthorityRuntimeBinding;
  }): { record: ForegroundCardAuthorityRecord; state: AgentThothState; created: boolean } {
    let output!: {
      record: ForegroundCardAuthorityRecord;
      state: AgentThothState;
      created: boolean;
    };
    this.transaction(() => {
      const cardId = input.card.card.id;
      const existing = this.getForegroundCardInTransaction(cardId);
      if (existing) {
        output = {
          record: existing,
          state: this.getForegroundStateInTransaction(input.agentId),
          created: false,
        };
        return;
      }
      const activeTurn = this.getActiveForegroundTurn(input.agentId);
      if (
        !activeTurn ||
        activeTurn.id !== input.turnId ||
        activeTurn.generation !== input.generation ||
        activeTurn.kind !== "thoth"
      ) {
        throw new WorkspaceAuthorityConflictError(
          "The authority card does not belong to the active foreground turn.",
        );
      }
      const now = nowIso();
      const displayed = this.blobs.putJson(input.card.card);
      const runtime = this.blobs.putJson(input.runtime);
      this.database
        .prepare(
          `INSERT INTO cards(
             card_id, turn_id, task_id, kind, status, displayed_digest,
             answer_digest, submitted_summary, runtime_digest, created_at, updated_at
           ) VALUES (?, ?, NULL, ?, 'pending', ?, NULL, NULL, ?, ?, ?)`,
        )
        .run(cardId, input.turnId, input.card.kind, displayed.digest, runtime.digest, now, now);
      this.updateForegroundLifecycleInTransaction({
        agentId: input.agentId,
        turnId: input.turnId,
        lifecycle: "awaiting_card",
        now,
      });
      this.appendEventInTransaction({
        aggregateType: "card",
        aggregateId: cardId,
        revision: 1,
        kind: "foreground_card_opened",
        payload: { turnId: input.turnId, cardKind: input.card.kind },
      });
      output = {
        record: this.getForegroundCardInTransaction(cardId)!,
        state: this.getForegroundStateInTransaction(input.agentId),
        created: true,
      };
    });
    if (output.created) {
      this.catalog.updateCardLocator({
        cardId: output.record.id,
        workspaceId: this.workspaceId,
        agentId: input.agentId,
        turnId: input.turnId,
        updatedAt: output.record.updatedAt,
      });
      this.emit([], []);
      this.emitForeground(output.state, "card_opened");
    }
    return output;
  }

  answerForegroundCard(input: {
    agentId: string;
    cardId: string;
    answer: ThothCardAnswerPayload;
    submittedCard: ForegroundAuthorityCard["card"];
    submittedSummary: string;
    expectedRevision: number;
    commandId: string;
    nextLifecycle: AgentThothLifecycle;
    actorId: string;
    clientId: string;
    deviceId?: string | null;
  }): AnswerForegroundCardResult {
    const answer = ThothCardAnswerPayloadSchema.parse(input.answer);
    let emitReason = false;
    const result = this.transaction(() => {
      const duplicate = this.database
        .prepare("SELECT result_json FROM authority_commands WHERE command_id = ?")
        .get(input.commandId) as { result_json: string } | undefined;
      if (duplicate) {
        const stored = JSON.parse(duplicate.result_json) as {
          accepted: boolean;
          conflict: boolean;
          error: string | null;
        };
        return {
          ...stored,
          duplicate: true,
          state: this.getForegroundStateInTransaction(input.agentId),
          card: this.getForegroundCardInTransaction(input.cardId),
          turn: this.getActiveForegroundTurn(input.agentId),
        };
      }

      const authority = this.getForegroundAgentRow(input.agentId);
      if (!authority || authority.authority_revision !== input.expectedRevision) {
        return {
          accepted: false,
          conflict: true,
          duplicate: false,
          error: "The Agent Thoth state changed before this card answer was applied.",
          state: this.getForegroundStateInTransaction(input.agentId),
          card: this.getForegroundCardInTransaction(input.cardId),
          turn: this.getActiveForegroundTurn(input.agentId),
        };
      }
      const card = this.getForegroundCardInTransaction(input.cardId);
      if (!card || card.agentId !== input.agentId || card.status !== "pending") {
        return {
          accepted: false,
          conflict: false,
          duplicate: false,
          error: "This authority card is no longer pending for the Agent.",
          state: this.getForegroundStateInTransaction(input.agentId),
          card,
          turn: this.getActiveForegroundTurn(input.agentId),
        };
      }
      const turn = this.getForegroundTurnInTransaction(card.turnId);
      if (!turn || authority.active_turn_id !== turn.id) {
        throw new WorkspaceAuthorityConflictError(
          "This authority card no longer belongs to the active Agent turn.",
        );
      }

      const now = nowIso();
      const displayed = this.blobs.putJson(input.submittedCard);
      const rawAnswer = this.blobs.putJson(answer);
      this.database
        .prepare(
          `UPDATE cards SET status = 'answered', displayed_digest = ?, answer_digest = ?,
             submitted_summary = ?, updated_at = ? WHERE card_id = ?`,
        )
        .run(displayed.digest, rawAnswer.digest, input.submittedSummary, now, input.cardId);
      this.updateForegroundLifecycleInTransaction({
        agentId: input.agentId,
        turnId: turn.id,
        lifecycle: input.nextLifecycle,
        now,
      });
      const resultRevision = authority.authority_revision + 1;
      this.appendDecisionInTransaction({
        taskId: null,
        turnId: turn.id,
        cardId: card.id,
        kind: `card_${card.kind}`,
        displayed: card.card,
        rawAnswer: answer,
        normalized: input.submittedCard,
        actorId: input.actorId,
        clientId: input.clientId,
        deviceId: input.deviceId ?? null,
        commandId: input.commandId,
        expectedRevision: input.expectedRevision,
        resultRevision,
        supersedesDecisionId: null,
        fidelity: "exact",
      });
      const response = { accepted: true, conflict: false, error: null };
      this.database
        .prepare(
          `INSERT INTO authority_commands(
             command_id, aggregate_type, aggregate_id, command_kind,
             result_revision, result_json, created_at
           ) VALUES (?, 'card', ?, 'answer', ?, ?, ?)`,
        )
        .run(input.commandId, card.id, resultRevision, JSON.stringify(response), now);
      this.appendEventInTransaction({
        aggregateType: "card",
        aggregateId: card.id,
        revision: 2,
        kind: "foreground_card_answered",
        payload: { turnId: turn.id, nextLifecycle: input.nextLifecycle },
        causationId: input.commandId,
      });
      emitReason = true;
      return {
        ...response,
        duplicate: false,
        state: this.getForegroundStateInTransaction(input.agentId),
        card: this.getForegroundCardInTransaction(input.cardId),
        turn: this.getForegroundTurnInTransaction(turn.id),
      };
    });
    if (emitReason) {
      this.emit([], []);
      this.emitForeground(result.state, "card_answered");
    }
    return result;
  }

  markForegroundLifecycle(input: {
    agentId: string;
    turnId: string;
    generation: string;
    lifecycle: AgentThothLifecycle;
    reason: ForegroundAuthorityUpdateReason;
    error?: string | null;
    backgroundTaskId?: string | null;
  }): AgentThothState | null {
    AgentThothLifecycleSchema.parse(input.lifecycle);
    let state: AgentThothState | null = null;
    this.transaction(() => {
      const turn = this.getForegroundTurnInTransaction(input.turnId);
      const authority = this.getForegroundAgentRow(input.agentId);
      if (
        !turn ||
        turn.agentId !== input.agentId ||
        turn.generation !== input.generation ||
        authority?.active_turn_id !== input.turnId
      ) {
        return;
      }
      this.updateForegroundLifecycleInTransaction({
        agentId: input.agentId,
        turnId: input.turnId,
        lifecycle: input.lifecycle,
        now: nowIso(),
        error: input.error,
        backgroundTaskId: input.backgroundTaskId,
      });
      this.appendEventInTransaction({
        aggregateType: "turn",
        aggregateId: input.turnId,
        revision: this.getForegroundAgentRow(input.agentId)!.authority_revision,
        kind: `foreground_${input.reason}`,
        payload: {
          lifecycle: input.lifecycle,
          backgroundTaskId: input.backgroundTaskId ?? null,
          hasError: Boolean(input.error),
        },
      });
      state = this.getForegroundStateInTransaction(input.agentId);
    });
    if (state) {
      this.emit([], []);
      this.emitForeground(state, input.reason);
    }
    return state;
  }

  cancelActiveForegroundTurn(input: { agentId: string; submittedSummary: string }): {
    state: AgentThothState;
    pendingCards: ForegroundCardAuthorityRecord[];
  } {
    let result!: { state: AgentThothState; pendingCards: ForegroundCardAuthorityRecord[] };
    let changed = false;
    this.transaction(() => {
      const turn = this.getActiveForegroundTurn(input.agentId);
      if (!turn) {
        result = { state: this.getForegroundStateInTransaction(input.agentId), pendingCards: [] };
        return;
      }
      const pendingCards = this.listForegroundCardsForTurnInTransaction(turn.id).filter(
        (card) => card.status === "pending",
      );
      const now = nowIso();
      for (const card of pendingCards) {
        const submittedCard = {
          ...card.card,
          submitted: true,
          submittedSummary: input.submittedSummary,
        };
        const displayed = this.blobs.putJson(submittedCard);
        this.database
          .prepare(
            `UPDATE cards SET status = 'canceled', displayed_digest = ?,
               submitted_summary = ?, updated_at = ? WHERE card_id = ?`,
          )
          .run(displayed.digest, input.submittedSummary, now, card.id);
      }
      this.updateForegroundLifecycleInTransaction({
        agentId: input.agentId,
        turnId: turn.id,
        lifecycle: "canceled",
        now,
        error: null,
      });
      this.appendEventInTransaction({
        aggregateType: "turn",
        aggregateId: turn.id,
        revision: this.getForegroundAgentRow(input.agentId)!.authority_revision,
        kind: "foreground_turn_canceled",
        payload: { pendingCardIds: pendingCards.map((card) => card.id) },
      });
      result = { state: this.getForegroundStateInTransaction(input.agentId), pendingCards };
      changed = true;
    });
    if (changed) {
      this.emit([], []);
      this.emitForeground(result.state, "turn_canceled");
    }
    return result;
  }

  getForegroundCard(cardId: string): ForegroundCardAuthorityRecord | null {
    return this.getForegroundCardInTransaction(cardId);
  }

  listForegroundCardsForTurn(turnId: string): ForegroundCardAuthorityRecord[] {
    return this.listForegroundCardsForTurnInTransaction(turnId);
  }

  listForegroundCardsForAgent(agentId: string): ForegroundCardAuthorityRecord[] {
    const rows = this.database
      .prepare(
        `SELECT cards.* FROM cards
         JOIN turns ON turns.turn_id = cards.turn_id
         WHERE turns.agent_id = ? ORDER BY cards.created_at ASC`,
      )
      .all(agentId) as Array<Record<string, unknown>>;
    return rows.map((row) => this.toForegroundCard(row));
  }

  listAllForegroundCards(): ForegroundCardAuthorityRecord[] {
    const rows = this.database
      .prepare(
        `SELECT cards.*, turns.agent_id FROM cards
         JOIN turns ON turns.turn_id = cards.turn_id
         ORDER BY cards.created_at ASC`,
      )
      .all() as Array<Record<string, unknown>>;
    return rows.map((row) => this.toForegroundCard(row));
  }

  claimForegroundContinuation(input: { turnId: string; generation: string; key: string }): boolean {
    const turn = this.getForegroundTurnInTransaction(input.turnId);
    if (!turn || turn.generation !== input.generation) {
      return false;
    }
    const result = this.database
      .prepare(
        `INSERT OR IGNORE INTO foreground_continuations(turn_id, continuation_key, created_at)
         VALUES (?, ?, ?)`,
      )
      .run(input.turnId, input.key, nowIso());
    return result.changes === 1;
  }

  createTask(taskInput: TaskProjection, catalog: WorkspaceCatalogStore): TaskProjection {
    const task = TaskProjectionSchema.parse(taskInput);
    if (task.workspaceId !== this.workspaceId) {
      throw new Error("Task workspace does not match authority shard");
    }
    this.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO tasks(
             task_id, workspace_id, source_agent_id, execution_mode, title, goal,
             constraints_json, acceptance_json, status, summary, current_goal_id,
             current_execution_id, latest_review_direction, budget_strength,
             used_failed_reviews, max_failed_reviews, active_duration_ms, token_count,
             tool_call_count, pending_control, revision, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          task.id,
          task.workspaceId,
          task.sourceAgentId,
          task.mode,
          task.title,
          task.goal,
          JSON.stringify(task.constraints),
          JSON.stringify(task.acceptance),
          task.status,
          task.summary,
          task.currentGoalId,
          task.currentExecutionId,
          task.latestReviewDirection,
          task.budget.strength,
          task.budget.usedFailedReviews,
          task.budget.maxFailedReviews,
          task.budget.activeDurationMs,
          task.budget.tokenCount,
          task.budget.toolCallCount,
          task.pendingControl,
          task.revision,
          task.createdAt,
          task.updatedAt,
        );
      const insertGoal = this.database.prepare(
        `INSERT INTO task_goals(
           goal_id, task_id, goal_order, title, goal, constraints_json,
           acceptance_json, status, revision
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const goal of task.goals) {
        insertGoal.run(
          goal.id,
          task.id,
          goal.order,
          goal.title,
          goal.goal,
          JSON.stringify(goal.constraints),
          JSON.stringify(goal.acceptance),
          goal.status,
          goal.revision,
        );
      }
      this.appendEventInTransaction({
        aggregateType: "task",
        aggregateId: task.id,
        revision: task.revision,
        kind: "task_created",
        payload: { mode: task.mode, sourceAgentId: task.sourceAgentId },
      });
    });
    catalog.updateTaskLocator({
      taskId: task.id,
      workspaceId: task.workspaceId,
      title: task.title,
      status: task.status,
      revision: task.revision,
      updatedAt: task.updatedAt,
    });
    this.emit([task.id], []);
    return task;
  }

  registerTask(input: {
    task: TaskProjection;
    sourceTurnId: string;
    sourceGoalsCardId: string;
    providerProfileId: string;
    taskContract: unknown;
    goalsContract: unknown;
  }): { task: TaskProjection; created: boolean } {
    const task = TaskProjectionSchema.parse(input.task);
    if (task.workspaceId !== this.workspaceId) {
      throw new Error("Task workspace does not match authority shard");
    }
    let result!: { task: TaskProjection; created: boolean };
    this.transaction(() => {
      const existing = this.database
        .prepare(`SELECT * FROM tasks WHERE source_turn_id = ? AND source_goals_card_id = ?`)
        .get(input.sourceTurnId, input.sourceGoalsCardId) as TaskRow | undefined;
      if (existing) {
        result = { task: this.toTaskProjection(existing), created: false };
        return;
      }
      this.database
        .prepare(
          `INSERT INTO tasks(
             task_id, workspace_id, source_agent_id, execution_mode, title, goal,
             constraints_json, acceptance_json, status, summary, current_goal_id,
             current_execution_id, latest_review_direction, source_turn_id,
             source_goals_card_id, provider_profile_id, budget_strength,
             used_failed_reviews, max_failed_reviews, active_duration_ms, token_count,
             tool_call_count, pending_control, goals_revision, revision, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
        )
        .run(
          task.id,
          task.workspaceId,
          task.sourceAgentId,
          task.mode,
          task.title,
          task.goal,
          JSON.stringify(task.constraints),
          JSON.stringify(task.acceptance),
          task.status,
          task.summary,
          task.currentGoalId,
          task.currentExecutionId,
          task.latestReviewDirection,
          input.sourceTurnId,
          input.sourceGoalsCardId,
          input.providerProfileId,
          task.budget.strength,
          task.budget.usedFailedReviews,
          task.budget.maxFailedReviews,
          task.budget.activeDurationMs,
          task.budget.tokenCount,
          task.budget.toolCallCount,
          task.pendingControl,
          task.revision,
          task.createdAt,
          task.updatedAt,
        );
      const insertGoal = this.database.prepare(
        `INSERT INTO task_goals(
           goal_id, task_id, goal_order, title, goal, constraints_json,
           acceptance_json, status, revision
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const goal of task.goals) {
        insertGoal.run(
          goal.id,
          task.id,
          goal.order,
          goal.title,
          goal.goal,
          JSON.stringify(goal.constraints),
          JSON.stringify(goal.acceptance),
          goal.status,
          goal.revision,
        );
      }
      this.database
        .prepare("UPDATE turns SET task_id = ? WHERE turn_id = ?")
        .run(task.id, input.sourceTurnId);
      this.database
        .prepare("UPDATE cards SET task_id = ? WHERE turn_id = ?")
        .run(task.id, input.sourceTurnId);
      this.database
        .prepare("UPDATE human_decisions SET task_id = ? WHERE turn_id = ? AND task_id IS NULL")
        .run(task.id, input.sourceTurnId);
      this.appendBlackboardInTransaction({
        taskId: task.id,
        kind: "task_contract",
        producer: "secretary",
        content: input.taskContract,
      });
      this.appendBlackboardInTransaction({
        taskId: task.id,
        kind: "goal_contract",
        producer: "secretary",
        content: input.goalsContract,
      });
      this.appendEventInTransaction({
        aggregateType: "task",
        aggregateId: task.id,
        revision: task.revision,
        kind: "task_registered",
        payload: {
          mode: task.mode,
          sourceAgentId: task.sourceAgentId,
          sourceTurnId: input.sourceTurnId,
          sourceGoalsCardId: input.sourceGoalsCardId,
        },
      });
      result = { task: this.getTask(task.id)!, created: true };
    });
    if (result.created) {
      this.syncTaskLocator(result.task);
      this.emit([result.task.id], []);
    }
    return result;
  }

  getTask(taskId: string): TaskProjection | null {
    const row = this.database.prepare("SELECT * FROM tasks WHERE task_id = ?").get(taskId) as
      | TaskRow
      | undefined;
    return row ? this.toTaskProjection(row) : null;
  }

  getTaskRuntimeMetadata(taskId: string): TaskRuntimeMetadata | null {
    const row = this.database
      .prepare(
        `SELECT source_turn_id, source_goals_card_id, provider_profile_id, goals_revision
         FROM tasks WHERE task_id = ?`,
      )
      .get(taskId) as
      | {
          source_turn_id: string | null;
          source_goals_card_id: string | null;
          provider_profile_id: string | null;
          goals_revision: number;
        }
      | undefined;
    if (!row || !row.source_turn_id || !row.source_goals_card_id || !row.provider_profile_id) {
      return null;
    }
    return {
      sourceTurnId: row.source_turn_id,
      sourceGoalsCardId: row.source_goals_card_id,
      providerProfileId: row.provider_profile_id,
      goalsRevision: row.goals_revision,
    };
  }

  listTasks(): TaskProjection[] {
    const rows = this.database
      .prepare("SELECT * FROM tasks ORDER BY updated_at DESC")
      .all() as TaskRow[];
    return rows.map((row) => this.toTaskProjection(row));
  }

  searchTasks(query: string, limit: number): TaskProjection[] {
    const normalized = query.trim();
    const rows = this.database
      .prepare(
        `SELECT * FROM tasks
         WHERE (? = '' OR title LIKE ? ESCAPE '\\' OR task_id LIKE ? ESCAPE '\\')
         ORDER BY updated_at DESC LIMIT ?`,
      )
      .all(normalized, `%${normalized}%`, `%${normalized}%`, limit) as TaskRow[];
    return rows.map((row) => this.toTaskProjection(row));
  }

  getPendingTaskDecision(taskId: string): TaskUserDecisionProjection | null {
    const row = this.database
      .prepare(
        `SELECT request_digest FROM task_decision_requests
         WHERE task_id = ? AND status = 'pending'`,
      )
      .get(taskId) as { request_digest: string } | undefined;
    return row
      ? TaskUserDecisionProjectionSchema.parse(this.blobs.readJson(row.request_digest))
      : null;
  }

  createExecution(input: {
    execution: ExecutionProjection;
    providerThread?: {
      id: string;
      adapterId: string;
      nativeHandle?: string | null;
      persistence?: Record<string, unknown> | null;
      lineageParentId?: string | null;
    };
  }): ExecutionProjection {
    const execution = ExecutionProjectionSchema.parse(input.execution);
    const task = this.getTask(execution.taskId);
    if (!task) {
      throw new Error(`Task ${execution.taskId} does not exist`);
    }
    this.transaction(() => {
      if (input.providerThread) {
        const now = nowIso();
        this.database
          .prepare(
            `INSERT OR IGNORE INTO provider_threads(
               thread_id, adapter_id, native_handle, persistence_json, lineage_parent_id,
               status, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
          )
          .run(
            input.providerThread.id,
            input.providerThread.adapterId,
            input.providerThread.nativeHandle ?? null,
            input.providerThread.persistence
              ? JSON.stringify(input.providerThread.persistence)
              : null,
            input.providerThread.lineageParentId ?? null,
            now,
            now,
          );
      }
      this.database
        .prepare(
          `INSERT OR IGNORE INTO phase_runs(
             phase_run_id, task_id, goal_id, phase_kind, status, created_at, updated_at
           ) VALUES (?, ?, ?, ?, 'running', ?, ?)`,
        )
        .run(
          execution.phaseRunId,
          execution.taskId,
          execution.goalId,
          execution.phase,
          execution.startedAt ?? nowIso(),
          execution.lastActivityAt ?? nowIso(),
        );
      this.database
        .prepare(
          `INSERT INTO execution_attempts(
             execution_id, task_id, goal_id, phase_run_id, phase_kind, provider_thread_id,
             status, generation, run_mode_receipt_json,
             started_at, last_activity_at, completed_at, summary, revision
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          execution.id,
          execution.taskId,
          execution.goalId,
          execution.phaseRunId,
          execution.phase,
          execution.providerThreadId,
          execution.status,
          execution.generation,
          execution.runModeReceipt ? JSON.stringify(execution.runModeReceipt) : null,
          execution.startedAt,
          execution.lastActivityAt,
          execution.completedAt,
          execution.summary,
          execution.revision,
        );
      this.database
        .prepare(
          `UPDATE tasks SET current_execution_id = ?, status = 'running',
             pending_control = CASE
               WHEN ? = 'review' AND pending_control = 'review_only' THEN NULL
               ELSE pending_control
             END,
             revision = revision + 1, updated_at = ? WHERE task_id = ?`,
        )
        .run(execution.id, execution.phase, nowIso(), execution.taskId);
      if (execution.goalId) {
        this.database
          .prepare(
            `UPDATE task_goals SET status = 'running', revision = revision + 1
             WHERE goal_id = ? AND status IN ('queued', 'interrupted')`,
          )
          .run(execution.goalId);
      }
      this.appendEventInTransaction({
        aggregateType: "execution",
        aggregateId: execution.id,
        revision: execution.revision,
        kind: "execution_created",
        payload: { taskId: execution.taskId, phase: execution.phase },
      });
    });
    this.emit([execution.taskId], [execution.id]);
    this.syncTaskLocator(this.getTask(execution.taskId)!);
    return execution;
  }

  getExecution(executionId: string): ExecutionProjection | null {
    const row = this.database
      .prepare("SELECT * FROM execution_attempts WHERE execution_id = ?")
      .get(executionId) as ExecutionRow | undefined;
    return row ? this.toExecutionProjection(row) : null;
  }

  listExecutions(taskId: string): ExecutionProjection[] {
    const rows = this.database
      .prepare(
        "SELECT * FROM execution_attempts WHERE task_id = ? ORDER BY started_at ASC, execution_id ASC",
      )
      .all(taskId) as ExecutionRow[];
    return rows.map((row) => this.toExecutionProjection(row));
  }

  getProviderThread(threadId: string): ProviderThreadRecord | null {
    const row = this.database
      .prepare("SELECT * FROM provider_threads WHERE thread_id = ?")
      .get(threadId) as Record<string, unknown> | undefined;
    return row
      ? {
          id: String(row.thread_id),
          adapterId: String(row.adapter_id),
          nativeHandle: typeof row.native_handle === "string" ? row.native_handle : null,
          persistence:
            typeof row.persistence_json === "string"
              ? (JSON.parse(row.persistence_json) as Record<string, unknown>)
              : null,
          lineageParentId: typeof row.lineage_parent_id === "string" ? row.lineage_parent_id : null,
          status: String(row.status),
        }
      : null;
  }

  findLatestPlanExecThread(taskId: string, goalId: string): ProviderThreadRecord | null {
    const row = this.database
      .prepare(
        `SELECT provider_threads.* FROM execution_attempts
         JOIN provider_threads ON provider_threads.thread_id = execution_attempts.provider_thread_id
         WHERE execution_attempts.task_id = ? AND execution_attempts.goal_id = ?
           AND execution_attempts.phase_kind = 'planexec'
           AND provider_threads.status IN ('active', 'resumable')
         ORDER BY execution_attempts.started_at DESC LIMIT 1`,
      )
      .get(taskId, goalId) as Record<string, unknown> | undefined;
    return row ? this.getProviderThread(String(row.thread_id)) : null;
  }

  findLatestPlanExecLineageThread(taskId: string, goalId: string): ProviderThreadRecord | null {
    const row = this.database
      .prepare(
        `SELECT provider_threads.* FROM execution_attempts
         JOIN provider_threads ON provider_threads.thread_id = execution_attempts.provider_thread_id
         WHERE execution_attempts.task_id = ? AND execution_attempts.goal_id = ?
           AND execution_attempts.phase_kind = 'planexec'
         ORDER BY execution_attempts.started_at DESC LIMIT 1`,
      )
      .get(taskId, goalId) as Record<string, unknown> | undefined;
    return row ? this.getProviderThread(String(row.thread_id)) : null;
  }

  listProviderThreadsByStatus(status: string): ProviderThreadRecord[] {
    const rows = this.database
      .prepare("SELECT thread_id FROM provider_threads WHERE status = ? ORDER BY created_at ASC")
      .all(status) as Array<{ thread_id: string }>;
    return rows.flatMap((row) => {
      const thread = this.getProviderThread(row.thread_id);
      return thread ? [thread] : [];
    });
  }

  updateProviderThread(input: {
    threadId: string;
    nativeHandle: string | null;
    persistence: Record<string, unknown> | null;
    status?: string;
  }): boolean {
    const result = this.database
      .prepare(
        `UPDATE provider_threads SET native_handle = ?, persistence_json = ?,
           status = COALESCE(?, status), updated_at = ? WHERE thread_id = ?`,
      )
      .run(
        input.nativeHandle,
        input.persistence ? JSON.stringify(input.persistence) : null,
        input.status ?? null,
        nowIso(),
        input.threadId,
      );
    return result.changes === 1;
  }

  updateExecution(input: {
    executionId: string;
    generation: string;
    expectedRevision: number;
    status: ExecutionLifecycle;
    summary?: string | null;
  }): ExecutionProjection | null {
    let changed = false;
    this.transaction(() => {
      const current = this.getExecution(input.executionId);
      if (
        !current ||
        current.generation !== input.generation ||
        current.revision !== input.expectedRevision
      ) {
        return;
      }
      const now = nowIso();
      const terminal = ["canceled", "succeeded", "failed", "orphaned"].includes(input.status);
      const result = this.database
        .prepare(
          `UPDATE execution_attempts SET status = ?, summary = ?,
             last_activity_at = ?, completed_at = ?, revision = revision + 1
           WHERE execution_id = ? AND generation = ? AND revision = ?`,
        )
        .run(
          input.status,
          input.summary === undefined ? current.summary : input.summary,
          now,
          terminal ? now : current.completedAt,
          input.executionId,
          input.generation,
          input.expectedRevision,
        );
      if (result.changes !== 1) {
        return;
      }
      changed = true;
      this.appendEventInTransaction({
        aggregateType: "execution",
        aggregateId: input.executionId,
        revision: input.expectedRevision + 1,
        kind: `execution_${input.status}`,
        payload: { summary: input.summary ?? null },
      });
    });
    const updated = changed ? this.getExecution(input.executionId) : null;
    if (updated) {
      this.emit([updated.taskId], [updated.id]);
    }
    return updated;
  }

  recordExecutionRunModeReceipt(input: {
    executionId: string;
    generation: string;
    expectedRevision: number;
    receipt: ProviderRunModeReceipt;
    status: Extract<ExecutionLifecycle, "planning" | "running">;
  }): ExecutionProjection | null {
    const receipt = ProviderRunModeReceiptSchema.parse(input.receipt);
    let changed = false;
    this.transaction(() => {
      const current = this.getExecution(input.executionId);
      if (
        !current ||
        current.generation !== input.generation ||
        current.revision !== input.expectedRevision ||
        current.status !== "starting"
      ) {
        return;
      }
      const now = nowIso();
      const result = this.database
        .prepare(
          `UPDATE execution_attempts SET run_mode_receipt_json = ?, status = ?,
             last_activity_at = ?, revision = revision + 1
           WHERE execution_id = ? AND generation = ? AND revision = ? AND status = 'starting'`,
        )
        .run(
          JSON.stringify(receipt),
          input.status,
          now,
          input.executionId,
          input.generation,
          input.expectedRevision,
        );
      if (result.changes !== 1) {
        return;
      }
      changed = true;
      this.appendEventInTransaction({
        aggregateType: "execution",
        aggregateId: input.executionId,
        revision: input.expectedRevision + 1,
        kind: "execution_provider_mode_applied",
        payload: {
          requestedMode: receipt.requestedMode,
          status: receipt.status,
          nativeModeId: receipt.nativeModeId,
        },
      });
    });
    const updated = changed ? this.getExecution(input.executionId) : null;
    if (updated) {
      this.emit([updated.taskId], [updated.id]);
    }
    return updated;
  }

  createExecutionApproval(input: {
    executionId: string;
    generation: string;
    request: HarnessApprovalRequest;
    deadlineAt: string | null;
  }): ExecutionApprovalProjection {
    if (input.request.kind === "question" || !input.request.autoApproveEligible) {
      throw new Error("Provider questions cannot enter the execution approval authority.");
    }
    let approvalId: string | null = null;
    let taskId: string | null = null;
    this.transaction(() => {
      const existing = this.database
        .prepare(
          `SELECT * FROM execution_approvals
           WHERE execution_id = ? AND provider_request_id = ?`,
        )
        .get(input.executionId, input.request.id) as ExecutionApprovalRow | undefined;
      if (existing) {
        approvalId = existing.approval_id;
        taskId = existing.task_id;
        return;
      }
      const execution = this.getExecution(input.executionId);
      const task = execution ? this.getTask(execution.taskId) : null;
      if (
        !execution ||
        !task ||
        execution.generation !== input.generation ||
        task.currentExecutionId !== execution.id ||
        task.status === "stopping" ||
        ["canceled", "succeeded", "failed", "orphaned"].includes(execution.status)
      ) {
        throw new WorkspaceAuthorityConflictError(
          "Execution changed before the provider approval could be recorded.",
        );
      }
      const pending = this.database
        .prepare(
          "SELECT approval_id FROM execution_approvals WHERE execution_id = ? AND status = 'pending'",
        )
        .get(execution.id) as { approval_id: string } | undefined;
      if (pending) {
        throw new WorkspaceAuthorityConflictError(
          `Execution ${execution.id} already has pending approval ${pending.approval_id}.`,
        );
      }
      const now = nowIso();
      approvalId = `execution-approval-${randomUUID()}`;
      taskId = execution.taskId;
      const displayed = this.blobs.putJson(input.request.displayed);
      this.database
        .prepare(
          `INSERT INTO execution_approvals(
             approval_id, provider_request_id, task_id, execution_id, generation,
             kind, title, description, displayed_digest, auto_approve_eligible,
             deadline_at, status, resolution_decision, resolution_actor_id,
             resolved_at, revision, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'pending', NULL, NULL, NULL, 1, ?, ?)`,
        )
        .run(
          approvalId,
          input.request.id,
          execution.taskId,
          execution.id,
          execution.generation,
          input.request.kind,
          input.request.title,
          input.request.description,
          displayed.digest,
          input.deadlineAt,
          now,
          now,
        );
      const nextStatus: ExecutionLifecycle =
        input.request.kind === "implement" ? "awaiting_implementation" : "awaiting_user";
      this.database
        .prepare(
          `UPDATE execution_attempts SET status = ?, last_activity_at = ?, revision = revision + 1
           WHERE execution_id = ? AND generation = ?`,
        )
        .run(nextStatus, now, execution.id, execution.generation);
      this.database
        .prepare(
          `UPDATE tasks SET summary = ?, revision = revision + 1, updated_at = ?
           WHERE task_id = ?`,
        )
        .run(
          input.request.kind === "implement"
            ? "Native Plan is ready for implementation approval."
            : "Provider approval is waiting for a user decision.",
          now,
          execution.taskId,
        );
      this.appendEventInTransaction({
        aggregateType: "execution_approval",
        aggregateId: approvalId,
        revision: 1,
        kind: "execution_approval_requested",
        payload: {
          taskId: execution.taskId,
          executionId: execution.id,
          kind: input.request.kind,
          deadlineAt: input.deadlineAt,
        },
      });
    });
    if (!approvalId || !taskId) {
      throw new Error("Execution approval was not recorded.");
    }
    const approval = this.getExecutionApproval(approvalId);
    if (!approval) {
      throw new Error(`Execution approval ${approvalId} disappeared after commit.`);
    }
    this.emit([taskId], [input.executionId]);
    this.syncTaskLocator(this.getTask(taskId)!);
    return approval;
  }

  getExecutionApproval(approvalId: string): ExecutionApprovalProjection | null {
    const row = this.database
      .prepare("SELECT * FROM execution_approvals WHERE approval_id = ?")
      .get(approvalId) as ExecutionApprovalRow | undefined;
    return row ? this.toExecutionApprovalProjection(row) : null;
  }

  getPendingExecutionApproval(executionId: string): ExecutionApprovalProjection | null {
    const row = this.database
      .prepare(
        `SELECT * FROM execution_approvals
         WHERE execution_id = ? AND status = 'pending' ORDER BY created_at ASC LIMIT 1`,
      )
      .get(executionId) as ExecutionApprovalRow | undefined;
    return row ? this.toExecutionApprovalProjection(row) : null;
  }

  getLatestExecutionApproval(executionId: string): ExecutionApprovalProjection | null {
    const row = this.database
      .prepare(
        `SELECT * FROM execution_approvals
         WHERE execution_id = ? ORDER BY created_at DESC LIMIT 1`,
      )
      .get(executionId) as ExecutionApprovalRow | undefined;
    return row ? this.toExecutionApprovalProjection(row) : null;
  }

  getProviderApprovalRequestId(approvalId: string): string | null {
    const row = this.database
      .prepare("SELECT provider_request_id FROM execution_approvals WHERE approval_id = ?")
      .get(approvalId) as { provider_request_id: string } | undefined;
    return row?.provider_request_id ?? null;
  }

  resolveExecutionApproval(input: {
    taskId: string;
    executionId: string;
    approvalId: string;
    decision: ExecutionApprovalDecision;
    expectedRevision: number;
    commandId: string;
    actorId: string;
    clientId: string;
    deviceId?: string | null;
    recordHumanDecision: boolean;
  }): ExecutionApprovalAuthorityResult {
    let result!: ExecutionApprovalAuthorityResult;
    this.transaction(() => {
      const duplicate = this.database
        .prepare("SELECT result_json FROM authority_commands WHERE command_id = ?")
        .get(input.commandId) as { result_json: string } | undefined;
      if (duplicate) {
        const stored = JSON.parse(duplicate.result_json) as {
          taskId: string;
          executionId: string;
          approvalId: string;
        };
        const task = this.getTask(stored.taskId);
        const execution = this.getExecution(stored.executionId);
        const approval = this.getExecutionApproval(stored.approvalId);
        if (!task || !execution || !approval) {
          throw new Error("Recorded execution approval result is incomplete.");
        }
        result = { task, execution, approval, duplicate: true };
        return;
      }

      const task = this.getTask(input.taskId);
      const execution = this.getExecution(input.executionId);
      const row = this.database
        .prepare("SELECT * FROM execution_approvals WHERE approval_id = ?")
        .get(input.approvalId) as ExecutionApprovalRow | undefined;
      if (
        !task ||
        !execution ||
        !row ||
        execution.taskId !== task.id ||
        row.task_id !== task.id ||
        row.execution_id !== execution.id
      ) {
        throw new Error("Execution approval does not belong to the requested Task.");
      }
      if (
        row.status !== "pending" ||
        row.revision !== input.expectedRevision ||
        row.generation !== execution.generation ||
        task.currentExecutionId !== execution.id ||
        task.status === "stopping"
      ) {
        throw new WorkspaceAuthorityConflictError(
          "Execution approval changed before this decision was committed.",
        );
      }
      if (row.kind === "implement" && !["implement", "deny"].includes(input.decision)) {
        throw new Error("A native Plan approval requires Implement or Deny.");
      }
      if (row.kind !== "implement" && input.decision === "implement") {
        throw new Error("Implement is only valid for a native Plan approval.");
      }

      const now = nowIso();
      const approvalStatus = input.decision === "deny" ? "denied" : "allowed";
      const approvalUpdate = this.database
        .prepare(
          `UPDATE execution_approvals SET status = ?, resolution_decision = ?,
             resolution_actor_id = ?, resolved_at = ?, revision = revision + 1, updated_at = ?
           WHERE approval_id = ? AND status = 'pending' AND revision = ?`,
        )
        .run(
          approvalStatus,
          input.decision,
          input.actorId,
          now,
          now,
          input.approvalId,
          input.expectedRevision,
        );
      if (approvalUpdate.changes !== 1) {
        throw new WorkspaceAuthorityConflictError("Another approval decision won the CAS race.");
      }

      const denied = input.decision === "deny";
      const nextExecutionStatus: ExecutionLifecycle = denied
        ? "failed"
        : row.kind === "implement"
          ? "implementing"
          : "awaiting_provider";
      this.database
        .prepare(
          `UPDATE execution_attempts SET status = ?, last_activity_at = ?,
             completed_at = ?, summary = ?, revision = revision + 1
           WHERE execution_id = ? AND generation = ?`,
        )
        .run(
          nextExecutionStatus,
          now,
          denied ? now : null,
          denied ? "Provider approval was denied." : execution.summary,
          execution.id,
          execution.generation,
        );
      const nextTaskRevision = task.revision + 1;
      this.database
        .prepare(
          `UPDATE tasks SET status = ?, summary = ?, current_execution_id = ?,
             revision = ?, updated_at = ? WHERE task_id = ? AND revision = ?`,
        )
        .run(
          denied ? "interrupted" : "running",
          denied
            ? "Provider approval was denied; resume reruns this phase."
            : row.kind === "implement"
              ? "Native Plan approved; implementation is running."
              : "Provider approval resolved; execution is continuing.",
          denied ? null : execution.id,
          nextTaskRevision,
          now,
          task.id,
          task.revision,
        );
      if (input.recordHumanDecision) {
        this.appendDecisionInTransaction({
          taskId: task.id,
          turnId: null,
          cardId: null,
          kind: "execution_approval",
          displayed: this.blobs.readJson(row.displayed_digest),
          rawAnswer: { decision: input.decision },
          normalized: {
            approvalId: input.approvalId,
            executionId: execution.id,
            kind: row.kind,
            decision: input.decision,
          },
          actorId: input.actorId,
          clientId: input.clientId,
          deviceId: input.deviceId ?? null,
          commandId: input.commandId,
          expectedRevision: input.expectedRevision,
          resultRevision: nextTaskRevision,
          supersedesDecisionId: null,
          fidelity: "exact",
        });
      }
      this.appendEventInTransaction({
        aggregateType: "execution_approval",
        aggregateId: input.approvalId,
        revision: input.expectedRevision + 1,
        kind: `execution_approval_${approvalStatus}`,
        payload: {
          taskId: task.id,
          executionId: execution.id,
          decision: input.decision,
          actorId: input.actorId,
        },
        causationId: input.commandId,
      });
      this.database
        .prepare(
          `INSERT INTO authority_commands(
             command_id, aggregate_type, aggregate_id, command_kind,
             result_revision, result_json, created_at
           ) VALUES (?, 'execution_approval', ?, 'resolve', ?, ?, ?)`,
        )
        .run(
          input.commandId,
          input.approvalId,
          input.expectedRevision + 1,
          JSON.stringify({
            taskId: task.id,
            executionId: execution.id,
            approvalId: input.approvalId,
          }),
          now,
        );
      result = {
        task: this.getTask(task.id)!,
        execution: this.getExecution(execution.id)!,
        approval: this.getExecutionApproval(input.approvalId)!,
        duplicate: false,
      };
    });
    this.emit([input.taskId], [input.executionId]);
    this.syncTaskLocator(result.task);
    return result;
  }

  acceptPlanExecResult(input: {
    executionId: string;
    generation: string;
    result: ThothLoopPlanExecResultInput;
    callId: string;
  }): boolean {
    let taskId: string | null = null;
    this.transaction(() => {
      const execution = this.requireActiveSemanticExecution({
        executionId: input.executionId,
        generation: input.generation,
        phase: "planexec",
      });
      taskId = execution.taskId;
      const task = this.getTask(execution.taskId)!;
      const pauseAtBoundary = task.pendingControl === "pause";
      this.appendBlackboardInTransaction({
        taskId: task.id,
        kind: "planexec_report",
        producer: "planexec",
        content: input.result,
      });
      const now = nowIso();
      this.database
        .prepare(
          `UPDATE execution_attempts SET status = 'succeeded', summary = ?,
             last_activity_at = ?, completed_at = ?, revision = revision + 1
           WHERE execution_id = ? AND generation = ?`,
        )
        .run(input.result.execution_summary, now, now, execution.id, execution.generation);
      this.database
        .prepare(
          "UPDATE phase_runs SET status = 'succeeded', updated_at = ? WHERE phase_run_id = ?",
        )
        .run(now, execution.phaseRunId);
      this.database
        .prepare(
          `UPDATE tasks SET status = ?, summary = ?, current_execution_id = NULL,
             pending_control = NULL, revision = revision + 1, updated_at = ? WHERE task_id = ?`,
        )
        .run(
          pauseAtBoundary ? "paused" : "queued",
          pauseAtBoundary
            ? "Paused after PlanExec; independent Review remains queued."
            : "PlanExec completed; independent Review is queued.",
          now,
          task.id,
        );
      this.appendEventInTransaction({
        aggregateType: "execution",
        aggregateId: execution.id,
        revision: execution.revision + 1,
        kind: "planexec_result_accepted",
        payload: {
          taskId: task.id,
          goalId: execution.goalId,
          nextTaskStatus: pauseAtBoundary ? "paused" : "queued",
        },
        causationId: input.callId,
      });
    });
    if (!taskId) {
      return false;
    }
    const task = this.getTask(taskId)!;
    this.syncTaskLocator(task);
    this.emit([taskId], [input.executionId]);
    return true;
  }

  acceptReviewAssessment(input: {
    executionId: string;
    generation: string;
    assessment: ThothLoopReviewIndependentAssessmentInput;
  }): string {
    let taskId = "";
    this.transaction(() => {
      const execution = this.requireActiveSemanticExecution({
        executionId: input.executionId,
        generation: input.generation,
        phase: "review",
      });
      taskId = execution.taskId;
      this.appendBlackboardInTransaction({
        taskId,
        kind: "review_assessment",
        producer: "review",
        content: input.assessment,
      });
      this.appendEventInTransaction({
        aggregateType: "execution",
        aggregateId: execution.id,
        revision: execution.revision,
        kind: "review_independent_assessment_accepted",
        payload: { taskId, goalId: execution.goalId },
      });
    });
    this.emit([taskId], [input.executionId]);
    const report = this.listBlackboard(taskId)
      .filter((entry) => entry.kind === "planexec_report")
      .at(-1);
    if (!report) {
      throw new Error("Review cannot compare reality before a PlanExec report exists");
    }
    return [
      "Independent assessment recorded. Now compare it with PlanExec's semantic account:",
      JSON.stringify(report.content),
      "Return one Review outcome based on workspace reality, the approved goal, and this account.",
    ].join("\n\n");
  }

  acceptReviewVerdict(input: {
    executionId: string;
    generation: string;
    verdict: ThothLoopReviewVerdictInput;
    callId: string;
  }): boolean {
    let taskId: string | null = null;
    this.transaction(() => {
      const execution = this.requireActiveSemanticExecution({
        executionId: input.executionId,
        generation: input.generation,
        phase: "review",
      });
      if (!execution.goalId) {
        throw new Error("Review execution is missing its Goal identity");
      }
      taskId = execution.taskId;
      const task = this.getTask(execution.taskId)!;
      const goal = task.goals.find((candidate) => candidate.id === execution.goalId);
      if (!goal) {
        throw new Error(`Goal ${execution.goalId} does not belong to Task ${task.id}`);
      }
      const now = nowIso();
      this.appendBlackboardInTransaction({
        taskId: task.id,
        kind: "evidence_summary",
        producer: "review",
        content: {
          outcome: input.verdict.outcome,
          summary: input.verdict.summary,
          evidenceSummary: input.verdict.evidence_summary ?? null,
        },
      });
      if (input.verdict.direction_memo) {
        this.appendBlackboardInTransaction({
          taskId: task.id,
          kind: "review_direction",
          producer: "review",
          content: input.verdict.direction_memo,
        });
      }
      if (input.verdict.user_decision) {
        const decisionRequest = TaskUserDecisionProjectionSchema.parse({
          id: `task-decision-${randomUUID()}`,
          title: input.verdict.user_decision.title,
          question: input.verdict.user_decision.question,
          options: input.verdict.user_decision.options,
          ...(input.verdict.user_decision.note_placeholder === undefined
            ? {}
            : { notePlaceholder: input.verdict.user_decision.note_placeholder }),
          createdAt: now,
        });
        const requestBlob = this.blobs.putJson(decisionRequest);
        this.database
          .prepare(
            `INSERT INTO task_decision_requests(
               decision_id, task_id, request_digest, status, created_at
             ) VALUES (?, ?, ?, 'pending', ?)`,
          )
          .run(decisionRequest.id, task.id, requestBlob.digest, now);
        this.appendBlackboardInTransaction({
          taskId: task.id,
          kind: "user_decision_request",
          producer: "review",
          content: decisionRequest,
        });
      }
      if (input.verdict.deferred_goal_replan_proposal) {
        this.appendBlackboardInTransaction({
          taskId: task.id,
          kind: "replan_proposal",
          producer: "review",
          content: input.verdict.deferred_goal_replan_proposal,
        });
      }

      let nextTaskStatus: TaskProjection["status"] = "queued";
      let nextGoalStatus: TaskProjection["goals"][number]["status"] = "queued";
      let nextGoalId: string | null = goal.id;
      let usedFailedReviews = task.budget.usedFailedReviews;
      let summary = input.verdict.summary;
      let latestDirection = task.latestReviewDirection;

      switch (input.verdict.outcome) {
        case "pass": {
          nextGoalStatus = "passed";
          const nextGoal = task.goals.find(
            (candidate) => candidate.order > goal.order && candidate.status === "queued",
          );
          nextGoalId = nextGoal?.id ?? null;
          nextTaskStatus = nextGoal ? "queued" : "completed";
          break;
        }
        case "continue":
        case "reframe_current_goal":
          usedFailedReviews += 1;
          nextTaskStatus =
            usedFailedReviews >= task.budget.maxFailedReviews ? "budget_wait" : "queued";
          latestDirection = input.verdict.direction_memo
            ? JSON.stringify(input.verdict.direction_memo)
            : null;
          break;
        case "replan_unstarted_goals":
          this.applyFutureGoalReplanInTransaction(task, goal.id, input.verdict);
          nextGoalStatus = "passed";
          nextGoalId =
            input.verdict
              .deferred_goal_replan_proposal!.goals.slice()
              .sort((left, right) => left.order - right.order)[0]?.id ?? null;
          nextTaskStatus = nextGoalId ? "queued" : "completed";
          break;
        case "return_to_user_decision":
          nextTaskStatus = "awaiting_user";
          nextGoalStatus = "awaiting_user";
          break;
        case "real_blocker":
          nextTaskStatus = "blocked";
          nextGoalStatus = "blocked";
          this.appendBlackboardInTransaction({
            taskId: task.id,
            kind: "blocker",
            producer: "review",
            content: { summary: input.verdict.summary },
          });
          break;
      }

      if (task.pendingControl === "pause" && nextTaskStatus === "queued") {
        nextTaskStatus = "paused";
      }
      this.database
        .prepare(`UPDATE task_goals SET status = ?, revision = revision + 1 WHERE goal_id = ?`)
        .run(nextGoalStatus, goal.id);
      this.database
        .prepare(
          `UPDATE execution_attempts SET status = 'succeeded', summary = ?,
             last_activity_at = ?, completed_at = ?, revision = revision + 1
           WHERE execution_id = ? AND generation = ?`,
        )
        .run(input.verdict.summary, now, now, execution.id, execution.generation);
      this.database
        .prepare(
          "UPDATE phase_runs SET status = 'succeeded', updated_at = ? WHERE phase_run_id = ?",
        )
        .run(now, execution.phaseRunId);
      this.database
        .prepare(
          `UPDATE tasks SET status = ?, summary = ?, current_goal_id = ?,
             current_execution_id = NULL, latest_review_direction = ?,
             used_failed_reviews = ?, pending_control = NULL,
             revision = revision + 1, updated_at = ? WHERE task_id = ?`,
        )
        .run(nextTaskStatus, summary, nextGoalId, latestDirection, usedFailedReviews, now, task.id);
      this.appendEventInTransaction({
        aggregateType: "execution",
        aggregateId: execution.id,
        revision: execution.revision + 1,
        kind: "review_verdict_accepted",
        payload: {
          taskId: task.id,
          goalId: goal.id,
          outcome: input.verdict.outcome,
          nextTaskStatus,
        },
        causationId: input.callId,
      });
    });
    if (!taskId) {
      return false;
    }
    const task = this.getTask(taskId)!;
    this.syncTaskLocator(task);
    this.emit([taskId], [input.executionId]);
    return true;
  }

  acceptExecutionBlocker(input: {
    executionId: string;
    generation: string;
    report: ThothLoopReportBlockedInput;
  }): boolean {
    let taskId: string | null = null;
    this.transaction(() => {
      const execution = this.requireActiveSemanticExecution({
        executionId: input.executionId,
        generation: input.generation,
        phase: undefined,
      });
      taskId = execution.taskId;
      const now = nowIso();
      this.appendBlackboardInTransaction({
        taskId,
        kind: "blocker",
        producer: execution.phase === "review" ? "review" : "planexec",
        content: input.report,
      });
      this.database
        .prepare(
          `UPDATE execution_attempts SET status = 'failed', summary = ?,
             last_activity_at = ?, completed_at = ?, revision = revision + 1
           WHERE execution_id = ? AND generation = ?`,
        )
        .run(input.report.reason, now, now, execution.id, execution.generation);
      this.database
        .prepare(
          `UPDATE tasks SET status = 'blocked', summary = ?, current_execution_id = NULL,
             revision = revision + 1, updated_at = ? WHERE task_id = ?`,
        )
        .run(input.report.reason, now, execution.taskId);
      if (execution.goalId) {
        this.database
          .prepare(
            "UPDATE task_goals SET status = 'blocked', revision = revision + 1 WHERE goal_id = ?",
          )
          .run(execution.goalId);
      }
      this.appendEventInTransaction({
        aggregateType: "execution",
        aggregateId: execution.id,
        revision: execution.revision + 1,
        kind: "execution_blocked",
        payload: { taskId, goalId: execution.goalId },
      });
    });
    if (!taskId) {
      return false;
    }
    this.syncTaskLocator(this.getTask(taskId)!);
    this.emit([taskId], [input.executionId]);
    return true;
  }

  markExecutionAwaitingProvider(input: {
    executionId: string;
    generation: string;
  }): ExecutionProjection | null {
    const execution = this.getExecution(input.executionId);
    if (!execution) {
      return null;
    }
    if (execution.generation !== input.generation) {
      return null;
    }
    if (execution.status === "awaiting_provider") {
      return execution;
    }
    if (
      execution.status !== "starting" &&
      execution.status !== "running" &&
      execution.status !== "implementing"
    ) {
      return null;
    }
    return this.updateExecution({
      executionId: execution.id,
      generation: input.generation,
      expectedRevision: execution.revision,
      status: "awaiting_provider",
    });
  }

  interruptExecution(input: { executionId: string; generation: string; summary: string }): boolean {
    let taskId: string | null = null;
    this.transaction(() => {
      const execution = this.getExecution(input.executionId);
      if (
        !execution ||
        execution.generation !== input.generation ||
        ["canceled", "succeeded", "failed", "orphaned"].includes(execution.status)
      ) {
        return;
      }
      const task = this.getTask(execution.taskId);
      if (execution.status === "cancel_requested" || task?.status === "stopping") {
        return;
      }
      taskId = execution.taskId;
      const now = nowIso();
      this.database
        .prepare(
          `UPDATE execution_attempts SET status = 'failed', summary = ?,
             last_activity_at = ?, completed_at = ?, revision = revision + 1
           WHERE execution_id = ? AND generation = ?`,
        )
        .run(input.summary, now, now, execution.id, execution.generation);
      this.database
        .prepare(
          `UPDATE phase_runs SET status = 'interrupted', updated_at = ? WHERE phase_run_id = ?`,
        )
        .run(now, execution.phaseRunId);
      this.database
        .prepare(
          `UPDATE tasks SET status = 'interrupted', summary = ?, current_execution_id = NULL,
             revision = revision + 1, updated_at = ? WHERE task_id = ?`,
        )
        .run(input.summary, now, execution.taskId);
      if (execution.goalId) {
        this.database
          .prepare(
            `UPDATE task_goals SET status = 'interrupted', revision = revision + 1
             WHERE goal_id = ? AND status = 'running'`,
          )
          .run(execution.goalId);
      }
      this.appendEventInTransaction({
        aggregateType: "execution",
        aggregateId: execution.id,
        revision: execution.revision + 1,
        kind: "execution_interrupted",
        payload: { taskId, summary: input.summary },
      });
    });
    if (!taskId) {
      return false;
    }
    this.syncTaskLocator(this.getTask(taskId)!);
    this.emit([taskId], [input.executionId]);
    return true;
  }

  recordAttachment(input: {
    executionId: string;
    receipt: RuntimeAttachmentReceipt;
  }): RuntimeAttachmentProjection {
    const execution = this.getExecution(input.executionId);
    if (!execution) {
      throw new Error(`Execution ${input.executionId} does not exist`);
    }
    const projection: RuntimeAttachmentProjection = {
      id: input.receipt.id,
      bundleId: input.receipt.bundleId,
      bundleDigest: input.receipt.bundleDigest,
      status: "attached",
      attachedAt: input.receipt.attachedAt,
    };
    if (["planexec", "review"].includes(execution.phase) && projection.bundleId !== "thoth.loop") {
      throw new Error(`${execution.phase} requires a thoth.loop RuntimeBundle receipt`);
    }
    this.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO runtime_attachments(
             attachment_id, execution_id, adapter_id, provider_thread_id, bundle_id,
             bundle_digest, instruction_attachment, tool_attachment, status, attached_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'attached', ?)`,
        )
        .run(
          input.receipt.id,
          input.executionId,
          input.receipt.adapterId,
          input.receipt.threadId,
          input.receipt.bundleId,
          input.receipt.bundleDigest,
          input.receipt.instructionAttachment,
          input.receipt.toolAttachment,
          input.receipt.attachedAt,
        );
      this.appendEventInTransaction({
        aggregateType: "execution",
        aggregateId: input.executionId,
        revision: execution.revision,
        kind: "runtime_bundle_attached",
        payload: { bundleId: projection.bundleId, bundleDigest: projection.bundleDigest },
      });
    });
    this.emit([execution.taskId], [execution.id]);
    return projection;
  }

  appendBlackboard(input: {
    taskId: string;
    kind: TaskBlackboardEntry["kind"];
    producer: TaskBlackboardEntry["producer"];
    content: unknown;
  }): TaskBlackboardEntry {
    if (!this.getTask(input.taskId)) {
      throw new Error(`Task ${input.taskId} does not exist`);
    }
    let entry!: TaskBlackboardEntry;
    this.transaction(() => {
      entry = this.appendBlackboardInTransaction(input);
      this.appendEventInTransaction({
        aggregateType: "task",
        aggregateId: input.taskId,
        revision: this.getTask(input.taskId)!.revision,
        kind: "blackboard_appended",
        payload: { entryId: entry.id, kind: entry.kind, contentDigest: entry.contentDigest },
      });
    });
    this.emit([input.taskId], []);
    return entry;
  }

  listBlackboard(taskId: string): TaskBlackboardEntry[] {
    const rows = this.database
      .prepare("SELECT * FROM task_blackboard WHERE task_id = ? ORDER BY created_at ASC")
      .all(taskId) as Array<Record<string, unknown>>;
    return rows.map((row) =>
      TaskBlackboardEntrySchema.parse({
        id: String(row.entry_id),
        taskId: String(row.task_id),
        kind: row.kind,
        producer: row.producer,
        content: this.blobs.readJson(String(row.content_digest)),
        contentDigest: String(row.content_digest),
        createdAt: String(row.created_at),
      }),
    );
  }

  appendDecision(
    input: Omit<HumanDecisionRecord, "id" | "workspaceId" | "decidedAt">,
  ): HumanDecisionRecord {
    const decision = this.transaction(() => this.appendDecisionInTransaction(input));
    if (decision.taskId) {
      this.emit([decision.taskId], []);
    }
    return decision;
  }

  listDecisions(taskId: string): HumanDecisionRecord[] {
    const rows = this.database
      .prepare("SELECT * FROM human_decisions WHERE task_id = ? ORDER BY decided_at ASC")
      .all(taskId) as Array<Record<string, unknown>>;
    return rows.map((row) => this.toDecision(row));
  }

  getTaskContext(taskId: string, revision?: number): TaskContextEnvelope | null {
    const task = this.getTask(taskId);
    if (!task || (revision !== undefined && revision > task.revision)) {
      return null;
    }
    return TaskContextEnvelopeSchema.parse({
      reference: {
        kind: "task",
        workspaceId: this.workspaceId,
        taskId,
        revision: task.revision,
      },
      task,
      decisions: this.listDecisions(taskId),
      blackboard: this.listBlackboard(taskId),
      generatedAt: nowIso(),
    });
  }

  bindTaskContexts(input: {
    agentId: string;
    turnId: string;
    references: TaskContextReference[];
  }): TaskContextEnvelope[] {
    const contexts = input.references.map((reference) => {
      if (reference.workspaceId !== this.workspaceId) {
        throw new Error(`Task ${reference.taskId} belongs to another Workspace`);
      }
      const context = this.getTaskContext(reference.taskId);
      if (!context) {
        throw new Error(`Task ${reference.taskId} does not exist in Workspace ${this.workspaceId}`);
      }
      if (context.task.revision !== reference.revision) {
        throw new WorkspaceAuthorityConflictError(
          `Task ${reference.taskId} revision changed from ${reference.revision} to ${context.task.revision}`,
        );
      }
      return context;
    });
    this.transaction(() => {
      const turn = this.getForegroundTurnInTransaction(input.turnId);
      if (!turn || turn.agentId !== input.agentId) {
        throw new WorkspaceAuthorityConflictError(
          `Foreground turn ${input.turnId} no longer belongs to Agent ${input.agentId}`,
        );
      }
      const insert = this.database.prepare(
        `INSERT OR IGNORE INTO context_bindings(
           binding_id, agent_id, turn_id, task_id, task_revision, context_digest, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const context of contexts) {
        const snapshot = this.blobs.putJson(context);
        insert.run(
          `context-binding-${randomUUID()}`,
          input.agentId,
          input.turnId,
          context.task.id,
          context.task.revision,
          snapshot.digest,
          nowIso(),
        );
      }
    });
    return contexts;
  }

  listTurnTaskContexts(turnId: string): TaskContextEnvelope[] {
    const rows = this.database
      .prepare(
        `SELECT task_id, task_revision, context_digest FROM context_bindings
         WHERE turn_id = ? ORDER BY created_at ASC`,
      )
      .all(turnId) as Array<{
      task_id: string;
      task_revision: number;
      context_digest: string | null;
    }>;
    return rows.map((row) => {
      if (!row.context_digest) {
        throw new Error(
          `Bound Task context ${row.task_id}@${row.task_revision} has no frozen snapshot`,
        );
      }
      return TaskContextEnvelopeSchema.parse(this.blobs.readJson(row.context_digest));
    });
  }

  listLatestTurnTaskContexts(turnId: string): TaskContextEnvelope[] {
    const rows = this.database
      .prepare(
        `SELECT task_id FROM context_bindings
         WHERE turn_id = ? ORDER BY created_at ASC`,
      )
      .all(turnId) as Array<{ task_id: string }>;
    return rows.map((row) => {
      const context = this.getTaskContext(row.task_id);
      if (!context) {
        throw new Error(`Bound Task ${row.task_id} is no longer available`);
      }
      return context;
    });
  }

  requestStop(input: {
    taskId: string;
    expectedRevision: number;
    commandId: string;
    actorId: string;
    clientId: string;
    deviceId?: string | null;
  }): {
    task: TaskProjection;
    execution: ExecutionProjection | null;
    duplicate: boolean;
  } {
    let result!: {
      task: TaskProjection;
      execution: ExecutionProjection | null;
      duplicate: boolean;
    };
    this.transaction(() => {
      const duplicate = this.database
        .prepare("SELECT result_json FROM authority_commands WHERE command_id = ?")
        .get(input.commandId) as { result_json: string } | undefined;
      if (duplicate) {
        const stored = JSON.parse(duplicate.result_json) as {
          taskId: string;
          executionId: string | null;
        };
        const task = this.getTask(stored.taskId);
        if (!task) {
          throw new Error(`Recorded task ${stored.taskId} is missing`);
        }
        result = {
          task,
          execution: stored.executionId ? this.getExecution(stored.executionId) : null,
          duplicate: true,
        };
        return;
      }
      const task = this.getTask(input.taskId);
      if (!task) {
        throw new Error(`Task ${input.taskId} does not exist`);
      }
      if (task.revision !== input.expectedRevision) {
        throw new WorkspaceAuthorityConflictError(
          `Task ${input.taskId} revision changed from ${input.expectedRevision} to ${task.revision}`,
        );
      }
      if (["completed", "stopped"].includes(task.status)) {
        throw new Error(`Cannot stop a ${task.status} task`);
      }
      const nextRevision = task.revision + 1;
      const now = nowIso();
      this.database
        .prepare(
          `UPDATE tasks SET status = 'stopping', pending_control = 'stop',
             summary = ?, revision = ?, updated_at = ?
           WHERE task_id = ? AND revision = ?`,
        )
        .run("Stopping the active execution.", nextRevision, now, task.id, task.revision);
      let execution = task.currentExecutionId ? this.getExecution(task.currentExecutionId) : null;
      if (
        execution &&
        [
          "created",
          "starting",
          "planning",
          "awaiting_implementation",
          "implementing",
          "running",
          "awaiting_provider",
          "awaiting_user",
        ].includes(execution.status)
      ) {
        this.cancelPendingExecutionApprovalsInTransaction(execution.id, now);
        this.database
          .prepare(
            `UPDATE execution_attempts SET status = 'cancel_requested', revision = revision + 1,
               last_activity_at = ?, summary = ? WHERE execution_id = ?`,
          )
          .run(now, "Cancellation requested by the user.", execution.id);
        execution = this.getExecution(execution.id);
      }
      this.appendDecisionInTransaction({
        taskId: task.id,
        turnId: null,
        cardId: null,
        kind: "task_stop",
        displayed: { command: "stop", taskId: task.id, taskTitle: task.title },
        rawAnswer: { command: "stop" },
        normalized: { controlIntent: "stop" },
        actorId: input.actorId,
        clientId: input.clientId,
        deviceId: input.deviceId ?? null,
        commandId: input.commandId,
        expectedRevision: input.expectedRevision,
        resultRevision: nextRevision,
        supersedesDecisionId: null,
        fidelity: "exact",
      });
      this.appendEventInTransaction({
        aggregateType: "task",
        aggregateId: task.id,
        revision: nextRevision,
        kind: "task_stop_requested",
        payload: { executionId: execution?.id ?? null },
        causationId: input.commandId,
      });
      this.database
        .prepare(
          `INSERT INTO authority_commands(
             command_id, aggregate_type, aggregate_id, command_kind,
             result_revision, result_json, created_at
           ) VALUES (?, 'task', ?, 'stop', ?, ?, ?)`,
        )
        .run(
          input.commandId,
          task.id,
          nextRevision,
          JSON.stringify({ taskId: task.id, executionId: execution?.id ?? null }),
          now,
        );
      result = { task: this.getTask(task.id)!, execution, duplicate: false };
    });
    this.emit([input.taskId], result.execution ? [result.execution.id] : []);
    this.syncTaskLocator(result.task);
    return result;
  }

  requestCommand(input: {
    taskId: string;
    command: TaskCommand;
    expectedRevision: number;
    commandId: string;
    actorId: string;
    clientId: string;
    deviceId?: string | null;
  }): {
    task: TaskProjection;
    execution: ExecutionProjection | null;
    duplicate: boolean;
  } {
    if (input.command === "stop") {
      return this.requestStop(input);
    }

    let result!: {
      task: TaskProjection;
      execution: ExecutionProjection | null;
      duplicate: boolean;
    };
    this.transaction(() => {
      const duplicate = this.database
        .prepare("SELECT result_json FROM authority_commands WHERE command_id = ?")
        .get(input.commandId) as { result_json: string } | undefined;
      if (duplicate) {
        const stored = JSON.parse(duplicate.result_json) as {
          taskId: string;
          executionId: string | null;
        };
        const task = this.getTask(stored.taskId);
        if (!task) {
          throw new Error(`Recorded task ${stored.taskId} is missing`);
        }
        result = {
          task,
          execution: stored.executionId ? this.getExecution(stored.executionId) : null,
          duplicate: true,
        };
        return;
      }

      const task = this.getTask(input.taskId);
      if (!task) {
        throw new Error(`Task ${input.taskId} does not exist`);
      }
      if (task.revision !== input.expectedRevision) {
        throw new WorkspaceAuthorityConflictError(
          `Task ${input.taskId} revision changed from ${input.expectedRevision} to ${task.revision}`,
        );
      }
      if (["stopping", "stopped"].includes(task.status)) {
        throw new Error(`Cannot ${input.command} a ${task.status} task`);
      }

      const execution = task.currentExecutionId ? this.getExecution(task.currentExecutionId) : null;
      const hasActiveExecution =
        execution !== null &&
        [
          "created",
          "starting",
          "planning",
          "awaiting_implementation",
          "implementing",
          "running",
          "awaiting_provider",
          "awaiting_user",
        ].includes(execution.status);
      let status = task.status;
      let summary = task.summary;
      let pendingControl: TaskCommand | null = null;
      let budgetStrength = task.budget.strength;
      let maxFailedReviews = task.budget.maxFailedReviews;
      switch (input.command) {
        case "pause":
          if (task.status === "completed") {
            throw new Error("Cannot pause a completed task");
          }
          status = hasActiveExecution ? task.status : "paused";
          pendingControl = hasActiveExecution ? "pause" : null;
          summary = hasActiveExecution
            ? "Pause requested; the task will pause at the current phase boundary."
            : "Paused by the user.";
          break;
        case "resume":
          if (!["paused", "interrupted", "budget_wait"].includes(task.status)) {
            throw new Error(`Cannot resume a ${task.status} task`);
          }
          status = "queued";
          pendingControl = null;
          summary = "Resume requested; the task is queued for execution.";
          break;
        case "raise_budget":
          if (task.status === "completed") {
            throw new Error("Cannot raise the budget of a completed task");
          }
          const raised = nextTaskStrength(task.budget.strength);
          if (!raised) {
            throw new Error("The task already has the maximum Review budget");
          }
          budgetStrength = raised.strength;
          maxFailedReviews = raised.maxFailedReviews;
          status = task.status === "budget_wait" ? "queued" : task.status;
          summary = "A budget extension was approved by the user.";
          break;
        case "review_only":
          status = "queued";
          pendingControl = "review_only";
          summary = "An independent Review was requested by the user.";
          break;
      }

      const now = nowIso();
      const nextRevision = task.revision + 1;
      const update = this.database
        .prepare(
          `UPDATE tasks SET status = ?, summary = ?, pending_control = ?,
             budget_strength = ?, max_failed_reviews = ?, revision = ?, updated_at = ?
           WHERE task_id = ? AND revision = ?`,
        )
        .run(
          status,
          summary,
          pendingControl,
          budgetStrength,
          maxFailedReviews,
          nextRevision,
          now,
          task.id,
          task.revision,
        );
      if (update.changes !== 1) {
        throw new WorkspaceAuthorityConflictError("Task revision changed while applying command");
      }
      this.appendDecisionInTransaction({
        taskId: task.id,
        turnId: null,
        cardId: null,
        kind: `task_${input.command}`,
        displayed: { command: input.command, taskId: task.id, taskTitle: task.title },
        rawAnswer: { command: input.command },
        normalized: { controlIntent: input.command },
        actorId: input.actorId,
        clientId: input.clientId,
        deviceId: input.deviceId ?? null,
        commandId: input.commandId,
        expectedRevision: input.expectedRevision,
        resultRevision: nextRevision,
        supersedesDecisionId: null,
        fidelity: "exact",
      });
      this.appendEventInTransaction({
        aggregateType: "task",
        aggregateId: task.id,
        revision: nextRevision,
        kind: `task_${input.command}_requested`,
        payload: { executionId: execution?.id ?? null, deferred: hasActiveExecution },
        causationId: input.commandId,
      });
      this.database
        .prepare(
          `INSERT INTO authority_commands(
             command_id, aggregate_type, aggregate_id, command_kind,
             result_revision, result_json, created_at
           ) VALUES (?, 'task', ?, ?, ?, ?, ?)`,
        )
        .run(
          input.commandId,
          task.id,
          input.command,
          nextRevision,
          JSON.stringify({ taskId: task.id, executionId: execution?.id ?? null }),
          now,
        );
      result = { task: this.getTask(task.id)!, execution, duplicate: false };
    });
    this.emit([input.taskId], result.execution ? [result.execution.id] : []);
    this.syncTaskLocator(result.task);
    return result;
  }

  answerTaskDecision(input: {
    taskId: string;
    decisionId: string;
    optionId: string;
    note?: string;
    expectedRevision: number;
    commandId: string;
    actorId: string;
    clientId: string;
    deviceId?: string | null;
  }): { task: TaskProjection; decision: HumanDecisionRecord; duplicate: boolean } {
    let result!: { task: TaskProjection; decision: HumanDecisionRecord; duplicate: boolean };
    this.transaction(() => {
      const duplicate = this.database
        .prepare(
          `SELECT aggregate_id, command_kind, result_json FROM authority_commands
           WHERE command_id = ?`,
        )
        .get(input.commandId) as
        | { aggregate_id: string; command_kind: string; result_json: string }
        | undefined;
      if (duplicate) {
        if (
          duplicate.aggregate_id !== input.taskId ||
          duplicate.command_kind !== "answer_user_decision"
        ) {
          throw new WorkspaceAuthorityConflictError(
            `Command ${input.commandId} already belongs to another authority action`,
          );
        }
        const stored = JSON.parse(duplicate.result_json) as {
          taskId: string;
          decisionRecordId: string;
        };
        const task = this.getTask(stored.taskId);
        const decisionRow = this.database
          .prepare("SELECT * FROM human_decisions WHERE decision_id = ?")
          .get(stored.decisionRecordId) as Record<string, unknown> | undefined;
        if (!task || !decisionRow) {
          throw new Error(`Recorded decision result for ${input.commandId} is incomplete`);
        }
        result = { task, decision: this.toDecision(decisionRow), duplicate: true };
        return;
      }

      const task = this.getTask(input.taskId);
      if (!task) {
        throw new Error(`Task ${input.taskId} does not exist`);
      }
      if (task.revision !== input.expectedRevision) {
        throw new WorkspaceAuthorityConflictError(
          `Task ${input.taskId} revision changed from ${input.expectedRevision} to ${task.revision}`,
        );
      }
      if (task.status !== "awaiting_user" || !task.currentGoalId) {
        throw new Error(`Task ${input.taskId} is not awaiting a user decision`);
      }
      const pending = this.getPendingTaskDecision(task.id);
      if (!pending || pending.id !== input.decisionId) {
        throw new WorkspaceAuthorityConflictError(
          `Task decision ${input.decisionId} is no longer pending`,
        );
      }
      const selected = pending.options.find((option) => option.id === input.optionId);
      if (!selected) {
        throw new Error(`Decision option ${input.optionId} does not belong to ${pending.id}`);
      }

      const nextRevision = task.revision + 1;
      const normalized = {
        decisionId: pending.id,
        option: selected,
        note: input.note?.trim() || null,
      };
      const decision = this.appendDecisionInTransaction({
        taskId: task.id,
        turnId: null,
        cardId: null,
        kind: "task_user_decision",
        displayed: pending,
        rawAnswer: { optionId: input.optionId, note: input.note ?? null },
        normalized,
        actorId: input.actorId,
        clientId: input.clientId,
        deviceId: input.deviceId ?? null,
        commandId: input.commandId,
        expectedRevision: input.expectedRevision,
        resultRevision: nextRevision,
        supersedesDecisionId: null,
        fidelity: "exact",
      });
      const now = nowIso();
      this.database
        .prepare(
          `UPDATE task_decision_requests SET status = 'answered', answer_decision_id = ?,
             answered_at = ? WHERE decision_id = ? AND task_id = ? AND status = 'pending'`,
        )
        .run(decision.id, now, pending.id, task.id);
      this.database
        .prepare(
          `UPDATE task_goals SET status = 'queued', revision = revision + 1
           WHERE goal_id = ? AND task_id = ? AND status = 'awaiting_user'`,
        )
        .run(task.currentGoalId, task.id);
      const update = this.database
        .prepare(
          `UPDATE tasks SET status = 'queued', summary = ?, pending_control = NULL,
             revision = ?, updated_at = ? WHERE task_id = ? AND revision = ?`,
        )
        .run(`User selected: ${selected.label}`, nextRevision, now, task.id, task.revision);
      if (update.changes !== 1) {
        throw new WorkspaceAuthorityConflictError("Task changed while recording the user decision");
      }
      this.appendBlackboardInTransaction({
        taskId: task.id,
        kind: "human_decision",
        producer: "user",
        content: normalized,
      });
      this.appendEventInTransaction({
        aggregateType: "task",
        aggregateId: task.id,
        revision: nextRevision,
        kind: "task_user_decision_answered",
        payload: { decisionId: pending.id, optionId: selected.id },
        causationId: input.commandId,
      });
      this.database
        .prepare(
          `INSERT INTO authority_commands(
             command_id, aggregate_type, aggregate_id, command_kind,
             result_revision, result_json, created_at
           ) VALUES (?, 'task', ?, 'answer_user_decision', ?, ?, ?)`,
        )
        .run(
          input.commandId,
          task.id,
          nextRevision,
          JSON.stringify({ taskId: task.id, decisionRecordId: decision.id }),
          now,
        );
      result = { task: this.getTask(task.id)!, decision, duplicate: false };
    });
    this.emit([input.taskId], []);
    this.syncTaskLocator(result.task);
    return result;
  }

  recordProviderPermissionDecision(input: {
    agentId: string;
    providerThreadId?: string | null;
    requestId: string;
    displayed: unknown;
    rawAnswer: unknown;
    actorId: string;
    clientId: string;
    deviceId?: string | null;
  }): { decision: HumanDecisionRecord; task: TaskProjection | null; duplicate: boolean } {
    const commandId = `provider-permission:${input.agentId}:${input.requestId}`;
    let result!: { decision: HumanDecisionRecord; task: TaskProjection | null; duplicate: boolean };
    this.transaction(() => {
      const existing = this.database
        .prepare("SELECT * FROM human_decisions WHERE command_id = ?")
        .get(commandId) as Record<string, unknown> | undefined;
      if (existing) {
        const decision = this.toDecision(existing);
        result = {
          decision,
          task: decision.taskId ? this.getTask(decision.taskId) : null,
          duplicate: true,
        };
        return;
      }

      const executionRow = input.providerThreadId
        ? (this.database
            .prepare(
              `SELECT task_id FROM execution_attempts
               WHERE provider_thread_id = ?
               ORDER BY CASE status
                 WHEN 'awaiting_provider' THEN 0
                 WHEN 'running' THEN 1
                 WHEN 'starting' THEN 2
                 ELSE 3
               END, COALESCE(last_activity_at, started_at, '') DESC
               LIMIT 1`,
            )
            .get(input.providerThreadId) as { task_id: string } | undefined)
        : undefined;
      const task = executionRow ? this.getTask(executionRow.task_id) : null;
      const foregroundTurn = this.getActiveForegroundTurn(input.agentId);
      const foregroundAgent = this.getForegroundAgentRow(input.agentId);
      if (!task && !foregroundAgent) {
        throw new Error(`Agent ${input.agentId} has no Workspace decision authority`);
      }
      const expectedRevision = task?.revision ?? foregroundAgent!.authority_revision;
      const resultRevision = expectedRevision + 1;
      const normalized = {
        requestId: input.requestId,
        response: input.rawAnswer,
      };
      const decision = this.appendDecisionInTransaction({
        taskId: task?.id ?? null,
        turnId: foregroundTurn?.id ?? null,
        cardId: null,
        kind: "provider_permission",
        displayed: input.displayed,
        rawAnswer: input.rawAnswer,
        normalized,
        actorId: input.actorId,
        clientId: input.clientId,
        deviceId: input.deviceId ?? null,
        commandId,
        expectedRevision,
        resultRevision,
        supersedesDecisionId: null,
        fidelity: "exact",
      });
      const now = nowIso();
      if (task) {
        const updated = this.database
          .prepare(
            "UPDATE tasks SET revision = ?, updated_at = ? WHERE task_id = ? AND revision = ?",
          )
          .run(resultRevision, now, task.id, expectedRevision);
        if (updated.changes !== 1) {
          throw new WorkspaceAuthorityConflictError(
            `Task ${task.id} changed while recording provider permission`,
          );
        }
        this.appendBlackboardInTransaction({
          taskId: task.id,
          kind: "human_decision",
          producer: "user",
          content: normalized,
        });
        this.appendEventInTransaction({
          aggregateType: "task",
          aggregateId: task.id,
          revision: resultRevision,
          kind: "provider_permission_decided",
          payload: { requestId: input.requestId },
          causationId: commandId,
        });
      } else {
        const updated = this.database
          .prepare(
            `UPDATE agents SET authority_revision = ?, updated_at = ?
             WHERE agent_id = ? AND authority_revision = ?`,
          )
          .run(resultRevision, now, input.agentId, expectedRevision);
        if (updated.changes !== 1) {
          throw new WorkspaceAuthorityConflictError(
            `Agent ${input.agentId} changed while recording provider permission`,
          );
        }
      }
      this.database
        .prepare(
          `INSERT INTO authority_commands(
             command_id, aggregate_type, aggregate_id, command_kind,
             result_revision, result_json, created_at
           ) VALUES (?, ?, ?, 'provider_permission', ?, ?, ?)`,
        )
        .run(
          commandId,
          task ? "task" : "agent",
          task?.id ?? input.agentId,
          resultRevision,
          JSON.stringify({ decisionId: decision.id }),
          now,
        );
      result = {
        decision,
        task: task ? this.getTask(task.id) : null,
        duplicate: false,
      };
    });
    if (result.task) {
      this.emit([result.task.id], []);
      this.syncTaskLocator(result.task);
    }
    return result;
  }

  settleStop(input: {
    taskId: string;
    executionId: string | null;
    generation?: string;
    orphaned?: boolean;
  }): { task: TaskProjection; execution: ExecutionProjection | null } {
    let result!: { task: TaskProjection; execution: ExecutionProjection | null };
    this.transaction(() => {
      const task = this.getTask(input.taskId);
      if (!task || task.status !== "stopping") {
        throw new WorkspaceAuthorityConflictError("Task is no longer stopping");
      }
      let execution = input.executionId ? this.getExecution(input.executionId) : null;
      if (execution) {
        if (input.generation && execution.generation !== input.generation) {
          throw new WorkspaceAuthorityConflictError("Execution generation changed during Stop");
        }
        if (execution.status === "cancel_requested") {
          const status: ExecutionLifecycle = input.orphaned ? "orphaned" : "canceled";
          const now = nowIso();
          this.database
            .prepare(
              `UPDATE execution_attempts SET status = ?, revision = revision + 1,
                 last_activity_at = ?, completed_at = ?, summary = ? WHERE execution_id = ?`,
            )
            .run(
              status,
              now,
              now,
              input.orphaned
                ? "Provider interruption could not be confirmed; execution is quarantined."
                : "Execution canceled by the user.",
              execution.id,
            );
          execution = this.getExecution(execution.id);
        }
      }
      const nextRevision = task.revision + 1;
      this.database
        .prepare(
          `UPDATE tasks SET status = 'stopped', pending_control = NULL,
             summary = ?, revision = ?, updated_at = ?
           WHERE task_id = ? AND revision = ?`,
        )
        .run(
          input.orphaned
            ? "Stopped; an orphaned provider execution remains quarantined."
            : "Stopped by the user.",
          nextRevision,
          nowIso(),
          task.id,
          task.revision,
        );
      if (input.orphaned && execution) {
        this.database
          .prepare(
            `INSERT INTO workspace_leases(
               lease_key, task_id, execution_id, status, generation, expires_at, updated_at
             ) VALUES ('mutation', ?, ?, 'cancel_quarantine', ?, NULL, ?)
             ON CONFLICT(lease_key) DO UPDATE SET
               task_id = excluded.task_id,
               execution_id = excluded.execution_id,
               status = excluded.status,
               generation = excluded.generation,
               expires_at = NULL,
               updated_at = excluded.updated_at`,
          )
          .run(task.id, execution.id, execution.generation, nowIso());
      } else {
        this.database.prepare("DELETE FROM workspace_leases WHERE task_id = ?").run(task.id);
      }
      this.appendEventInTransaction({
        aggregateType: "task",
        aggregateId: task.id,
        revision: nextRevision,
        kind: input.orphaned ? "task_stopped_with_orphan" : "task_stopped",
        payload: { executionId: execution?.id ?? null },
      });
      result = { task: this.getTask(task.id)!, execution };
    });
    this.emit([input.taskId], input.executionId ? [input.executionId] : []);
    this.syncTaskLocator(result.task);
    return result;
  }

  appendTimeline(input: { executionId: string; occurredAt?: string; item: unknown }): number {
    const itemJson = JSON.stringify(input.item);
    const external = Buffer.byteLength(itemJson, "utf8") > 64 * 1024;
    const itemDigest = external ? this.blobs.put(itemJson).digest : null;
    const row = this.database
      .prepare(
        "SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM timeline_entries WHERE execution_id = ?",
      )
      .get(input.executionId) as { next_seq: number };
    this.database
      .prepare(
        `INSERT INTO timeline_entries(execution_id, seq, occurred_at, item_json, item_digest)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        input.executionId,
        row.next_seq,
        input.occurredAt ?? nowIso(),
        external ? null : itemJson,
        itemDigest,
      );
    return row.next_seq;
  }

  readTimeline(input: {
    executionId: string;
    beforeSeq?: number;
    limit: number;
  }): Array<{ seq: number; occurredAt: string; item: unknown }> {
    const rows = this.database
      .prepare(
        `SELECT seq, occurred_at, item_json, item_digest FROM timeline_entries
         WHERE execution_id = ? AND (? IS NULL OR seq < ?)
         ORDER BY seq DESC LIMIT ?`,
      )
      .all(
        input.executionId,
        input.beforeSeq ?? null,
        input.beforeSeq ?? null,
        input.limit,
      ) as Array<{
      seq: number;
      occurred_at: string;
      item_json: string | null;
      item_digest: string | null;
    }>;
    return rows.toReversed().map((row) => ({
      seq: row.seq,
      occurredAt: row.occurred_at,
      item: JSON.parse(
        row.item_json ?? this.blobs.read(row.item_digest!).toString("utf8"),
      ) as unknown,
    }));
  }

  claimMutationLease(input: {
    taskId: string;
    executionId: string;
    generation: string;
    ttlMs: number;
  }): boolean {
    let claimed = false;
    this.transaction(() => {
      const current = this.database
        .prepare("SELECT * FROM workspace_leases WHERE lease_key = 'mutation'")
        .get() as Record<string, unknown> | undefined;
      if (current?.status === "cancel_quarantine") {
        return;
      }
      const expiresAt = typeof current?.expires_at === "string" ? current.expires_at : null;
      if (
        current &&
        current.task_id !== input.taskId &&
        expiresAt &&
        Date.parse(expiresAt) > Date.now()
      ) {
        return;
      }
      const now = nowIso();
      this.database
        .prepare(
          `INSERT INTO workspace_leases(
             lease_key, task_id, execution_id, status, generation, expires_at, updated_at
           ) VALUES ('mutation', ?, ?, 'active', ?, ?, ?)
           ON CONFLICT(lease_key) DO UPDATE SET
             task_id = excluded.task_id,
             execution_id = excluded.execution_id,
             status = 'active',
             generation = excluded.generation,
             expires_at = excluded.expires_at,
             updated_at = excluded.updated_at`,
        )
        .run(
          input.taskId,
          input.executionId,
          input.generation,
          new Date(Date.now() + input.ttlMs).toISOString(),
          now,
        );
      this.appendEventInTransaction({
        aggregateType: "lease",
        aggregateId: this.workspaceId,
        revision: 1,
        kind: "workspace_mutation_lease_claimed",
        payload: {
          taskId: input.taskId,
          executionId: input.executionId,
          generation: input.generation,
        },
      });
      claimed = true;
    });
    if (claimed) {
      this.emit([input.taskId], [input.executionId]);
    }
    return claimed;
  }

  renewMutationLease(input: {
    taskId: string;
    executionId: string;
    generation: string;
    ttlMs: number;
  }): boolean {
    const result = this.database
      .prepare(
        `UPDATE workspace_leases SET expires_at = ?, updated_at = ?
         WHERE lease_key = 'mutation' AND task_id = ? AND execution_id = ?
           AND generation = ? AND status = 'active'`,
      )
      .run(
        new Date(Date.now() + input.ttlMs).toISOString(),
        nowIso(),
        input.taskId,
        input.executionId,
        input.generation,
      );
    return result.changes === 1;
  }

  releaseMutationLease(input: {
    taskId: string;
    executionId: string;
    generation: string;
  }): boolean {
    const result = this.database
      .prepare(
        `DELETE FROM workspace_leases WHERE lease_key = 'mutation' AND task_id = ?
         AND execution_id = ? AND generation = ? AND status = 'active'`,
      )
      .run(input.taskId, input.executionId, input.generation);
    return result.changes === 1;
  }

  hasMutationQuarantine(): boolean {
    const row = this.database
      .prepare("SELECT status FROM workspace_leases WHERE lease_key = 'mutation'")
      .get() as { status: string } | undefined;
    return row?.status === "cancel_quarantine";
  }

  recoverInterruptedExecutionsAfterRestart(): string[] {
    const changedTaskIds: string[] = [];
    const changedExecutionIds: string[] = [];
    this.transaction(() => {
      const rows = this.database
        .prepare(
          `SELECT * FROM execution_attempts
           WHERE status IN (
             'created', 'starting', 'planning', 'awaiting_implementation', 'implementing',
             'running', 'awaiting_provider', 'awaiting_user', 'cancel_requested'
           )`,
        )
        .all() as ExecutionRow[];
      const now = nowIso();
      for (const row of rows) {
        const task = this.getTask(row.task_id);
        if (!task) {
          continue;
        }
        const stopping = task.status === "stopping" || row.status === "cancel_requested";
        const executionStatus = stopping ? "orphaned" : "failed";
        const taskStatus = stopping ? "stopped" : "interrupted";
        const summary = stopping
          ? "Daemon restarted before provider cancellation could be confirmed."
          : row.status === "awaiting_implementation" || row.status === "awaiting_user"
            ? "Daemon restarted while a provider approval callback was pending; this phase must be rerun."
            : "Daemon restarted while the provider execution was active.";
        this.cancelPendingExecutionApprovalsInTransaction(row.execution_id, now);
        this.database
          .prepare(
            `UPDATE execution_attempts SET status = ?, summary = ?, last_activity_at = ?,
               completed_at = ?, revision = revision + 1 WHERE execution_id = ?`,
          )
          .run(executionStatus, summary, now, now, row.execution_id);
        this.database
          .prepare(
            `UPDATE tasks SET status = ?, summary = ?, current_execution_id = NULL,
               pending_control = NULL, revision = revision + 1, updated_at = ? WHERE task_id = ?`,
          )
          .run(taskStatus, summary, now, task.id);
        if (row.goal_id) {
          this.database
            .prepare(`UPDATE task_goals SET status = ?, revision = revision + 1 WHERE goal_id = ?`)
            .run(stopping ? "stopped" : "interrupted", row.goal_id);
        }
        if (stopping) {
          this.database
            .prepare(
              `INSERT INTO workspace_leases(
                 lease_key, task_id, execution_id, status, generation, expires_at, updated_at
               ) VALUES ('mutation', ?, ?, 'cancel_quarantine', ?, NULL, ?)
               ON CONFLICT(lease_key) DO UPDATE SET
                 task_id = excluded.task_id,
                 execution_id = excluded.execution_id,
                 status = excluded.status,
                 generation = excluded.generation,
                 expires_at = NULL,
                 updated_at = excluded.updated_at`,
            )
            .run(task.id, row.execution_id, row.generation, now);
        }
        this.appendEventInTransaction({
          aggregateType: "execution",
          aggregateId: row.execution_id,
          revision: row.revision + 1,
          kind: stopping ? "execution_restart_orphaned" : "execution_restart_interrupted",
          payload: { taskId: task.id },
        });
        changedTaskIds.push(task.id);
        changedExecutionIds.push(row.execution_id);
      }
      if (rows.length > 0 && !rows.some((row) => row.status === "cancel_requested")) {
        this.database.prepare("DELETE FROM workspace_leases WHERE status = 'active'").run();
      }
    });
    for (const taskId of changedTaskIds) {
      const task = this.getTask(taskId);
      if (task) {
        this.syncTaskLocator(task);
      }
    }
    if (changedTaskIds.length > 0) {
      this.emit(changedTaskIds, changedExecutionIds);
    }
    return changedTaskIds;
  }

  upsertAgentRecord(record: StoredAgentRecord): void {
    if (record.workspaceId !== this.workspaceId) {
      throw new Error(`Agent ${record.id} does not belong to Workspace ${this.workspaceId}`);
    }
    this.transaction(() => {
      const existing = this.database
        .prepare("SELECT provider_thread_id FROM agents WHERE agent_id = ?")
        .get(record.id) as { provider_thread_id: string | null } | undefined;
      const providerThreadId = record.persistence
        ? (existing?.provider_thread_id ?? `provider-thread-visible-${record.id}`)
        : (existing?.provider_thread_id ?? null);
      if (record.persistence && providerThreadId) {
        this.database
          .prepare(
            `INSERT INTO provider_threads(
               thread_id, adapter_id, native_handle, persistence_json,
               lineage_parent_id, status, created_at, updated_at
             ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)
             ON CONFLICT(thread_id) DO UPDATE SET
               adapter_id = excluded.adapter_id,
               native_handle = excluded.native_handle,
               persistence_json = excluded.persistence_json,
               status = excluded.status,
               updated_at = excluded.updated_at`,
          )
          .run(
            providerThreadId,
            record.provider,
            record.persistence.nativeHandle ?? record.persistence.sessionId,
            JSON.stringify(record.persistence),
            record.archivedAt ? "archived" : "active",
            record.createdAt,
            record.updatedAt,
          );
      }
      this.database
        .prepare(
          `INSERT INTO agents(
             agent_id, provider_thread_id, title, visible, authority_revision,
             active_turn_id, thoth_lifecycle, background_task_id, error,
             created_at, updated_at
           ) VALUES (?, ?, ?, ?, 0, NULL, 'idle', NULL, NULL, ?, ?)
           ON CONFLICT(agent_id) DO UPDATE SET
             provider_thread_id = COALESCE(excluded.provider_thread_id, agents.provider_thread_id),
             title = excluded.title,
             visible = excluded.visible,
             updated_at = excluded.updated_at`,
        )
        .run(
          record.id,
          providerThreadId,
          record.title ?? null,
          record.internal === true ? 0 : 1,
          record.createdAt,
          record.updatedAt,
        );
      this.database
        .prepare(
          `UPDATE agents SET
             provider = ?, cwd = ?, last_activity_at = ?, last_user_message_at = ?,
             labels_json = ?, last_status = ?, last_mode_id = ?, config_json = ?,
             runtime_info_json = ?, features_json = ?, persistence_json = ?,
             last_error = ?, requires_attention = ?, attention_reason = ?,
             attention_timestamp = ?, internal = ?, archived_at = ?
           WHERE agent_id = ?`,
        )
        .run(
          record.provider,
          record.cwd,
          record.lastActivityAt ?? null,
          record.lastUserMessageAt ?? null,
          JSON.stringify(record.labels ?? {}),
          record.lastStatus,
          record.lastModeId ?? null,
          record.config === undefined ? null : JSON.stringify(record.config),
          record.runtimeInfo === undefined ? null : JSON.stringify(record.runtimeInfo),
          record.features === undefined ? null : JSON.stringify(record.features),
          record.persistence === undefined ? null : JSON.stringify(record.persistence),
          record.lastError ?? null,
          record.requiresAttention === true ? 1 : 0,
          record.attentionReason ?? null,
          record.attentionTimestamp ?? null,
          record.internal === true ? 1 : 0,
          record.archivedAt ?? null,
          record.id,
        );
    });
    this.catalog.updateAgentLocator({
      agentId: record.id,
      workspaceId: this.workspaceId,
      updatedAt: record.updatedAt,
    });
  }

  getAgentRecord(agentId: string): StoredAgentRecord | null {
    const row = this.database
      .prepare("SELECT * FROM agents WHERE agent_id = ? AND provider IS NOT NULL")
      .get(agentId) as Record<string, unknown> | undefined;
    return row ? this.toAgentRecord(row) : null;
  }

  listAgentRecords(): StoredAgentRecord[] {
    const rows = this.database
      .prepare("SELECT * FROM agents WHERE provider IS NOT NULL ORDER BY updated_at DESC")
      .all() as Array<Record<string, unknown>>;
    return rows.map((row) => this.toAgentRecord(row));
  }

  removeAgentRecord(agentId: string): void {
    this.transaction(() => {
      this.database.prepare("DELETE FROM agent_timeline_rows WHERE agent_id = ?").run(agentId);
      this.database.prepare("DELETE FROM agent_timeline_meta WHERE agent_id = ?").run(agentId);
      this.database.prepare("DELETE FROM agents WHERE agent_id = ?").run(agentId);
    });
    this.catalog.removeAgentLocator(agentId);
  }

  getAgentTimelineMeta(agentId: string): { epoch: string; nextSeq: number } | null {
    const row = this.database
      .prepare("SELECT epoch, next_seq FROM agent_timeline_meta WHERE agent_id = ?")
      .get(agentId) as { epoch: string; next_seq: number } | undefined;
    return row ? { epoch: row.epoch, nextSeq: row.next_seq } : null;
  }

  listAgentTimelineRows(agentId: string): AgentTimelineRow[] {
    const rows = this.database
      .prepare(
        `SELECT seq, timestamp, item_json, item_digest FROM agent_timeline_rows
         WHERE agent_id = ? ORDER BY seq ASC`,
      )
      .all(agentId) as Array<{
      seq: number;
      timestamp: string;
      item_json: string | null;
      item_digest: string | null;
    }>;
    return rows.map((row) => ({
      seq: row.seq,
      timestamp: row.timestamp,
      item: (row.item_digest
        ? this.blobs.readJson(row.item_digest)
        : JSON.parse(row.item_json ?? "null")) as AgentTimelineItem,
    }));
  }

  appendAgentTimelineRows(agentId: string, rows: readonly AgentTimelineRow[]): void {
    if (rows.length === 0) {
      return;
    }
    this.transaction(() => {
      if (!this.getAgentRecord(agentId)) {
        throw new Error(`Agent ${agentId} is not registered in Workspace ${this.workspaceId}`);
      }
      this.database
        .prepare(
          `INSERT OR IGNORE INTO agent_timeline_meta(agent_id, epoch, next_seq, updated_at)
           VALUES (?, ?, 1, ?)`,
        )
        .run(agentId, randomUUID(), nowIso());
      const insert = this.database.prepare(
        `INSERT OR IGNORE INTO agent_timeline_rows(
           agent_id, seq, timestamp, item_json, item_digest
         ) VALUES (?, ?, ?, ?, ?)`,
      );
      let nextSeq = 1;
      for (const row of rows) {
        const serialized = JSON.stringify(row.item);
        const blob =
          Buffer.byteLength(serialized, "utf8") > 16_384 ? this.blobs.put(serialized) : null;
        insert.run(agentId, row.seq, row.timestamp, blob ? null : serialized, blob?.digest ?? null);
        nextSeq = Math.max(nextSeq, row.seq + 1);
      }
      this.database
        .prepare(
          `UPDATE agent_timeline_meta
           SET next_seq = MAX(next_seq, ?), updated_at = ? WHERE agent_id = ?`,
        )
        .run(nextSeq, nowIso(), agentId);
    });
  }

  deleteAgentTimeline(agentId: string): void {
    this.transaction(() => {
      this.database.prepare("DELETE FROM agent_timeline_rows WHERE agent_id = ?").run(agentId);
      this.database.prepare("DELETE FROM agent_timeline_meta WHERE agent_id = ?").run(agentId);
    });
  }

  importLegacyForeground(input: LegacyForegroundImport): void {
    const turnLocators: Array<{ turnId: string; updatedAt: string }> = [];
    const cardLocators: Array<{ cardId: string; turnId: string; updatedAt: string }> = [];
    this.transaction(() => {
      const agent = this.database
        .prepare("SELECT agent_id FROM agents WHERE agent_id = ?")
        .get(input.agentId);
      if (!agent) {
        throw new Error(`Legacy foreground Agent ${input.agentId} was not imported`);
      }
      for (const turn of input.turns) {
        const userText = this.blobs.putJson(turn.userText);
        this.database
          .prepare(
            `INSERT OR IGNORE INTO turns(
               turn_id, agent_id, task_id, provider_thread_id, generation, status,
               turn_kind, controls_json, source_message_id, workspace_path,
               user_text_digest, provider_turn_id, background_task_id, error,
               created_at, updated_at
             ) VALUES (?, ?, NULL, (SELECT provider_thread_id FROM agents WHERE agent_id = ?),
                       ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            turn.id,
            input.agentId,
            input.agentId,
            turn.generation,
            turn.lifecycle,
            turn.kind,
            turn.controls === null ? null : JSON.stringify(turn.controls),
            turn.sourceMessageId,
            turn.workspacePath,
            userText.digest,
            turn.providerTurnId,
            turn.backgroundTaskId,
            turn.error,
            turn.startedAt,
            turn.updatedAt,
          );
        turnLocators.push({ turnId: turn.id, updatedAt: turn.updatedAt });
        for (const card of turn.cards) {
          const displayed = this.blobs.putJson(card.card);
          const answer = card.answer === null ? null : this.blobs.putJson(card.answer);
          const runtime = this.blobs.putJson(card.runtime);
          this.database
            .prepare(
              `INSERT OR IGNORE INTO cards(
                 card_id, turn_id, task_id, kind, status, displayed_digest,
                 answer_digest, submitted_summary, runtime_digest, created_at, updated_at
               ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              card.id,
              turn.id,
              card.kind,
              card.status,
              displayed.digest,
              answer?.digest ?? null,
              card.submittedSummary,
              runtime.digest,
              card.createdAt,
              card.updatedAt,
            );
          cardLocators.push({ cardId: card.id, turnId: turn.id, updatedAt: card.updatedAt });
          if (card.answer !== null) {
            this.appendDecisionInTransaction({
              taskId: null,
              turnId: turn.id,
              cardId: card.id,
              kind: `${card.kind}_answer`,
              displayed: card.card,
              rawAnswer: card.answer,
              normalized: card.answer,
              actorId: "legacy-user",
              clientId: "legacy-client",
              deviceId: null,
              commandId: card.commandId ?? `legacy-card-answer-${card.id}`,
              expectedRevision: Math.max(0, input.revision - 1),
              resultRevision: Math.max(1, input.revision),
              supersedesDecisionId: null,
              fidelity: "exact",
            });
          }
        }
      }
      this.database
        .prepare(
          `UPDATE agents SET authority_revision = MAX(authority_revision, ?),
             active_turn_id = ?, thoth_lifecycle = ?, background_task_id = ?,
             error = ?, updated_at = MAX(updated_at, ?) WHERE agent_id = ?`,
        )
        .run(
          input.revision,
          input.activeTurnId,
          input.lifecycle,
          input.backgroundTaskId,
          input.error,
          input.updatedAt,
          input.agentId,
        );
    });
    for (const turn of turnLocators) {
      this.catalog.updateTurnLocator({
        turnId: turn.turnId,
        workspaceId: this.workspaceId,
        agentId: input.agentId,
        updatedAt: turn.updatedAt,
      });
    }
    for (const card of cardLocators) {
      this.catalog.updateCardLocator({
        cardId: card.cardId,
        workspaceId: this.workspaceId,
        agentId: input.agentId,
        turnId: card.turnId,
        updatedAt: card.updatedAt,
      });
    }
  }

  importLegacyTaskMemory(input: {
    taskId: string;
    kind: TaskBlackboardEntry["kind"];
    producer: TaskBlackboardEntry["producer"];
    content: unknown;
    createdAt: string;
  }): void {
    const blob = this.blobs.putJson(input.content);
    const existing = this.database
      .prepare(
        `SELECT entry_id FROM task_blackboard
         WHERE task_id = ? AND kind = ? AND content_digest = ? LIMIT 1`,
      )
      .get(input.taskId, input.kind, blob.digest);
    if (existing) return;
    this.database
      .prepare(
        `INSERT INTO task_blackboard(
           entry_id, task_id, kind, producer, content_digest, created_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        `blackboard-legacy-${randomUUID()}`,
        input.taskId,
        input.kind,
        input.producer,
        blob.digest,
        input.createdAt,
      );
  }

  importLegacyExecution(input: {
    taskId: string;
    goalId: string;
    executionId: string;
    phaseRunId: string;
    phase: "planexec" | "review";
    providerThreadId: string | null;
    adapterId: string;
    providerThreadNativeHandle?: string | null;
    providerThreadPersistence?: Record<string, unknown> | null;
    providerThreadStatus?: "legacy_pending_adoption" | "native_context_unavailable";
    status: ExecutionLifecycle;
    generation: string;
    startedAt: string | null;
    completedAt: string | null;
    summary: string | null;
    semanticHistory: unknown;
  }): void {
    if (this.getExecution(input.executionId)) return;
    this.transaction(() => {
      if (!this.getTask(input.taskId)) {
        throw new Error(`Legacy execution Task ${input.taskId} is missing`);
      }
      if (input.providerThreadId) {
        this.database
          .prepare(
            `INSERT OR IGNORE INTO provider_threads(
               thread_id, adapter_id, native_handle, persistence_json,
               lineage_parent_id, status, created_at, updated_at
             ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)`,
          )
          .run(
            input.providerThreadId,
            input.adapterId,
            input.providerThreadNativeHandle ?? null,
            input.providerThreadPersistence
              ? JSON.stringify(input.providerThreadPersistence)
              : null,
            input.providerThreadStatus ?? "native_context_unavailable",
            input.startedAt ?? nowIso(),
            input.completedAt ?? input.startedAt ?? nowIso(),
          );
      }
      this.database
        .prepare(
          `INSERT OR IGNORE INTO phase_runs(
             phase_run_id, task_id, goal_id, phase_kind, status, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.phaseRunId,
          input.taskId,
          input.goalId,
          input.phase,
          input.status,
          input.startedAt ?? nowIso(),
          input.completedAt ?? input.startedAt ?? nowIso(),
        );
      this.database
        .prepare(
          `INSERT INTO execution_attempts(
             execution_id, task_id, goal_id, phase_run_id, phase_kind,
             provider_thread_id, status, generation, started_at, last_activity_at,
             completed_at, summary, revision
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        )
        .run(
          input.executionId,
          input.taskId,
          input.goalId,
          input.phaseRunId,
          input.phase,
          input.providerThreadId,
          input.status,
          input.generation,
          input.startedAt,
          input.completedAt ?? input.startedAt,
          input.completedAt,
          input.summary,
        );
      const serialized = JSON.stringify(input.semanticHistory);
      const blob =
        Buffer.byteLength(serialized, "utf8") > 16_384 ? this.blobs.put(serialized) : null;
      this.database
        .prepare(
          `INSERT INTO timeline_entries(
             execution_id, seq, occurred_at, item_json, item_digest
           ) VALUES (?, 1, ?, ?, ?)`,
        )
        .run(
          input.executionId,
          input.completedAt ?? input.startedAt ?? nowIso(),
          blob ? null : serialized,
          blob?.digest ?? null,
        );
    });
  }

  importLegacyTaskDecision(input: {
    taskId: string;
    decision: unknown;
    answer?: unknown;
    submittedAt?: string;
  }): void {
    const raw = input.decision as Record<string, unknown>;
    const request = TaskUserDecisionProjectionSchema.parse({
      id: raw.id,
      title: raw.title,
      question: raw.question,
      options: raw.options,
      ...(typeof raw.notePlaceholder === "string" ? { notePlaceholder: raw.notePlaceholder } : {}),
      createdAt: raw.createdAt,
    });
    const requestBlob = this.blobs.putJson(request);
    this.database
      .prepare(
        `INSERT OR IGNORE INTO task_decision_requests(
           decision_id, task_id, request_digest, status, created_at, answered_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        request.id,
        input.taskId,
        requestBlob.digest,
        input.answer === undefined ? "pending" : "answered",
        request.createdAt,
        input.submittedAt ?? null,
      );
    this.importLegacyTaskMemory({
      taskId: input.taskId,
      kind: "user_decision_request",
      producer: "review",
      content: request,
      createdAt: request.createdAt,
    });
    if (input.answer !== undefined) {
      this.appendDecision({
        taskId: input.taskId,
        turnId: null,
        cardId: null,
        kind: "loop_user_decision",
        displayed: request,
        rawAnswer: input.answer,
        normalized: input.answer,
        actorId: "legacy-user",
        clientId: "legacy-client",
        deviceId: null,
        commandId: `legacy-task-decision-${request.id}`,
        expectedRevision: 0,
        resultRevision: 1,
        supersedesDecisionId: null,
        fidelity: "exact",
      });
    }
  }

  close(): void {
    this.foregroundSubscribers.clear();
    this.database.close();
  }

  private getForegroundStateInTransaction(agentId: string): AgentThothState {
    const authority = this.getForegroundAgentRow(agentId);
    if (!authority) {
      return WorkspaceForegroundProjection.empty(agentId);
    }
    const turn = authority.active_turn_id
      ? (this.database
          .prepare("SELECT * FROM turns WHERE turn_id = ?")
          .get(authority.active_turn_id) as ForegroundTurnRow | undefined)
      : undefined;
    const pendingCard = authority.active_turn_id
      ? (this.database
          .prepare(
            `SELECT card_id, kind, displayed_digest, created_at FROM cards
             WHERE turn_id = ? AND status = 'pending'
             ORDER BY created_at DESC LIMIT 1`,
          )
          .get(authority.active_turn_id) as ForegroundCardRow | undefined)
      : undefined;
    return {
      ...WorkspaceForegroundProjection.build({
        authority,
        turn: turn ?? null,
        pendingCard: pendingCard ?? null,
        agentId,
        readBlob: (digest) => this.blobs.readJson(digest),
      }),
      queuedTurns: this.listForegroundQueue(agentId),
    };
  }

  private getForegroundAgentRow(agentId: string): ForegroundAgentAuthorityRow | null {
    const row = this.database
      .prepare(
        `SELECT agent_id, authority_revision, active_turn_id, thoth_lifecycle,
                background_task_id, error
         FROM agents WHERE agent_id = ?`,
      )
      .get(agentId) as ForegroundAgentAuthorityRow | undefined;
    if (!row) {
      return null;
    }
    return {
      ...row,
      thoth_lifecycle: AgentThothLifecycleSchema.parse(row.thoth_lifecycle),
    };
  }

  private getForegroundTurnInTransaction(turnId: string): ForegroundTurnAuthorityRecord | null {
    const row = this.database.prepare("SELECT * FROM turns WHERE turn_id = ?").get(turnId) as
      | Record<string, unknown>
      | undefined;
    return row ? this.toForegroundTurn(row) : null;
  }

  private getForegroundCardInTransaction(cardId: string): ForegroundCardAuthorityRecord | null {
    const row = this.database
      .prepare(
        `SELECT cards.*, turns.agent_id FROM cards
         JOIN turns ON turns.turn_id = cards.turn_id
         WHERE cards.card_id = ?`,
      )
      .get(cardId) as Record<string, unknown> | undefined;
    return row ? this.toForegroundCard(row) : null;
  }

  private listForegroundCardsForTurnInTransaction(turnId: string): ForegroundCardAuthorityRecord[] {
    const rows = this.database
      .prepare(
        `SELECT cards.*, turns.agent_id FROM cards
         JOIN turns ON turns.turn_id = cards.turn_id
         WHERE cards.turn_id = ? ORDER BY cards.created_at ASC`,
      )
      .all(turnId) as Array<Record<string, unknown>>;
    return rows.map((row) => this.toForegroundCard(row));
  }

  private toForegroundTurn(row: Record<string, unknown>): ForegroundTurnAuthorityRecord {
    const controlsJson = typeof row.controls_json === "string" ? row.controls_json : null;
    const userTextDigest = typeof row.user_text_digest === "string" ? row.user_text_digest : null;
    return {
      id: String(row.turn_id),
      agentId: String(row.agent_id),
      generation: String(row.generation),
      kind: row.turn_kind === "thoth" ? "thoth" : "raw",
      lifecycle: AgentThothLifecycleSchema.parse(row.status),
      controls: controlsJson
        ? ThothTurnControlSnapshotSchema.parse(JSON.parse(controlsJson) as unknown)
        : null,
      providerRunMode: ProviderRunModeSchema.parse(row.provider_run_mode ?? "default"),
      providerRunModeReceipt:
        typeof row.provider_mode_receipt_json === "string"
          ? ProviderRunModeReceiptSchema.parse(
              JSON.parse(row.provider_mode_receipt_json) as unknown,
            )
          : null,
      sourceMessageId: typeof row.source_message_id === "string" ? row.source_message_id : null,
      workspaceId: this.workspaceId,
      workspacePath:
        typeof row.workspace_path === "string"
          ? row.workspace_path
          : (this.catalog.getWorkspace(this.workspaceId)?.canonicalPath ?? ""),
      userText: userTextDigest ? String(this.blobs.readJson(userTextDigest)) : "",
      providerTurnId: typeof row.provider_turn_id === "string" ? row.provider_turn_id : null,
      backgroundTaskId: typeof row.background_task_id === "string" ? row.background_task_id : null,
      error: typeof row.error === "string" ? row.error : null,
      startedAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private toQueuedTurn(row: Record<string, unknown>, position?: number): AgentQueuedTurn {
    const resolvedPosition =
      position ??
      Number(
        (
          this.database
            .prepare(
              `SELECT COUNT(*) + 1 AS position FROM foreground_turn_queue
               WHERE agent_id = ? AND (
                 queue_order < ? OR (queue_order = ? AND created_at < ?)
               )`,
            )
            .get(
              String(row.agent_id),
              Number(row.queue_order),
              Number(row.queue_order),
              String(row.created_at),
            ) as { position: number }
        ).position,
      );
    return AgentQueuedTurnSchema.parse({
      id: String(row.queued_turn_id),
      messageId: String(row.source_message_id),
      text: String(this.blobs.readJson(String(row.text_digest))),
      deliveryMode: AgentMessageDeliveryModeSchema.parse(row.delivery_mode),
      attachmentCount: Number(row.attachment_count ?? 0),
      position: resolvedPosition,
      createdAt: String(row.created_at),
    });
  }

  private toForegroundCard(row: Record<string, unknown>): ForegroundCardAuthorityRecord {
    const kind = String(row.kind) as ForegroundAuthorityCardKind;
    const rawCard = this.blobs.readJson(String(row.displayed_digest));
    const card =
      kind === "clarify_card"
        ? ThothClarifyCardModelSchema.parse(rawCard)
        : kind === "task_card"
          ? ThothTaskCardModelSchema.parse(rawCard)
          : ThothApprovalGoalCardModelSchema.parse(rawCard);
    if (typeof row.runtime_digest !== "string") {
      throw new Error(`Foreground card ${String(row.card_id)} is missing its runtime binding`);
    }
    const runtime = this.blobs.readJson(row.runtime_digest) as ForegroundAuthorityRuntimeBinding;
    return {
      id: String(row.card_id),
      turnId: String(row.turn_id),
      agentId: String(row.agent_id),
      kind,
      status: String(row.status) as ForegroundCardAuthorityRecord["status"],
      card,
      answer:
        typeof row.answer_digest === "string"
          ? ThothCardAnswerPayloadSchema.parse(this.blobs.readJson(row.answer_digest))
          : null,
      submittedSummary: typeof row.submitted_summary === "string" ? row.submitted_summary : null,
      runtime,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private updateForegroundLifecycleInTransaction(input: {
    agentId: string;
    turnId: string;
    lifecycle: AgentThothLifecycle;
    now: string;
    error?: string | null;
    backgroundTaskId?: string | null;
  }): void {
    const authority = this.getForegroundAgentRow(input.agentId);
    if (!authority || authority.active_turn_id !== input.turnId) {
      throw new WorkspaceAuthorityConflictError("The Agent foreground turn changed.");
    }
    const error = input.error === undefined ? authority.error : input.error;
    const backgroundTaskId =
      input.backgroundTaskId === undefined ? authority.background_task_id : input.backgroundTaskId;
    this.database
      .prepare(
        `UPDATE turns SET status = ?, background_task_id = ?, error = ?, updated_at = ?
         WHERE turn_id = ?`,
      )
      .run(input.lifecycle, backgroundTaskId, error, input.now, input.turnId);
    this.database
      .prepare(
        `UPDATE agents SET authority_revision = authority_revision + 1,
           thoth_lifecycle = ?, background_task_id = ?, error = ?, updated_at = ?
         WHERE agent_id = ?`,
      )
      .run(input.lifecycle, backgroundTaskId, error, input.now, input.agentId);
  }

  private emitForeground(state: AgentThothState, reason: ForegroundAuthorityUpdateReason): void {
    for (const subscriber of this.foregroundSubscribers) {
      subscriber(state, reason);
    }
  }

  private appendDecisionInTransaction(
    input: Omit<HumanDecisionRecord, "id" | "workspaceId" | "decidedAt">,
  ): HumanDecisionRecord {
    const existing = this.database
      .prepare("SELECT * FROM human_decisions WHERE command_id = ?")
      .get(input.commandId) as Record<string, unknown> | undefined;
    if (existing) {
      return this.toDecision(existing);
    }
    const displayed = this.blobs.putJson(input.displayed);
    const rawAnswer = this.blobs.putJson(input.rawAnswer);
    const normalized = this.blobs.putJson(input.normalized);
    const decision = HumanDecisionRecordSchema.parse({
      ...input,
      id: `decision-${randomUUID()}`,
      workspaceId: this.workspaceId,
      decidedAt: nowIso(),
    });
    this.database
      .prepare(
        `INSERT INTO human_decisions(
           decision_id, task_id, turn_id, card_id, kind, displayed_digest,
           raw_answer_digest, normalized_digest, actor_id, client_id, device_id,
           command_id, expected_revision, result_revision, supersedes_decision_id,
           fidelity, decided_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        decision.id,
        decision.taskId,
        decision.turnId,
        decision.cardId,
        decision.kind,
        displayed.digest,
        rawAnswer.digest,
        normalized.digest,
        decision.actorId,
        decision.clientId,
        decision.deviceId,
        decision.commandId,
        decision.expectedRevision,
        decision.resultRevision,
        decision.supersedesDecisionId,
        decision.fidelity,
        decision.decidedAt,
      );
    return decision;
  }

  private requireActiveSemanticExecution(input: {
    executionId: string;
    generation: string;
    phase: "planexec" | "review" | undefined;
  }): ExecutionProjection {
    const execution = this.getExecution(input.executionId);
    const implementationMaySubmit =
      input.phase === "planexec" && execution?.status === "implementing";
    if (
      !execution ||
      execution.generation !== input.generation ||
      (input.phase && execution.phase !== input.phase) ||
      (!implementationMaySubmit &&
        !["starting", "running", "awaiting_provider"].includes(execution.status))
    ) {
      throw new WorkspaceAuthorityConflictError(
        `Execution ${input.executionId} is not the active semantic tool authority`,
      );
    }
    const task = this.getTask(execution.taskId);
    if (!task || task.currentExecutionId !== execution.id || task.status === "stopping") {
      throw new WorkspaceAuthorityConflictError(
        `Execution ${input.executionId} no longer owns Task ${execution.taskId}`,
      );
    }
    if (!execution.attachment || execution.attachment.status !== "attached") {
      throw new WorkspaceAuthorityConflictError(
        `Execution ${input.executionId} has no valid RuntimeBundle attachment`,
      );
    }
    return execution;
  }

  private applyFutureGoalReplanInTransaction(
    task: TaskProjection,
    currentGoalId: string,
    verdict: ThothLoopReviewVerdictInput,
  ): void {
    const proposal = verdict.deferred_goal_replan_proposal;
    if (!proposal) {
      throw new Error("Review replan outcome is missing its proposal");
    }
    const metadata = this.getTaskRuntimeMetadata(task.id);
    if (!metadata || metadata.goalsRevision !== proposal.base_goals_revision) {
      throw new WorkspaceAuthorityConflictError(
        `Goals revision changed before replan ${proposal.base_goals_revision} could be applied`,
      );
    }
    const current = task.goals.find((goal) => goal.id === currentGoalId);
    if (!current) {
      throw new Error(`Current Goal ${currentGoalId} is missing`);
    }
    const affected = new Set(proposal.affected_goal_ids);
    for (const goalId of affected) {
      const goal = task.goals.find((candidate) => candidate.id === goalId);
      if (!goal || goal.order <= current.order || goal.status !== "queued") {
        throw new Error(`Replan may only replace unstarted future Goal ${goalId}`);
      }
    }
    const proposedIds = new Set<string>();
    const proposedOrders = new Set<number>();
    for (const goal of proposal.goals) {
      if (
        proposedIds.has(goal.id) ||
        proposedOrders.has(goal.order) ||
        goal.order <= current.order
      ) {
        throw new Error("Replanned Goals must have unique future ids and order values");
      }
      proposedIds.add(goal.id);
      proposedOrders.add(goal.order);
    }
    for (const existing of task.goals) {
      if (!affected.has(existing.id) && proposedOrders.has(existing.order)) {
        throw new Error(`Replanned Goal order ${existing.order} collides with an approved Goal`);
      }
    }
    const deleteGoal = this.database.prepare(
      "DELETE FROM task_goals WHERE task_id = ? AND goal_id = ?",
    );
    for (const goalId of affected) {
      deleteGoal.run(task.id, goalId);
    }
    const insertGoal = this.database.prepare(
      `INSERT INTO task_goals(
         goal_id, task_id, goal_order, title, goal, constraints_json,
         acceptance_json, status, revision
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', 1)`,
    );
    const replanLineage = `replan-${metadata.goalsRevision + 1}`;
    for (const goal of proposal.goals) {
      insertGoal.run(
        deriveDurableGoalId({
          taskId: task.id,
          sourceGoalId: goal.id,
          order: goal.order,
          lineage: replanLineage,
        }),
        task.id,
        goal.order,
        goal.title,
        goal.goal,
        JSON.stringify(goal.constraints),
        JSON.stringify(goal.acceptance),
      );
    }
    this.database
      .prepare("UPDATE tasks SET goals_revision = goals_revision + 1 WHERE task_id = ?")
      .run(task.id);
  }

  private appendBlackboardInTransaction(input: {
    taskId: string;
    kind: TaskBlackboardEntry["kind"];
    producer: TaskBlackboardEntry["producer"];
    content: unknown;
  }): TaskBlackboardEntry {
    const blob = this.blobs.putJson(input.content);
    const entry = TaskBlackboardEntrySchema.parse({
      id: `blackboard-${randomUUID()}`,
      taskId: input.taskId,
      kind: input.kind,
      producer: input.producer,
      content: input.content,
      contentDigest: blob.digest,
      createdAt: nowIso(),
    });
    this.database
      .prepare(
        `INSERT INTO task_blackboard(entry_id, task_id, kind, producer, content_digest, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.id,
        entry.taskId,
        entry.kind,
        entry.producer,
        entry.contentDigest,
        entry.createdAt,
      );
    return entry;
  }

  private toDecision(row: Record<string, unknown>): HumanDecisionRecord {
    return HumanDecisionRecordSchema.parse({
      id: row.decision_id,
      workspaceId: this.workspaceId,
      taskId: row.task_id ?? null,
      turnId: row.turn_id ?? null,
      cardId: row.card_id ?? null,
      kind: row.kind,
      displayed: this.blobs.readJson(String(row.displayed_digest)),
      rawAnswer: this.blobs.readJson(String(row.raw_answer_digest)),
      normalized: this.blobs.readJson(String(row.normalized_digest)),
      actorId: row.actor_id,
      clientId: row.client_id,
      deviceId: row.device_id ?? null,
      commandId: row.command_id,
      expectedRevision: row.expected_revision,
      resultRevision: row.result_revision,
      supersedesDecisionId: row.supersedes_decision_id ?? null,
      fidelity: row.fidelity,
      decidedAt: row.decided_at,
    });
  }

  private toTaskProjection(row: TaskRow): TaskProjection {
    const goalRows = this.database
      .prepare("SELECT * FROM task_goals WHERE task_id = ? ORDER BY goal_order ASC")
      .all(row.task_id) as Array<Record<string, unknown>>;
    return TaskProjectionSchema.parse({
      id: row.task_id,
      workspaceId: row.workspace_id,
      sourceAgentId: row.source_agent_id,
      mode: row.execution_mode,
      title: row.title,
      goal: row.goal,
      constraints: parseStringArray(row.constraints_json),
      acceptance: parseStringArray(row.acceptance_json),
      status: row.status,
      summary: row.summary,
      currentGoalId: row.current_goal_id,
      currentExecutionId: row.current_execution_id,
      goals: goalRows.map((goal) => ({
        id: String(goal.goal_id),
        order: Number(goal.goal_order),
        title: String(goal.title),
        goal: String(goal.goal),
        constraints: parseStringArray(String(goal.constraints_json)),
        acceptance: parseStringArray(String(goal.acceptance_json)),
        status: goal.status,
        revision: Number(goal.revision),
      })),
      latestReviewDirection: row.latest_review_direction,
      pendingDecision: this.getPendingTaskDecision(row.task_id),
      budget: {
        strength: row.budget_strength,
        usedFailedReviews: row.used_failed_reviews,
        maxFailedReviews: row.max_failed_reviews,
        activeDurationMs: row.active_duration_ms,
        tokenCount: row.token_count,
        toolCallCount: row.tool_call_count,
      },
      pendingControl: row.pending_control,
      revision: row.revision,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  private toExecutionProjection(row: ExecutionRow): ExecutionProjection {
    const attachment = this.database
      .prepare("SELECT * FROM runtime_attachments WHERE execution_id = ?")
      .get(row.execution_id) as Record<string, unknown> | undefined;
    const latestApproval = this.getLatestExecutionApproval(row.execution_id);
    const pendingApproval = latestApproval?.status === "pending" ? latestApproval : null;
    return ExecutionProjectionSchema.parse({
      id: row.execution_id,
      taskId: row.task_id,
      goalId: row.goal_id,
      phaseRunId: row.phase_run_id,
      phase: row.phase_kind,
      providerThreadId: row.provider_thread_id,
      status: row.status,
      generation: row.generation,
      attachment: attachment
        ? {
            id: attachment.attachment_id,
            bundleId: attachment.bundle_id,
            bundleDigest: attachment.bundle_digest,
            status: attachment.status,
            attachedAt: attachment.attached_at,
          }
        : null,
      runModeReceipt:
        typeof row.run_mode_receipt_json === "string"
          ? ProviderRunModeReceiptSchema.parse(JSON.parse(row.run_mode_receipt_json))
          : null,
      pendingApproval,
      latestApproval,
      startedAt: row.started_at,
      lastActivityAt: row.last_activity_at,
      completedAt: row.completed_at,
      summary: row.summary,
      revision: row.revision,
    });
  }

  private toExecutionApprovalProjection(row: ExecutionApprovalRow): ExecutionApprovalProjection {
    return ExecutionApprovalProjectionSchema.parse({
      id: row.approval_id,
      taskId: row.task_id,
      executionId: row.execution_id,
      kind: row.kind,
      title: row.title,
      description: row.description,
      displayed: this.blobs.readJson(row.displayed_digest),
      deadlineAt: row.deadline_at,
      status: row.status,
      resolution:
        row.resolution_decision && row.resolution_actor_id && row.resolved_at
          ? {
              decision: row.resolution_decision,
              actorId: row.resolution_actor_id,
              resolvedAt: row.resolved_at,
            }
          : null,
      revision: row.revision,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  private cancelPendingExecutionApprovalsInTransaction(executionId: string, now: string): void {
    const rows = this.database
      .prepare(
        "SELECT approval_id, revision FROM execution_approvals WHERE execution_id = ? AND status = 'pending'",
      )
      .all(executionId) as Array<{ approval_id: string; revision: number }>;
    for (const row of rows) {
      this.database
        .prepare(
          `UPDATE execution_approvals SET status = 'canceled', deadline_at = NULL,
             revision = revision + 1, updated_at = ?
           WHERE approval_id = ? AND status = 'pending'`,
        )
        .run(now, row.approval_id);
      this.appendEventInTransaction({
        aggregateType: "execution_approval",
        aggregateId: row.approval_id,
        revision: row.revision + 1,
        kind: "execution_approval_canceled",
        payload: { executionId },
      });
    }
  }

  private toAgentRecord(row: Record<string, unknown>): StoredAgentRecord {
    const parseOptionalJson = (value: unknown): unknown =>
      typeof value === "string" ? (JSON.parse(value) as unknown) : undefined;
    return parseStoredAgentRecord({
      id: row.agent_id,
      provider: row.provider,
      cwd: row.cwd,
      workspaceId: this.workspaceId,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastActivityAt: row.last_activity_at ?? undefined,
      lastUserMessageAt: row.last_user_message_at ?? null,
      title: row.title ?? null,
      labels: parseOptionalJson(row.labels_json) ?? {},
      lastStatus: row.last_status,
      lastModeId: row.last_mode_id ?? null,
      config: parseOptionalJson(row.config_json),
      runtimeInfo: parseOptionalJson(row.runtime_info_json),
      features: parseOptionalJson(row.features_json),
      persistence: parseOptionalJson(row.persistence_json),
      lastError: row.last_error ?? null,
      requiresAttention: Number(row.requires_attention) === 1,
      attentionReason: row.attention_reason ?? null,
      attentionTimestamp: row.attention_timestamp ?? null,
      internal: Number(row.internal) === 1,
      archivedAt: row.archived_at ?? null,
    });
  }

  private appendEventInTransaction(input: {
    aggregateType: string;
    aggregateId: string;
    revision: number;
    kind: string;
    payload: unknown;
    causationId?: string;
    correlationId?: string;
  }): number {
    const eventId = randomUUID();
    const payloadJson = JSON.stringify(input.payload);
    const result = this.database
      .prepare(
        `INSERT INTO authority_events(
           event_id, aggregate_type, aggregate_id, revision, kind, payload_json,
           payload_digest, causation_id, correlation_id, occurred_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        eventId,
        input.aggregateType,
        input.aggregateId,
        input.revision,
        input.kind,
        payloadJson,
        digestJson(input.payload),
        input.causationId ?? eventId,
        input.correlationId ?? input.aggregateId,
        nowIso(),
      );
    this.database
      .prepare(
        "UPDATE workspace_meta SET authority_revision = authority_revision + 1, updated_at = ? WHERE workspace_id = ?",
      )
      .run(nowIso(), this.workspaceId);
    return Number(result.lastInsertRowid);
  }

  private transaction<T>(run: () => T): T {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = run();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  private emit(changedTaskIds: string[], changedExecutionIds: string[]): void {
    const row = this.database
      .prepare("SELECT COALESCE(MAX(seq), 0) AS seq FROM authority_events")
      .get() as { seq: number };
    const update: WorkspaceAuthorityUpdate = {
      workspaceId: this.workspaceId,
      seq: row.seq,
      changedTaskIds,
      changedExecutionIds,
    };
    for (const subscriber of this.subscribers) {
      subscriber(update);
    }
  }

  private syncTaskLocator(task: TaskProjection): void {
    this.catalog.updateTaskLocator({
      taskId: task.id,
      workspaceId: task.workspaceId,
      title: task.title,
      status: task.status,
      revision: task.revision,
      updatedAt: task.updatedAt,
    });
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const columns = this.database.prepare(`PRAGMA table_info(${table})`).all() as Array<{
      name: string;
    }>;
    if (!columns.some((candidate) => candidate.name === column)) {
      this.database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }
}
