import { randomUUID } from "node:crypto";
import path from "node:path";
import type { DatabaseSync, StatementSync } from "node:sqlite";
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
  AuthorityTransitionError,
  transitionAuthority,
  type AuthorityBlackboardAppend,
  type AuthorityCommand,
  type AuthorityMutation,
  type AuthorityState,
  type DeterministicAuthorityInput,
  type WorkspaceAuthorityRepository,
  type WorkspaceAuthoritySnapshot,
  type WorkspaceTimelineCursor,
  type WorkspaceTimelinePage,
} from "@thoth/core/authority";
import {
  ProviderRunModeReceiptSchema,
  ProviderRunModeSchema,
  type ProviderRunMode,
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
import { WorkspaceCoordinationRepository } from "./coordination-repository.js";
import { openWorkspaceDatabase } from "../storage-schema.js";

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

interface WorkspaceSql {
  begin: StatementSync;
  commit: StatementSync;
  rollback: StatementSync;
  totalChanges: StatementSync;
  bumpRevision: StatementSync;
  ensureTimelineMeta: StatementSync;
  insertTimelineRow: StatementSync;
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

type WorkspaceAuthoritySubscriber = (update: WorkspaceAuthorityUpdate) => void;
type ForegroundAuthoritySubscriber = (
  state: AgentThothState,
  reason: ForegroundAuthorityUpdateReason,
) => void;

function nowIso(): string {
  return new Date().toISOString();
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

export class WorkspaceAuthorityConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceAuthorityConflictError";
  }
}

/** The normalized SQLite Repository and Unit of Work for one Workspace authority shard. */
export class WorkspaceAuthorityStore implements WorkspaceAuthorityRepository {
  readonly workspaceId: string;
  readonly workspaceRoot: string;
  readonly blobs: ContentAddressedBlobStore;
  readonly coordination: WorkspaceCoordinationRepository;

  private readonly database: DatabaseSync;
  private readonly catalog: WorkspaceCatalogStore;
  private readonly sql: WorkspaceSql;
  private readonly subscribers = new Set<WorkspaceAuthoritySubscriber>();
  private readonly foregroundSubscribers = new Set<ForegroundAuthoritySubscriber>();

  constructor(input: { thothHome: string; workspaceId: string; catalog: WorkspaceCatalogStore }) {
    assertWorkspaceId(input.workspaceId);
    this.workspaceId = input.workspaceId;
    this.catalog = input.catalog;
    this.workspaceRoot = path.join(input.thothHome, "workspaces", input.workspaceId);
    this.blobs = new ContentAddressedBlobStore(this.workspaceRoot);
    this.database = openWorkspaceDatabase(input.thothHome, input.workspaceId);
    this.sql = {
      begin: this.database.prepare("BEGIN IMMEDIATE"),
      commit: this.database.prepare("COMMIT"),
      rollback: this.database.prepare("ROLLBACK"),
      totalChanges: this.database.prepare("SELECT total_changes() AS count"),
      bumpRevision: this.database.prepare(
        `UPDATE workspace_meta
         SET authority_revision = authority_revision + 1, updated_at = ?
         WHERE workspace_id = ?`,
      ),
      ensureTimelineMeta: this.database.prepare(
        `INSERT OR IGNORE INTO agent_timeline_meta(agent_id, epoch, next_seq, updated_at)
         VALUES (?, ?, 1, ?)`,
      ),
      insertTimelineRow: this.database.prepare(
        `INSERT OR IGNORE INTO agent_timeline_rows(
         agent_id, seq, timestamp, item_json, item_digest
         ) VALUES (?, ?, ?, ?, ?)`,
      ),
    };
    this.coordination = new WorkspaceCoordinationRepository(this.database, (run) =>
      this.transaction(run),
    );
  }

  subscribe(subscriber: WorkspaceAuthoritySubscriber): () => void {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  subscribeForeground(subscriber: ForegroundAuthoritySubscriber): () => void {
    this.foregroundSubscribers.add(subscriber);
    return () => this.foregroundSubscribers.delete(subscriber);
  }

  readSnapshot(workspaceId: string): WorkspaceAuthoritySnapshot {
    this.assertWorkspace(workspaceId);
    const tasks = this.listTasks();
    const executions = tasks.flatMap((task) => this.listExecutions(task.id));
    const approvals = this.database
      .prepare("SELECT * FROM execution_approvals ORDER BY created_at, approval_id")
      .all() as ExecutionApprovalRow[];
    const revision = (
      this.database
        .prepare("SELECT authority_revision FROM workspace_meta WHERE workspace_id = ?")
        .get(this.workspaceId) as { authority_revision: number }
    ).authority_revision;
    return {
      workspaceId: this.workspaceId,
      revision,
      tasks: Object.fromEntries(tasks.map((task) => [task.id, task])),
      executions: Object.fromEntries(executions.map((execution) => [execution.id, execution])),
      approvals: Object.fromEntries(
        approvals.map((approval) => [
          approval.approval_id,
          this.toExecutionApprovalProjection(approval),
        ]),
      ),
    };
  }

  readTimelinePage(workspaceId: string, cursor: WorkspaceTimelineCursor): WorkspaceTimelinePage {
    this.assertWorkspace(workspaceId);
    const entries = this.readTimeline(cursor);
    return {
      entries,
      nextCursor:
        entries.length === cursor.limit && entries[0]
          ? { ...cursor, beforeSeq: entries[0].seq }
          : null,
    };
  }

  transact(
    workspaceId: string,
    expectedRevision: number,
    operation: (snapshot: WorkspaceAuthoritySnapshot) => AuthorityMutation,
  ): AuthorityMutation {
    this.assertWorkspace(workspaceId);
    let mutation!: AuthorityMutation;
    this.transaction(() => {
      const snapshot = this.readSnapshot(workspaceId);
      if (snapshot.revision !== expectedRevision) {
        throw new WorkspaceAuthorityConflictError(
          `Workspace ${workspaceId} revision changed from ${expectedRevision} to ${snapshot.revision}`,
        );
      }
      mutation = operation(snapshot);
      if (mutation.projectionDelta.workspaceRevision !== expectedRevision + 1) {
        throw new WorkspaceAuthorityConflictError(
          "Authority mutation revision does not follow CAS",
        );
      }
      this.applyAuthorityMutationInTransaction(mutation);
    });
    this.syncTaskLocator(mutation.task);
    this.emit(
      [...mutation.projectionDelta.changedTaskIds],
      [...mutation.projectionDelta.changedExecutionIds],
    );
    return mutation;
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
    this.transaction(
      () => {
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
        result = {
          turn: this.getForegroundTurnInTransaction(turnId)!,
          state: this.getForegroundStateInTransaction(input.agentId),
          created: true,
        };
      },
      () => result.created,
    );

    if (result.created) {
      if (this.catalog.locateAgent(input.agentId) !== this.workspaceId) {
        this.catalog.updateAgentLocator({
          agentId: input.agentId,
          workspaceId: this.workspaceId,
          updatedAt: result.turn.updatedAt,
        });
      }
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
    let removed = false;
    this.transaction(() => {
      const result = this.database
        .prepare("DELETE FROM foreground_turn_queue WHERE agent_id = ? AND queued_turn_id = ?")
        .run(agentId, queuedTurnId);
      if (result.changes === 0) return;
      const authority = this.getForegroundAgentRow(agentId);
      if (authority) {
        this.database
          .prepare("UPDATE agents SET authority_revision = ?, updated_at = ? WHERE agent_id = ?")
          .run(authority.authority_revision + 1, nowIso(), agentId);
      }
      removed = true;
    });
    if (!removed) return false;
    this.emit([], []);
    this.emitForeground(this.getForegroundState(agentId), "queue_changed");
    return true;
  }

  clearForegroundQueue(agentId: string): number {
    let removed = 0;
    this.transaction(() => {
      const result = this.database
        .prepare("DELETE FROM foreground_turn_queue WHERE agent_id = ?")
        .run(agentId);
      removed = Number(result.changes);
      if (removed === 0) return;
      const authority = this.getForegroundAgentRow(agentId);
      if (authority) {
        this.database
          .prepare("UPDATE agents SET authority_revision = ?, updated_at = ? WHERE agent_id = ?")
          .run(authority.authority_revision + 1, nowIso(), agentId);
      }
    });
    if (removed > 0) {
      this.emit([], []);
      this.emitForeground(this.getForegroundState(agentId), "queue_changed");
    }
    return removed;
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
    this.transaction(() => {
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
    });
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
    return this.transaction(
      () =>
        this.database
          .prepare(
            `UPDATE turns SET provider_turn_id = ?, updated_at = ?
             WHERE turn_id = ? AND agent_id = ? AND generation = ?`,
          )
          .run(input.providerTurnId, nowIso(), input.turnId, input.agentId, input.generation)
          .changes === 1,
    );
  }

  recordForegroundRunModeReceipt(input: {
    agentId: string;
    turnId: string;
    generation: string;
    receipt: ProviderRunModeReceipt;
  }): ForegroundTurnAuthorityRecord {
    const receipt = ProviderRunModeReceiptSchema.parse(input.receipt);
    return this.transaction(
      () => {
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
      },
      () => true,
    );
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
      const workspaceRevision = (
        this.database
          .prepare("SELECT authority_revision FROM workspace_meta WHERE workspace_id = ?")
          .get(this.workspaceId) as { authority_revision: number }
      ).authority_revision;
      const mutation = transitionAuthority(
        {
          workspaceId: this.workspaceId,
          workspaceRevision,
          agent: {
            id: input.agentId,
            revision: authority.authority_revision,
            activeTurnId: authority.active_turn_id,
            lifecycle: authority.thoth_lifecycle,
          },
          turn: {
            id: turn.id,
            agentId: turn.agentId,
            generation: turn.generation,
            lifecycle: turn.lifecycle,
          },
          card: {
            id: card.id,
            turnId: card.turnId,
            agentId: card.agentId,
            kind: card.kind,
            status: card.status,
            displayed: card.card,
          },
        },
        {
          type: "card.answered",
          expectedRevision: input.expectedRevision,
          answer,
          submittedCard: input.submittedCard,
          submittedSummary: input.submittedSummary,
          nextLifecycle: input.nextLifecycle,
          commandId: input.commandId,
          actorId: input.actorId,
          clientId: input.clientId,
          deviceId: input.deviceId,
        },
        { now, ids: { decisionId: `decision-${randomUUID()}` } },
      );
      const displayed = this.blobs.putJson(mutation.card.submittedCard);
      const rawAnswer = this.blobs.putJson(mutation.card.answer);
      this.database
        .prepare(
          `UPDATE cards SET status = 'answered', displayed_digest = ?, answer_digest = ?,
             submitted_summary = ?, updated_at = ? WHERE card_id = ?`,
        )
        .run(
          displayed.digest,
          rawAnswer.digest,
          mutation.card.submittedSummary,
          mutation.card.updatedAt,
          input.cardId,
        );
      this.updateForegroundLifecycleInTransaction({
        agentId: input.agentId,
        turnId: turn.id,
        lifecycle: mutation.agent.lifecycle,
        now,
      });
      this.insertDecisionInTransaction(mutation.decision);
      const response = { accepted: true, conflict: false, error: null };
      this.database
        .prepare(
          `INSERT INTO authority_commands(
             command_id, aggregate_type, aggregate_id, command_kind,
             result_revision, result_json, created_at
           ) VALUES (?, 'card', ?, 'answer', ?, ?, ?)`,
        )
        .run(input.commandId, card.id, mutation.agent.revision, JSON.stringify(response), now);
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
    return this.transaction(() => {
      const turn = this.getForegroundTurnInTransaction(input.turnId);
      if (!turn || turn.generation !== input.generation) return false;
      return (
        this.database
          .prepare(
            `INSERT OR IGNORE INTO foreground_continuations(turn_id, continuation_key, created_at)
             VALUES (?, ?, ?)`,
          )
          .run(input.turnId, input.key, nowIso()).changes === 1
      );
    });
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
    if (!task) throw new Error(`Task ${execution.taskId} does not exist`);
    this.transaction(() => {
      const now = nowIso();
      if (input.providerThread) {
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
          execution.startedAt ?? now,
          execution.lastActivityAt ?? now,
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
      const mutation = this.transition(
        this.authorityState({ task }),
        { type: "execution.created", execution },
        now,
      );
      this.applyAuthorityMutationInTransaction(mutation);
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

  updateProviderThread(input: {
    threadId: string;
    nativeHandle: string | null;
    persistence: Record<string, unknown> | null;
    status?: string;
  }): boolean {
    return this.transaction(
      () =>
        this.database
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
          ).changes === 1,
    );
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
      const execution = this.getExecution(input.executionId);
      if (
        !execution ||
        execution.generation !== input.generation ||
        execution.revision !== input.expectedRevision
      ) {
        return;
      }
      const task = this.getTask(execution.taskId);
      if (!task) return;
      const mutation = this.transition(this.authorityState({ task, execution }), {
        type: "execution.status.changed",
        generation: input.generation,
        expectedRevision: input.expectedRevision,
        status: input.status,
        summary: input.summary,
      });
      this.applyAuthorityMutationInTransaction(mutation);
      changed = true;
    });
    const updated = changed ? this.getExecution(input.executionId) : null;
    if (updated) this.emit([updated.taskId], [updated.id]);
    return updated;
  }

  settleQuickExecution(input: {
    executionId: string;
    generation: string;
    status: "succeeded" | "failed";
    summary: string;
  }): boolean {
    let taskId = "";
    this.transaction(() => {
      const execution = this.getExecution(input.executionId);
      if (!execution || execution.generation !== input.generation) {
        throw new WorkspaceAuthorityConflictError(
          `Quick execution ${input.executionId} is no longer active`,
        );
      }
      const task = this.getTask(execution.taskId);
      if (!task) throw new Error(`Task ${execution.taskId} does not exist`);
      const mutation = this.transition(this.authorityState({ task, execution }), {
        type: "execution.quick.settled",
        generation: input.generation,
        status: input.status,
        summary: input.summary,
      });
      this.applyAuthorityMutationInTransaction(mutation);
      taskId = task.id;
    });
    const task = this.getTask(taskId)!;
    this.syncTaskLocator(task);
    this.emit([taskId], [input.executionId]);
    return true;
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
      const execution = this.getExecution(input.executionId);
      if (
        !execution ||
        execution.generation !== input.generation ||
        execution.revision !== input.expectedRevision ||
        execution.status !== "starting"
      ) {
        return;
      }
      const task = this.getTask(execution.taskId);
      if (!task) return;
      const mutation = this.transition(this.authorityState({ task, execution }), {
        type: "execution.status.changed",
        generation: input.generation,
        expectedRevision: input.expectedRevision,
        expectedStatus: "starting",
        status: input.status,
        runModeReceipt: receipt,
      });
      this.applyAuthorityMutationInTransaction(mutation);
      changed = true;
    });
    const updated = changed ? this.getExecution(input.executionId) : null;
    if (updated) this.emit([updated.taskId], [updated.id]);
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
    let approvalId = "";
    let taskId = "";
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
      if (!execution || !task || execution.generation !== input.generation) {
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
      taskId = task.id;
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
          task.id,
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
      const approval = this.getExecutionApproval(approvalId);
      if (!approval) throw new Error(`Execution approval ${approvalId} was not recorded`);
      const mutation = this.transition(
        this.authorityState({ task, execution }),
        { type: "execution.approval.requested", approval },
        now,
      );
      this.applyAuthorityMutationInTransaction(mutation);
    });
    const approval = this.getExecutionApproval(approvalId);
    if (!approval || !taskId) throw new Error("Execution approval was not recorded.");
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
      const approval = this.getExecutionApproval(input.approvalId);
      const approvalRow = this.database
        .prepare("SELECT generation FROM execution_approvals WHERE approval_id = ?")
        .get(input.approvalId) as { generation: string } | undefined;
      if (
        !task ||
        !execution ||
        !approval ||
        execution.taskId !== task.id ||
        approval.taskId !== task.id ||
        approval.executionId !== execution.id
      ) {
        throw new Error("Execution approval does not belong to the requested Task.");
      }
      if (approvalRow?.generation !== execution.generation) {
        throw new WorkspaceAuthorityConflictError(
          "Execution approval changed before this decision was committed.",
        );
      }
      const now = nowIso();
      const mutation = this.transition(
        this.authorityState({ task, execution, approval }),
        {
          type: "execution.approval.resolved",
          decision: input.decision,
          expectedRevision: input.expectedRevision,
          commandId: input.commandId,
          actorId: input.actorId,
          clientId: input.clientId,
          deviceId: input.deviceId,
          recordHumanDecision: input.recordHumanDecision,
        },
        now,
      );
      this.applyAuthorityMutationInTransaction(mutation);
      if (!mutation.approval) throw new Error("Approval transition produced no approval");
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
          mutation.approval.revision,
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
    let taskId = "";
    this.transaction(() => {
      const execution = this.getExecution(input.executionId);
      if (!execution) {
        throw new WorkspaceAuthorityConflictError(
          `Execution ${input.executionId} is not the active semantic tool authority`,
        );
      }
      const task = this.getTask(execution.taskId);
      if (!task) throw new Error(`Task ${execution.taskId} does not exist`);
      const mutation = this.transition(this.authorityState({ task, execution }), {
        type: "execution.planexec.completed",
        generation: input.generation,
        result: input.result,
      });
      this.applyAuthorityMutationInTransaction(mutation);
      taskId = task.id;
    });
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
    let reportContent: unknown;
    this.transaction(() => {
      const execution = this.getExecution(input.executionId);
      if (!execution) {
        throw new WorkspaceAuthorityConflictError(
          `Execution ${input.executionId} is not the active semantic tool authority`,
        );
      }
      const task = this.getTask(execution.taskId);
      if (!task) throw new Error(`Task ${execution.taskId} does not exist`);
      reportContent = this.listBlackboard(task.id)
        .filter((entry) => entry.kind === "planexec_report")
        .at(-1)?.content;
      const mutation = this.transition(
        this.authorityState({ task, execution, latestPlanExecReport: reportContent }),
        {
          type: "execution.review.assessed",
          generation: input.generation,
          assessment: input.assessment,
        },
      );
      this.applyAuthorityMutationInTransaction(mutation);
      taskId = task.id;
    });
    this.emit([taskId], [input.executionId]);
    return [
      "Independent assessment recorded. Now compare it with PlanExec's semantic account:",
      JSON.stringify(reportContent),
      "Return one Review outcome based on workspace reality, the approved goal, and this account.",
    ].join("\n\n");
  }
  acceptReviewVerdict(input: {
    executionId: string;
    generation: string;
    verdict: ThothLoopReviewVerdictInput;
    callId: string;
  }): boolean {
    let taskId = "";
    this.transaction(() => {
      const execution = this.getExecution(input.executionId);
      if (!execution) {
        throw new WorkspaceAuthorityConflictError(
          `Execution ${input.executionId} is not the active semantic tool authority`,
        );
      }
      const task = this.getTask(execution.taskId);
      if (!task) throw new Error(`Task ${execution.taskId} does not exist`);
      const mutation = this.transition(
        this.authorityState({
          task,
          execution,
          goalsRevision: this.getTaskRuntimeMetadata(task.id)?.goalsRevision,
        }),
        {
          type: "execution.review.completed",
          generation: input.generation,
          verdict: input.verdict,
        },
      );
      this.applyAuthorityMutationInTransaction(mutation);
      taskId = task.id;
    });
    this.syncTaskLocator(this.getTask(taskId)!);
    this.emit([taskId], [input.executionId]);
    return true;
  }
  acceptExecutionBlocker(input: {
    executionId: string;
    generation: string;
    report: ThothLoopReportBlockedInput;
  }): boolean {
    let taskId = "";
    this.transaction(() => {
      const execution = this.getExecution(input.executionId);
      if (!execution) {
        throw new WorkspaceAuthorityConflictError(
          `Execution ${input.executionId} is not the active semantic tool authority`,
        );
      }
      const task = this.getTask(execution.taskId);
      if (!task) throw new Error(`Task ${execution.taskId} does not exist`);
      const mutation = this.transition(this.authorityState({ task, execution }), {
        type: "execution.blocked",
        generation: input.generation,
        report: input.report,
      });
      this.applyAuthorityMutationInTransaction(mutation);
      taskId = task.id;
    });
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
      if (!task || execution.status === "cancel_requested" || task.status === "stopping") return;
      const mutation = this.transition(this.authorityState({ task, execution }), {
        type: "execution.interrupted",
        generation: input.generation,
        summary: input.summary,
      });
      this.applyAuthorityMutationInTransaction(mutation);
      taskId = task.id;
    });
    if (!taskId) return false;
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
    });
    this.emit([execution.taskId], [execution.id]);
    return projection;
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
        if (!task) throw new Error(`Recorded task ${stored.taskId} is missing`);
        result = {
          task,
          execution: stored.executionId ? this.getExecution(stored.executionId) : null,
          duplicate: true,
        };
        return;
      }

      const task = this.getTask(input.taskId);
      if (!task) throw new Error(`Task ${input.taskId} does not exist`);
      const execution = task.currentExecutionId ? this.getExecution(task.currentExecutionId) : null;
      const now = nowIso();
      const mutation = this.transition(
        this.authorityState({ task, execution }),
        {
          type: "task.control",
          command: input.command,
          expectedRevision: input.expectedRevision,
          commandId: input.commandId,
          actorId: input.actorId,
          clientId: input.clientId,
          deviceId: input.deviceId,
        },
        now,
      );
      this.applyAuthorityMutationInTransaction(mutation);
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
          mutation.task.revision,
          JSON.stringify({
            taskId: task.id,
            executionId: mutation.execution?.id ?? null,
          }),
          now,
        );
      result = {
        task: this.getTask(task.id)!,
        execution: mutation.execution ? this.getExecution(mutation.execution.id) : null,
        duplicate: false,
      };
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
      if (!task) throw new Error(`Task ${input.taskId} does not exist`);
      const pendingDecision = this.getPendingTaskDecision(task.id);
      const now = nowIso();
      const mutation = this.transition(
        this.authorityState({ task, pendingDecision }),
        {
          type: "task.decision.answered",
          decisionId: input.decisionId,
          optionId: input.optionId,
          note: input.note,
          expectedRevision: input.expectedRevision,
          commandId: input.commandId,
          actorId: input.actorId,
          clientId: input.clientId,
          deviceId: input.deviceId,
        },
        now,
      );
      this.applyAuthorityMutationInTransaction(mutation);
      if (!mutation.decision) throw new Error("Task decision transition produced no decision");
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
          mutation.task.revision,
          JSON.stringify({ taskId: task.id, decisionRecordId: mutation.decision.id }),
          now,
        );
      result = {
        task: this.getTask(task.id)!,
        decision: mutation.decision,
        duplicate: false,
      };
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
      if (!task) throw new WorkspaceAuthorityConflictError("Task is no longer stopping");
      const execution = input.executionId ? this.getExecution(input.executionId) : null;
      const mutation = this.transition(this.authorityState({ task, execution }), {
        type: "execution.stop.settled",
        generation: input.generation,
        orphaned: input.orphaned ?? false,
      });
      this.applyAuthorityMutationInTransaction(mutation);
      result = {
        task: this.getTask(task.id)!,
        execution: mutation.execution ? this.getExecution(mutation.execution.id) : null,
      };
    });
    this.emit([input.taskId], input.executionId ? [input.executionId] : []);
    this.syncTaskLocator(result.task);
    return result;
  }
  appendTimeline(input: { executionId: string; occurredAt?: string; item: unknown }): number {
    return this.transaction(() => {
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
    });
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
    return this.transaction(
      () =>
        this.database
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
          ).changes === 1,
    );
  }

  releaseMutationLease(input: {
    taskId: string;
    executionId: string;
    generation: string;
  }): boolean {
    return this.transaction(
      () =>
        this.database
          .prepare(
            `DELETE FROM workspace_leases WHERE lease_key = 'mutation' AND task_id = ?
             AND execution_id = ? AND generation = ? AND status = 'active'`,
          )
          .run(input.taskId, input.executionId, input.generation).changes === 1,
    );
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
          `SELECT execution_id FROM execution_attempts
           WHERE status IN (
             'created', 'starting', 'planning', 'awaiting_implementation', 'implementing',
             'running', 'awaiting_provider', 'awaiting_user', 'cancel_requested'
           )`,
        )
        .all() as Array<{ execution_id: string }>;
      for (const row of rows) {
        const execution = this.getExecution(row.execution_id);
        const task = execution ? this.getTask(execution.taskId) : null;
        if (!execution || !task) continue;
        const mutation = this.transition(this.authorityState({ task, execution }), {
          type: "execution.restart.interrupted",
        });
        this.applyAuthorityMutationInTransaction(mutation);
        changedTaskIds.push(task.id);
        changedExecutionIds.push(execution.id);
      }
      if (
        rows.length > 0 &&
        !rows.some((row) => this.getExecution(row.execution_id)?.status === "orphaned")
      ) {
        this.database.prepare("DELETE FROM workspace_leases WHERE status = 'active'").run();
      }
    });
    for (const taskId of changedTaskIds) {
      const task = this.getTask(taskId);
      if (task) this.syncTaskLocator(task);
    }
    if (changedTaskIds.length > 0) this.emit(changedTaskIds, changedExecutionIds);
    return changedTaskIds;
  }
  upsertAgentRecord(record: StoredAgentRecord): void {
    if (record.workspaceId !== this.workspaceId) {
      throw new Error(`Agent ${record.id} does not belong to Workspace ${this.workspaceId}`);
    }
    let registerLocator = false;
    this.transaction(
      () => {
        const existing = this.database
          .prepare("SELECT provider_thread_id, provider FROM agents WHERE agent_id = ?")
          .get(record.id) as
          | { provider_thread_id: string | null; provider: string | null }
          | undefined;
        registerLocator = !existing || existing.provider === null;
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
             created_at, updated_at, provider, cwd, last_activity_at,
             last_user_message_at, labels_json, last_status, last_mode_id,
             config_json, runtime_info_json, features_json, persistence_json,
             last_error, requires_attention, attention_reason, attention_timestamp,
             internal, archived_at, provider_run_mode, provider_control_revision
           ) VALUES (
             ?, ?, ?, ?, 0, NULL, 'idle', NULL, NULL,
             ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
           )
           ON CONFLICT(agent_id) DO UPDATE SET
             provider_thread_id = COALESCE(excluded.provider_thread_id, agents.provider_thread_id),
             title = excluded.title,
             visible = excluded.visible,
             updated_at = excluded.updated_at,
             provider = excluded.provider,
             cwd = excluded.cwd,
             last_activity_at = excluded.last_activity_at,
             last_user_message_at = excluded.last_user_message_at,
             labels_json = excluded.labels_json,
             last_status = excluded.last_status,
             last_mode_id = excluded.last_mode_id,
             config_json = excluded.config_json,
             runtime_info_json = excluded.runtime_info_json,
             features_json = excluded.features_json,
             persistence_json = excluded.persistence_json,
             last_error = excluded.last_error,
             requires_attention = excluded.requires_attention,
             attention_reason = excluded.attention_reason,
             attention_timestamp = excluded.attention_timestamp,
             internal = excluded.internal,
             archived_at = excluded.archived_at,
             provider_run_mode = excluded.provider_run_mode,
             provider_control_revision = excluded.provider_control_revision`,
          )
          .run(
            record.id,
            providerThreadId,
            record.title ?? null,
            record.internal === true ? 0 : 1,
            record.createdAt,
            record.updatedAt,
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
            record.providerRunMode ?? "default",
            record.providerControlRevision ?? 0,
          );
        if (registerLocator) {
          this.sql.ensureTimelineMeta.run(record.id, randomUUID(), record.updatedAt);
        }
      },
      () => true,
    );
    if (registerLocator) {
      this.catalog.updateAgentLocator({
        agentId: record.id,
        workspaceId: this.workspaceId,
        updatedAt: record.updatedAt,
      });
    }
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

  getAgentProviderControlRecord(agentId: string): {
    runMode: ProviderRunMode;
    revision: number;
  } | null {
    const row = this.database
      .prepare(
        "SELECT provider_run_mode, provider_control_revision FROM agents WHERE agent_id = ? AND provider IS NOT NULL",
      )
      .get(agentId) as { provider_run_mode: string; provider_control_revision: number } | undefined;
    return row
      ? {
          runMode: ProviderRunModeSchema.parse(row.provider_run_mode),
          revision: row.provider_control_revision,
        }
      : null;
  }

  updateAgentProviderControl(input: {
    agentId: string;
    runMode: ProviderRunMode;
    expectedRevision: number;
    commandId: string;
  }): { runMode: ProviderRunMode; revision: number } {
    return this.transaction(() => {
      const previous = this.database
        .prepare(
          "SELECT aggregate_id, command_kind, result_json FROM authority_commands WHERE command_id = ?",
        )
        .get(input.commandId) as
        | { aggregate_id: string; command_kind: string; result_json: string }
        | undefined;
      if (previous) {
        if (
          previous.aggregate_id !== input.agentId ||
          previous.command_kind !== "provider_control.update"
        ) {
          throw new Error(`Command id ${input.commandId} is already bound to another command`);
        }
        const parsed = JSON.parse(previous.result_json) as {
          runMode: ProviderRunMode;
          revision: number;
        };
        return {
          runMode: ProviderRunModeSchema.parse(parsed.runMode),
          revision: parsed.revision,
        };
      }

      const current = this.getAgentProviderControlRecord(input.agentId);
      if (!current) {
        throw new Error(`Agent not found: ${input.agentId}`);
      }
      if (current.revision !== input.expectedRevision) {
        throw new Error(
          `Provider control revision conflict: expected ${input.expectedRevision}, current ${current.revision}`,
        );
      }

      const result = {
        runMode: ProviderRunModeSchema.parse(input.runMode),
        revision: current.revision + 1,
      };
      const now = new Date().toISOString();
      this.database
        .prepare(
          `UPDATE agents
           SET provider_run_mode = ?, provider_control_revision = ?, updated_at = ?
           WHERE agent_id = ?`,
        )
        .run(result.runMode, result.revision, now, input.agentId);
      this.database
        .prepare(
          `INSERT INTO authority_commands(
             command_id, aggregate_type, aggregate_id, command_kind,
             result_revision, result_json, created_at
           ) VALUES (?, 'agent', ?, 'provider_control.update', ?, ?, ?)`,
        )
        .run(input.commandId, input.agentId, result.revision, JSON.stringify(result), now);
      return result;
    });
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
      .prepare(
        `SELECT meta.epoch, COALESCE(MAX(rows.seq), 0) + 1 AS next_seq
         FROM agent_timeline_meta AS meta
         LEFT JOIN agent_timeline_rows AS rows ON rows.agent_id = meta.agent_id
         WHERE meta.agent_id = ?
         GROUP BY meta.agent_id, meta.epoch`,
      )
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
    let changed = false;
    this.transaction(
      () => {
        for (const row of rows) {
          const serialized = JSON.stringify(row.item);
          const blob =
            Buffer.byteLength(serialized, "utf8") > 16_384 ? this.blobs.put(serialized) : null;
          const result = this.sql.insertTimelineRow.run(
            agentId,
            row.seq,
            row.timestamp,
            blob ? null : serialized,
            blob?.digest ?? null,
          );
          changed ||= result.changes > 0;
        }
      },
      () => changed,
    );
  }

  deleteAgentTimeline(agentId: string): void {
    this.transaction(() => {
      this.database.prepare("DELETE FROM agent_timeline_rows WHERE agent_id = ?").run(agentId);
      this.database.prepare("DELETE FROM agent_timeline_meta WHERE agent_id = ?").run(agentId);
    });
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
    const decision = HumanDecisionRecordSchema.parse({
      ...input,
      id: `decision-${randomUUID()}`,
      workspaceId: this.workspaceId,
      decidedAt: nowIso(),
    });
    this.insertDecisionInTransaction(decision);
    return decision;
  }

  private insertDecisionInTransaction(decision: HumanDecisionRecord): void {
    const displayed = this.blobs.putJson(decision.displayed);
    const rawAnswer = this.blobs.putJson(decision.rawAnswer);
    const normalized = this.blobs.putJson(decision.normalized);
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
  }

  private authorityState(input: {
    task: TaskProjection;
    execution?: ExecutionProjection | null;
    approval?: ExecutionApprovalProjection | null;
    pendingDecision?: TaskUserDecisionProjection | null;
    goalsRevision?: number;
    latestPlanExecReport?: unknown;
  }): AuthorityState {
    const row = this.database
      .prepare("SELECT authority_revision FROM workspace_meta WHERE workspace_id = ?")
      .get(this.workspaceId) as { authority_revision: number };
    return {
      workspaceRevision: row.authority_revision,
      task: input.task,
      execution: input.execution ?? null,
      approval: input.approval,
      pendingDecision: input.pendingDecision,
      goalsRevision: input.goalsRevision,
      latestPlanExecReport: input.latestPlanExecReport,
    };
  }

  private transition(
    state: AuthorityState,
    command: AuthorityCommand,
    now = nowIso(),
  ): AuthorityMutation {
    const deterministic: DeterministicAuthorityInput = {
      now,
      ids: {
        decisionId: `decision-${randomUUID()}`,
        decisionRequestId: `task-decision-${randomUUID()}`,
        blackboardIds: Array.from({ length: 8 }, () => `blackboard-${randomUUID()}`),
      },
    };
    try {
      return transitionAuthority(state, command, deterministic);
    } catch (error) {
      if (error instanceof AuthorityTransitionError) {
        if (error.kind === "conflict") throw new WorkspaceAuthorityConflictError(error.message);
        throw new Error(error.message);
      }
      throw error;
    }
  }

  private applyAuthorityMutationInTransaction(mutation: AuthorityMutation): void {
    this.writeTaskProjectionInTransaction(mutation.task, mutation.goalsRevision);
    if (mutation.execution) this.writeExecutionProjectionInTransaction(mutation.execution);
    if (mutation.approval) this.writeApprovalProjectionInTransaction(mutation.approval);
    if (mutation.cancelPendingApprovals && mutation.execution) {
      this.cancelPendingExecutionApprovalsInTransaction(
        mutation.execution.id,
        mutation.task.updatedAt,
      );
    }
    if (mutation.decision) this.insertDecisionInTransaction(mutation.decision);
    if (mutation.decisionRequest?.type === "open") {
      const request = mutation.decisionRequest.request;
      const blob = this.blobs.putJson(request);
      this.database
        .prepare(
          `INSERT INTO task_decision_requests(
             decision_id, task_id, request_digest, status, created_at
           ) VALUES (?, ?, ?, 'pending', ?)`,
        )
        .run(request.id, mutation.task.id, blob.digest, request.createdAt);
    } else if (mutation.decisionRequest?.type === "answer") {
      this.database
        .prepare(
          `UPDATE task_decision_requests SET status = 'answered', answer_decision_id = ?,
             answered_at = ? WHERE decision_id = ? AND task_id = ? AND status = 'pending'`,
        )
        .run(
          mutation.decisionRequest.decisionId,
          mutation.decisionRequest.answeredAt,
          mutation.decisionRequest.requestId,
          mutation.task.id,
        );
    }
    for (const entry of mutation.blackboard) this.insertBlackboardInTransaction(entry);
    if (mutation.phaseRunStatus && mutation.execution) {
      this.database
        .prepare("UPDATE phase_runs SET status = ?, updated_at = ? WHERE phase_run_id = ?")
        .run(mutation.phaseRunStatus, mutation.task.updatedAt, mutation.execution.phaseRunId);
    }
    for (const effect of mutation.effects) {
      if (effect.type === "quarantine_execution") {
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
          .run(mutation.task.id, effect.executionId, effect.generation, mutation.task.updatedAt);
      } else if (effect.type === "release_task_runtime") {
        this.database.prepare("DELETE FROM workspace_leases WHERE task_id = ?").run(effect.taskId);
      }
    }
  }

  private writeTaskProjectionInTransaction(task: TaskProjection, goalsRevision?: number): void {
    const update = this.database
      .prepare(
        `UPDATE tasks SET status = ?, summary = ?, current_goal_id = ?,
           current_execution_id = ?, latest_review_direction = ?, budget_strength = ?,
           used_failed_reviews = ?, max_failed_reviews = ?, active_duration_ms = ?,
           token_count = ?, tool_call_count = ?, pending_control = ?,
           goals_revision = COALESCE(?, goals_revision), revision = ?, updated_at = ?
         WHERE task_id = ?`,
      )
      .run(
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
        goalsRevision ?? null,
        task.revision,
        task.updatedAt,
        task.id,
      );
    if (update.changes !== 1) throw new Error(`Task ${task.id} disappeared during mutation`);
    const goalIds = task.goals.map((goal) => goal.id);
    this.database
      .prepare(
        `DELETE FROM task_goals WHERE task_id = ? AND goal_id NOT IN (${goalIds.map(() => "?").join(", ")})`,
      )
      .run(task.id, ...goalIds);
    const upsert = this.database.prepare(
      `INSERT INTO task_goals(
         goal_id, task_id, goal_order, title, goal, constraints_json,
         acceptance_json, status, revision
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(goal_id) DO UPDATE SET
         goal_order = excluded.goal_order,
         title = excluded.title,
         goal = excluded.goal,
         constraints_json = excluded.constraints_json,
         acceptance_json = excluded.acceptance_json,
         status = excluded.status,
         revision = excluded.revision`,
    );
    for (const goal of task.goals) {
      upsert.run(
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
  }

  private writeExecutionProjectionInTransaction(execution: ExecutionProjection): void {
    const update = this.database
      .prepare(
        `UPDATE execution_attempts SET status = ?, generation = ?, run_mode_receipt_json = ?,
           started_at = ?, last_activity_at = ?, completed_at = ?, summary = ?, revision = ?
         WHERE execution_id = ?`,
      )
      .run(
        execution.status,
        execution.generation,
        execution.runModeReceipt ? JSON.stringify(execution.runModeReceipt) : null,
        execution.startedAt,
        execution.lastActivityAt,
        execution.completedAt,
        execution.summary,
        execution.revision,
        execution.id,
      );
    if (update.changes !== 1) {
      throw new Error(`Execution ${execution.id} disappeared during mutation`);
    }
  }

  private writeApprovalProjectionInTransaction(approval: ExecutionApprovalProjection): void {
    const update = this.database
      .prepare(
        `UPDATE execution_approvals SET status = ?, resolution_decision = ?,
           resolution_actor_id = ?, resolved_at = ?, revision = ?, updated_at = ?
         WHERE approval_id = ?`,
      )
      .run(
        approval.status,
        approval.resolution?.decision ?? null,
        approval.resolution?.actorId ?? null,
        approval.resolution?.resolvedAt ?? null,
        approval.revision,
        approval.updatedAt,
        approval.id,
      );
    if (update.changes !== 1)
      throw new Error(`Approval ${approval.id} disappeared during mutation`);
  }

  private insertBlackboardInTransaction(input: AuthorityBlackboardAppend): TaskBlackboardEntry {
    const blob = this.blobs.putJson(input.content);
    const entry = TaskBlackboardEntrySchema.parse({
      ...input,
      contentDigest: blob.digest,
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
      providerRunMode: row.provider_run_mode ?? "default",
      providerControlRevision: row.provider_control_revision ?? 0,
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

  private transaction<T>(run: () => T, didChange?: () => boolean): T {
    this.sql.begin.run();
    try {
      const before = didChange
        ? null
        : Number((this.sql.totalChanges.get() as { count: number }).count);
      const result = run();
      const changed = didChange
        ? didChange()
        : Number((this.sql.totalChanges.get() as { count: number }).count) > before!;
      if (changed) {
        this.sql.bumpRevision.run(nowIso(), this.workspaceId);
      }
      this.sql.commit.run();
      return result;
    } catch (error) {
      this.sql.rollback.run();
      throw error;
    }
  }

  private assertWorkspace(workspaceId: string): void {
    if (workspaceId !== this.workspaceId) {
      throw new Error(
        `Workspace ${workspaceId} does not match authority shard ${this.workspaceId}`,
      );
    }
  }

  private emit(changedTaskIds: string[], changedExecutionIds: string[]): void {
    const row = this.database
      .prepare("SELECT authority_revision AS seq FROM workspace_meta WHERE workspace_id = ?")
      .get(this.workspaceId) as { seq: number };
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
}
