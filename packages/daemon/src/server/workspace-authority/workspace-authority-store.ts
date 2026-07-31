import { randomUUID } from "node:crypto";
import path from "node:path";
import type { DatabaseSync, StatementSync } from "node:sqlite";
import {
  EvidenceRefSchema,
  ExecutionApprovalProjectionSchema,
  ExecutionProjectionSchema,
  HumanDecisionRecordSchema,
  ReviewDecisionProjectionSchema,
  TaskContextEnvelopeSchema,
  TaskOriginSchema,
  TaskProjectionSchema,
  TaskUserDecisionProjectionSchema,
  TaskWorkingSetProjectionSchema,
  WorkUnitProjectionSchema,
  type EvidenceRef,
  type ExecutionLifecycle,
  type ExecutionApprovalDecision,
  type ExecutionApprovalProjection,
  type ExecutionProjection,
  type HumanDecisionRecord,
  type ReviewDecisionProjection,
  type RuntimeAttachmentProjection,
  type TaskCommand,
  type TaskContextEnvelope,
  type TaskContextReference,
  type TaskProjection,
  type TaskUserDecisionProjection,
  type TaskWorkingSetProjection,
  type WorkUnitProjection,
} from "@thoth/protocol/task-authority";
import {
  IntentContractProjectionSchema,
  type IntentContractProjection,
} from "@thoth/protocol/intent-contract";
import {
  ClarifyDecisionNodeProjectionSchema,
  ClarifySessionProjectionSchema,
  type ClarifyDecisionNodeProjection,
  type ClarifySessionProjection,
} from "@thoth/protocol/clarify-authority";
import type { HarnessApprovalRequest, RuntimeAttachmentReceipt } from "@thoth/drivers/harness";
import {
  AuthorityTransitionError,
  transitionAuthority,
  type AuthorityCommand,
  type AuthorityEvidenceAppend,
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
  ThothCardAnswerPayloadSchema,
  ThothClarifyCardModelSchema,
  ThothIntentContractCardModelSchema,
  ThothTurnControlSnapshotSchema,
  type AgentThothLifecycle,
  type AgentThothState,
  type ThothCardAnswerPayload,
} from "@thoth/protocol/thoth/rpc-schemas";
import type {
  ThothClarifyJudgeContractInput,
  ThothClarifyProposeContractInput,
  ThothClarifyUpdateMapInput,
  ThothLoopCheckpointInput,
  ThothLoopReportBlockedInput,
  ThothLoopRequestHumanDecisionInput,
  ThothLoopReviewDecisionInput,
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
  ForegroundTaskClarifyHandoffRecord,
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

export interface ClarifyAuthorityUpdate {
  workspaceId: string;
  agentId: string;
  sessionId: string;
  revision: number;
  changedNodeIds: string[];
}

interface TaskRow extends Record<string, unknown> {
  task_id: string;
  workspace_id: string;
  source_agent_workspace_id: string;
  source_agent_id: string;
  execution_mode: string;
  title: string;
  intent_contract_id: string;
  status: string;
  summary: string;
  current_execution_id: string | null;
  current_work_unit_id: string | null;
  completion_authority: string;
  source_turn_id: string | null;
  source_contract_card_id: string | null;
  provider_profile_id: string | null;
  origin_json: string | null;
  budget_strength: string;
  used_non_complete_reviews: number;
  max_non_complete_reviews: number | null;
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
  work_unit_id: string | null;
  cycle_id: string | null;
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
  sourceContractCardId: string;
  providerProfileId: string;
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
type ClarifyAuthoritySubscriber = (update: ClarifyAuthorityUpdate) => void;
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

function assertDecisionDag(
  nodes: Array<Pick<ClarifyDecisionNodeProjection, "id" | "parentIds">>,
): void {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (nodeId: string): void => {
    if (visiting.has(nodeId)) throw new Error(`Decision Map contains a cycle through ${nodeId}`);
    if (visited.has(nodeId)) return;
    const node = byId.get(nodeId);
    if (!node) throw new Error(`Decision Map is missing node ${nodeId}`);
    visiting.add(nodeId);
    for (const parentId of node.parentIds) visit(parentId);
    visiting.delete(nodeId);
    visited.add(nodeId);
  };
  for (const node of nodes) visit(node.id);
}

function isDecisionDescendant(
  nodeId: string,
  ancestorId: string,
  nodes: Map<string, ClarifyDecisionNodeProjection>,
  visited = new Set<string>(),
): boolean {
  if (visited.has(nodeId)) return false;
  visited.add(nodeId);
  const node = nodes.get(nodeId);
  if (!node) return false;
  return node.parentIds.some(
    (parentId) =>
      parentId === ancestorId || isDecisionDescendant(parentId, ancestorId, nodes, visited),
  );
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
  private readonly clarifySubscribers = new Set<ClarifyAuthoritySubscriber>();
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

  subscribeClarify(subscriber: ClarifyAuthoritySubscriber): () => void {
    this.clarifySubscribers.add(subscriber);
    return () => this.clarifySubscribers.delete(subscriber);
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
          [
            "running",
            "awaiting_card",
            "awaiting_implementation",
            "quick_wait",
            "quick_exec",
          ].includes(authority.thoth_lifecycle)
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
             provider_plan_receipt_json, provider_interaction_json, provider_interaction_revision,
             runtime_attachment_json, source_message_id, workspace_path, user_text_digest,
             provider_turn_id, background_task_id, error, created_at, updated_at
           ) VALUES (?, ?, NULL, NULL, ?, 'running', ?, ?, ?, NULL, NULL, NULL, 0, NULL,
             ?, ?, ?, NULL, NULL, NULL, ?, ?)`,
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
        if (input.taskClarifyHandoff) {
          this.database
            .prepare(
              `INSERT INTO task_clarify_handoffs(
                 turn_id, task_workspace_id, task_id, decision_request_id,
                 status, created_at, completed_at
               ) VALUES (?, ?, ?, ?, 'active', ?, NULL)`,
            )
            .run(
              turnId,
              input.taskClarifyHandoff.taskWorkspaceId,
              input.taskClarifyHandoff.taskId,
              input.taskClarifyHandoff.decisionRequestId,
              now,
            );
        }
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

  recordForegroundProviderInteraction(input: {
    agentId: string;
    turnId: string;
    generation: string;
    expectedRevision: number;
    interaction: import("@thoth/core").ProviderTurnInteractionState;
    planReceipt?: import("@thoth/protocol/agent-types").ProviderPlanCompleted | null;
  }): ForegroundTurnAuthorityRecord {
    return this.transaction(
      () => {
        const updated = this.database
          .prepare(
            `UPDATE turns SET
               provider_interaction_json = ?,
               provider_interaction_revision = provider_interaction_revision + 1,
               provider_plan_receipt_json = COALESCE(?, provider_plan_receipt_json),
               updated_at = ?
             WHERE turn_id = ? AND agent_id = ? AND generation = ?
               AND provider_interaction_revision = ?`,
          )
          .run(
            JSON.stringify(input.interaction),
            input.planReceipt === undefined || input.planReceipt === null
              ? null
              : JSON.stringify(input.planReceipt),
            nowIso(),
            input.turnId,
            input.agentId,
            input.generation,
            input.expectedRevision,
          );
        if (updated.changes !== 1) {
          throw new WorkspaceAuthorityConflictError(
            "Foreground Provider interaction changed before the event was committed.",
          );
        }
        return this.getForegroundTurnInTransaction(input.turnId)!;
      },
      () => true,
    );
  }

  recordForegroundRuntimeAttachment(input: {
    agentId: string;
    turnId: string;
    generation: string;
    receipt: RuntimeAttachmentReceipt;
  }): ForegroundTurnAuthorityRecord {
    this.transaction(() => {
      const turn = this.getForegroundTurnInTransaction(input.turnId);
      if (
        !turn ||
        turn.agentId !== input.agentId ||
        turn.generation !== input.generation ||
        turn.kind !== "thoth"
      ) {
        throw new WorkspaceAuthorityConflictError(
          "RuntimeBundle receipt belongs to a stale foreground turn",
        );
      }
      if (input.receipt.bundleId !== "thoth.clarify") {
        throw new Error("Foreground Clarify requires a thoth.clarify RuntimeBundle receipt");
      }
      this.database
        .prepare(`UPDATE turns SET runtime_attachment_json = ?, updated_at = ? WHERE turn_id = ?`)
        .run(JSON.stringify(input.receipt), nowIso(), input.turnId);
    });
    return this.getForegroundTurn(input.turnId)!;
  }

  bindForegroundTask(input: {
    agentId: string;
    turnId: string;
    generation: string;
    taskId: string;
  }): ForegroundTurnAuthorityRecord {
    this.transaction(() => {
      const turn = this.getForegroundTurnInTransaction(input.turnId);
      const task = this.getTask(input.taskId);
      if (
        !turn ||
        turn.agentId !== input.agentId ||
        turn.generation !== input.generation ||
        !task ||
        task.workspaceId !== this.workspaceId ||
        task.sourceAgentId !== input.agentId
      ) {
        throw new WorkspaceAuthorityConflictError("Task belongs to another foreground turn");
      }
      this.database
        .prepare(`UPDATE turns SET task_id = ?, updated_at = ? WHERE turn_id = ?`)
        .run(input.taskId, nowIso(), input.turnId);
    });
    return this.getForegroundTurn(input.turnId)!;
  }

  openForegroundCard(input: {
    agentId: string;
    turnId: string;
    generation: string;
    card: ForegroundAuthorityCard;
    runtime: ForegroundAuthorityRuntimeBinding;
    clarify?: { sessionId: string; awaitingNodeIds: string[] };
  }): { record: ForegroundCardAuthorityRecord; state: AgentThothState; created: boolean } {
    let output!: {
      record: ForegroundCardAuthorityRecord;
      state: AgentThothState;
      created: boolean;
    };
    let changedClarifyNodeIds: string[] = [];
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
      if (input.card.kind === "clarify_card") {
        if (!input.clarify || input.clarify.sessionId !== input.card.card.sessionId) {
          throw new WorkspaceAuthorityConflictError(
            "Clarify Card must be atomically bound to its Decision Map session.",
          );
        }
        const session = this.getClarifySession(input.clarify.sessionId);
        if (
          !session ||
          session.agentId !== input.agentId ||
          session.turnId !== input.turnId ||
          !session.effectiveStrength ||
          ["confirmed", "canceled", "blocked"].includes(session.lifecycle)
        ) {
          throw new WorkspaceAuthorityConflictError(
            "Clarify Card no longer belongs to an active Decision Map.",
          );
        }
        const questionNodeIds = input.card.card.card.questions.map((question) => question.nodeId);
        if (
          questionNodeIds.length !== input.clarify.awaitingNodeIds.length ||
          questionNodeIds.some((nodeId, index) => nodeId !== input.clarify!.awaitingNodeIds[index])
        ) {
          throw new WorkspaceAuthorityConflictError(
            "Clarify Card questions do not match the atomically opened Decision Map frontier.",
          );
        }
        const nodes = new Map(session.nodes.map((node) => [node.id, node]));
        const updateNode = this.database.prepare(
          `UPDATE clarify_decision_nodes SET status = 'awaiting_human', revision = revision + 1,
             updated_at = ? WHERE session_id = ? AND node_id = ?`,
        );
        for (const nodeId of questionNodeIds) {
          const node = nodes.get(nodeId);
          if (
            !node ||
            node.owner !== "human" ||
            !["open", "awaiting_human"].includes(node.status)
          ) {
            throw new WorkspaceAuthorityConflictError(
              `Clarify Card node ${nodeId} is not an open Human-owned frontier.`,
            );
          }
          updateNode.run(now, session.id, nodeId);
        }
        this.database
          .prepare(
            `UPDATE clarify_sessions SET lifecycle = 'awaiting_human', revision = revision + 1,
               updated_at = ? WHERE session_id = ?`,
          )
          .run(now, session.id);
        changedClarifyNodeIds = questionNodeIds;
      } else if (input.clarify) {
        throw new WorkspaceAuthorityConflictError(
          "Only a Clarify Card can mutate a Decision Map while opening.",
        );
      }
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
      if (input.clarify) {
        const session = this.getClarifySession(input.clarify.sessionId);
        if (session) this.emitClarify(session, changedClarifyNodeIds);
      }
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
    const clarifyUpdate: {
      current: { sessionId: string; changedNodeIds: string[] } | null;
    } = { current: null };
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
      const taskHandoff = this.getTaskClarifyHandoff(turn.id);
      const decision = taskHandoff
        ? { ...mutation.decision, taskId: taskHandoff.taskId }
        : mutation.decision;
      this.insertDecisionInTransaction(decision);
      if (card.kind === "clarify_card" && "questionCardId" in answer) {
        const clarifyCard = ThothClarifyCardModelSchema.parse(card.card);
        if (answer.intent === "stop") {
          this.cancelClarifySessionInTransaction(clarifyCard.sessionId, now);
          if (taskHandoff?.status === "active") {
            this.finishTaskClarifyHandoffInTransaction(taskHandoff.turnId, "canceled", now);
          }
          clarifyUpdate.current = { sessionId: clarifyCard.sessionId, changedNodeIds: [] };
        } else {
          clarifyUpdate.current = {
            sessionId: clarifyCard.sessionId,
            changedNodeIds: this.applyClarifyCardDecisionInTransaction({
              sessionId: clarifyCard.sessionId,
              answer,
              decisionId: decision.id,
              now,
            }),
          };
        }
      } else if (card.kind === "intent_contract_card" && "cardId" in answer) {
        const contractCard = ThothIntentContractCardModelSchema.parse(card.card);
        if (answer.intent === "accept_quick" || answer.intent === "accept_loop") {
          this.confirmIntentContractInTransaction(contractCard.sessionId, now);
        } else if (answer.intent === "annotate") {
          this.reopenIntentContractInTransaction(contractCard.sessionId, now);
        } else if (answer.intent === "cancel") {
          this.cancelClarifySessionInTransaction(contractCard.sessionId, now);
          if (taskHandoff?.status === "active") {
            this.finishTaskClarifyHandoffInTransaction(taskHandoff.turnId, "canceled", now);
          }
        }
        clarifyUpdate.current = { sessionId: contractCard.sessionId, changedNodeIds: [] };
      }
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
      if (clarifyUpdate.current) {
        const session = this.getClarifySession(clarifyUpdate.current.sessionId);
        if (session) this.emitClarify(session, clarifyUpdate.current.changedNodeIds);
      }
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

  getTaskClarifyHandoff(turnId: string): ForegroundTaskClarifyHandoffRecord | null {
    const row = this.database
      .prepare("SELECT * FROM task_clarify_handoffs WHERE turn_id = ?")
      .get(turnId) as
      | {
          turn_id: string;
          task_workspace_id: string;
          task_id: string;
          decision_request_id: string;
          status: ForegroundTaskClarifyHandoffRecord["status"];
          created_at: string;
          completed_at: string | null;
        }
      | undefined;
    return row
      ? {
          turnId: row.turn_id,
          taskWorkspaceId: row.task_workspace_id,
          taskId: row.task_id,
          decisionRequestId: row.decision_request_id,
          status: row.status,
          createdAt: row.created_at,
          completedAt: row.completed_at,
        }
      : null;
  }

  listForegroundCardsForTurn(turnId: string): ForegroundCardAuthorityRecord[] {
    return this.listForegroundCardsForTurnInTransaction(turnId);
  }

  listForegroundCardsForAgent(agentId: string): ForegroundCardAuthorityRecord[] {
    const rows = this.database
      .prepare(
        `SELECT cards.* FROM cards
         JOIN turns ON turns.turn_id = cards.turn_id
         WHERE turns.agent_id = ?
           AND cards.kind IN ('clarify_card', 'intent_contract_card')
         ORDER BY cards.created_at ASC`,
      )
      .all(agentId) as Array<Record<string, unknown>>;
    return rows.map((row) => this.toForegroundCard(row));
  }

  listAllForegroundCards(): ForegroundCardAuthorityRecord[] {
    const rows = this.database
      .prepare(
        `SELECT cards.*, turns.agent_id FROM cards
         JOIN turns ON turns.turn_id = cards.turn_id
         WHERE cards.kind IN ('clarify_card', 'intent_contract_card')
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

  startClarifySession(input: {
    agentId: string;
    turnId: string;
    requestedStrength: "auto" | "light" | "balanced" | "dive";
  }): ClarifySessionProjection {
    let sessionId = "";
    let created = false;
    this.transaction(() => {
      const existing = this.database
        .prepare("SELECT session_id FROM clarify_sessions WHERE turn_id = ?")
        .get(input.turnId) as { session_id: string } | undefined;
      if (existing) {
        sessionId = existing.session_id;
        return;
      }
      const turn = this.getForegroundTurnInTransaction(input.turnId);
      if (!turn || turn.agentId !== input.agentId || turn.kind !== "thoth") {
        throw new WorkspaceAuthorityConflictError(
          `Foreground turn ${input.turnId} cannot own a Clarify session`,
        );
      }
      const now = nowIso();
      sessionId = `clarify-session-${randomUUID()}`;
      this.database
        .prepare(
          `INSERT INTO clarify_sessions(
             session_id, workspace_id, agent_id, turn_id, requested_strength,
             effective_strength, lifecycle, challenger_used, priority_node_id,
             intent_contract_id, revision, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, 'grounding', 0, NULL, NULL, 1, ?, ?)`,
        )
        .run(
          sessionId,
          this.workspaceId,
          input.agentId,
          input.turnId,
          input.requestedStrength,
          input.requestedStrength === "auto" ? null : input.requestedStrength,
          now,
          now,
        );
      created = true;
    });
    const session = this.getClarifySession(sessionId);
    if (!session) throw new Error(`Clarify session ${sessionId} was not created`);
    if (created) this.emitClarify(session, []);
    return session;
  }

  getClarifySession(sessionId: string): ClarifySessionProjection | null {
    const row = this.database
      .prepare("SELECT * FROM clarify_sessions WHERE session_id = ?")
      .get(sessionId) as Record<string, unknown> | undefined;
    return row ? this.toClarifySession(row) : null;
  }

  getLatestClarifySessionForAgent(agentId: string): ClarifySessionProjection | null {
    const row = this.database
      .prepare(
        `SELECT * FROM clarify_sessions WHERE agent_id = ?
         ORDER BY created_at DESC, session_id DESC LIMIT 1`,
      )
      .get(agentId) as Record<string, unknown> | undefined;
    return row ? this.toClarifySession(row) : null;
  }

  updateClarifyDecisionMap(input: {
    sessionId: string;
    update: ThothClarifyUpdateMapInput;
  }): ClarifySessionProjection {
    let changedNodeIds: string[] = [];
    this.transaction(() => {
      const session = this.getClarifySession(input.sessionId);
      if (!session || ["confirmed", "canceled"].includes(session.lifecycle)) {
        throw new WorkspaceAuthorityConflictError(
          "Clarify session no longer accepts Decision Map updates",
        );
      }
      const existing = new Map(session.nodes.map((node) => [node.id, node]));
      const incomingIds = new Set(input.update.nodes.map((node) => node.id));
      if (incomingIds.size !== input.update.nodes.length) {
        throw new Error("Decision Map update contains duplicate node ids");
      }
      for (const node of input.update.nodes) {
        for (const parentId of node.parentIds) {
          if (!existing.has(parentId) && !incomingIds.has(parentId)) {
            throw new Error(`Decision node ${node.id} references unknown parent ${parentId}`);
          }
        }
        this.assertClarifyNodeResolution(node);
        const previous = existing.get(node.id);
        if (
          previous?.owner === "human" &&
          ["resolved", "delegated"].includes(previous.status) &&
          (node.status !== previous.status || node.resolutionRef !== previous.resolutionRef)
        ) {
          throw new WorkspaceAuthorityConflictError(
            `Human Decision node ${node.id} cannot be overwritten by the Agent`,
          );
        }
      }
      assertDecisionDag([
        ...session.nodes.filter((node) => !incomingIds.has(node.id)),
        ...input.update.nodes.map((node) => ({ ...node, priority: 0, revision: 1 })),
      ]);
      const maximumPriority = session.nodes.reduce(
        (maximum, node) => Math.max(maximum, node.priority),
        0,
      );
      const upsert = this.database.prepare(
        `INSERT INTO clarify_decision_nodes(
           node_id, session_id, parent_ids_json, title, owner, materiality, status,
           resolution_ref, source_refs_json, priority, revision, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
         ON CONFLICT(session_id, node_id) DO UPDATE SET
           parent_ids_json = excluded.parent_ids_json,
           title = excluded.title,
           owner = excluded.owner,
           materiality = excluded.materiality,
           status = excluded.status,
           resolution_ref = excluded.resolution_ref,
           source_refs_json = excluded.source_refs_json,
           priority = excluded.priority,
           revision = clarify_decision_nodes.revision + 1,
           updated_at = excluded.updated_at`,
      );
      const now = nowIso();
      input.update.nodes.forEach((node, index) => {
        const previous = existing.get(node.id);
        upsert.run(
          node.id,
          session.id,
          JSON.stringify(node.parentIds),
          node.title,
          node.owner,
          node.materiality,
          node.status,
          node.resolutionRef,
          JSON.stringify(node.sourceRefs),
          previous?.priority ?? maximumPriority + input.update.nodes.length - index,
          previous ? session.createdAt : now,
          now,
        );
      });
      this.database
        .prepare(
          `UPDATE clarify_sessions SET effective_strength = ?, lifecycle = 'mapping',
             revision = revision + 1, updated_at = ? WHERE session_id = ?`,
        )
        .run(input.update.effectiveStrength, now, session.id);
      changedNodeIds = input.update.nodes.map((node) => node.id);
    });
    const session = this.getClarifySession(input.sessionId)!;
    this.emitClarify(session, changedNodeIds);
    return session;
  }

  applyClarifyCardDecision(input: {
    sessionId: string;
    answer: Extract<ThothCardAnswerPayload, { questionCardId: string }>;
    decisionId: string;
  }): ClarifySessionProjection {
    const changedNodeIds = this.transaction(() =>
      this.applyClarifyCardDecisionInTransaction({ ...input, now: nowIso() }),
    );
    const session = this.getClarifySession(input.sessionId)!;
    this.emitClarify(session, changedNodeIds);
    return session;
  }

  private applyClarifyCardDecisionInTransaction(input: {
    sessionId: string;
    answer: Extract<ThothCardAnswerPayload, { questionCardId: string }>;
    decisionId: string;
    now: string;
  }): string[] {
    const session = this.getClarifySession(input.sessionId);
    if (!session) throw new Error(`Clarify session ${input.sessionId} does not exist`);
    const nodes = new Map(session.nodes.map((node) => [node.id, node]));
    const direct = new Set(input.answer.answers.map((answer) => answer.nodeId));
    const delegated = new Set(input.answer.delegatedNodeIds);
    for (const nodeId of [...direct, ...delegated]) {
      const node = nodes.get(nodeId);
      if (!node || node.owner !== "human") {
        throw new Error(`Clarify answer references non-Human node ${nodeId}`);
      }
    }
    if (input.answer.intent === "delegate_subtree") {
      for (const rootId of delegated) {
        for (const node of session.nodes) {
          if (node.id === rootId || isDecisionDescendant(node.id, rootId, nodes)) {
            delegated.add(node.id);
          }
        }
      }
    }
    const changedNodeIds: string[] = [];
    const update = this.database.prepare(
      `UPDATE clarify_decision_nodes SET status = ?, resolution_ref = ?,
         revision = revision + 1, updated_at = ?
       WHERE session_id = ? AND node_id = ?`,
    );
    for (const nodeId of direct) {
      const status =
        input.answer.intent === "recommend" || delegated.has(nodeId) ? "delegated" : "resolved";
      update.run(status, input.decisionId, input.now, session.id, nodeId);
      changedNodeIds.push(nodeId);
    }
    for (const nodeId of delegated) {
      if (direct.has(nodeId)) continue;
      update.run("delegated", input.decisionId, input.now, session.id, nodeId);
      changedNodeIds.push(nodeId);
    }
    this.database
      .prepare(
        `UPDATE clarify_sessions SET lifecycle = 'mapping', priority_node_id = NULL,
           revision = revision + 1, updated_at = ? WHERE session_id = ?`,
      )
      .run(input.now, session.id);
    return changedNodeIds;
  }

  proposeIntentContract(input: {
    sessionId: string;
    proposal: ThothClarifyProposeContractInput;
  }): ClarifySessionProjection {
    this.transaction(() => {
      const session = this.getClarifySession(input.sessionId);
      if (!session) throw new Error(`Clarify session ${input.sessionId} does not exist`);
      if (session.intentContract) {
        throw new WorkspaceAuthorityConflictError(
          "This Clarify contract proposal already exists; revise the session instead of duplicating it",
        );
      }
      const openHuman = session.nodes.filter(
        (node) =>
          node.owner === "human" &&
          node.materiality !== "local" &&
          ["open", "awaiting_human"].includes(node.status),
      );
      if (openHuman.length > 0) {
        throw new Error(
          `Intent Contract cannot be proposed with unresolved material Human nodes: ${openHuman.map((node) => node.title).join(", ")}`,
        );
      }
      for (const nodeId of input.proposal.decisionNodeRefs) {
        if (!session.nodes.some((node) => node.id === nodeId)) {
          throw new Error(`Intent Contract references unknown Decision node ${nodeId}`);
        }
      }
      const now = nowIso();
      const contract: IntentContractProjection = {
        id: `intent-contract-${randomUUID()}`,
        workspaceId: this.workspaceId,
        sourceAgentId: session.agentId,
        taskId: null,
        title: input.proposal.contract.title,
        objective: input.proposal.contract.objective,
        nonGoals: input.proposal.contract.nonGoals,
        invariants: input.proposal.contract.invariants,
        acceptanceClaims: input.proposal.contract.acceptance.map((statement) => ({
          id: `acceptance-claim-${randomUUID()}`,
          statement,
          status: "open",
          evidenceRefs: [],
          revision: 1,
        })),
        riskBoundary: input.proposal.contract.riskBoundary,
        humanDecisionRefs: input.proposal.contract.humanDecisionRefs,
        escalationPolicy: input.proposal.contract.escalationPolicy,
        status: "proposed",
        revision: 1,
        confirmedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      this.writeIntentContractInTransaction(contract);
      this.database
        .prepare(
          `UPDATE clarify_sessions SET intent_contract_id = ?, lifecycle = 'proposing',
             revision = revision + 1, updated_at = ? WHERE session_id = ?`,
        )
        .run(contract.id, now, session.id);
    });
    const session = this.getClarifySession(input.sessionId)!;
    this.emitClarify(session, []);
    return session;
  }

  applyClarifyChallenge(input: {
    sessionId: string;
    result: ThothClarifyJudgeContractInput;
  }): ClarifySessionProjection {
    let changedNodeIds: string[] = [];
    this.transaction(() => {
      const session = this.getClarifySession(input.sessionId);
      if (!session || !session.intentContract) {
        throw new Error("Clarify Challenger requires a proposed Intent Contract");
      }
      if (session.challengerUsed) {
        throw new WorkspaceAuthorityConflictError(
          "Clarify Challenger has already run for this session",
        );
      }
      const now = nowIso();
      if (input.result.decision === "reopen") {
        const existingIds = new Set(session.nodes.map((node) => node.id));
        for (const node of input.result.missingNodes) {
          if (existingIds.has(node.id))
            throw new Error(`Challenger duplicated Decision node ${node.id}`);
          for (const parentId of node.parentIds) {
            if (
              !existingIds.has(parentId) &&
              !input.result.missingNodes.some((candidate) => candidate.id === parentId)
            ) {
              throw new Error(`Challenger node ${node.id} references unknown parent ${parentId}`);
            }
          }
          this.assertClarifyNodeResolution(node);
        }
        const insert = this.database.prepare(
          `INSERT INTO clarify_decision_nodes(
             node_id, session_id, parent_ids_json, title, owner, materiality, status,
             resolution_ref, source_refs_json, priority, revision, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        );
        const priority = session.nodes.reduce(
          (maximum, node) => Math.max(maximum, node.priority),
          0,
        );
        input.result.missingNodes.forEach((node, index) => {
          insert.run(
            node.id,
            session.id,
            JSON.stringify(node.parentIds),
            node.title,
            node.owner,
            node.materiality,
            node.status,
            node.resolutionRef,
            JSON.stringify(node.sourceRefs),
            priority + input.result.missingNodes.length - index,
            now,
            now,
          );
        });
        changedNodeIds = input.result.missingNodes.map((node) => node.id);
      }
      this.database
        .prepare(
          `UPDATE clarify_sessions SET challenger_used = 1, lifecycle = ?,
             revision = revision + 1, updated_at = ? WHERE session_id = ?`,
        )
        .run(
          input.result.decision === "reopen"
            ? "mapping"
            : input.result.decision === "blocked"
              ? "blocked"
              : "proposing",
          now,
          session.id,
        );
    });
    const session = this.getClarifySession(input.sessionId)!;
    this.emitClarify(session, changedNodeIds);
    return session;
  }

  confirmIntentContract(sessionId: string): ClarifySessionProjection {
    this.transaction(() => this.confirmIntentContractInTransaction(sessionId, nowIso()));
    const session = this.getClarifySession(sessionId)!;
    this.emitClarify(session, []);
    return session;
  }

  reopenIntentContract(sessionId: string): ClarifySessionProjection {
    this.transaction(() => this.reopenIntentContractInTransaction(sessionId, nowIso()));
    const session = this.getClarifySession(sessionId)!;
    this.emitClarify(session, []);
    return session;
  }

  private confirmIntentContractInTransaction(sessionId: string, now: string): void {
    const session = this.getClarifySession(sessionId);
    if (!session?.intentContract || !session.challengerUsed) {
      throw new WorkspaceAuthorityConflictError(
        "Intent Contract cannot be confirmed before its one-shot Challenger completes",
      );
    }
    this.database
      .prepare(
        `UPDATE intent_contracts SET status = 'confirmed', confirmed_at = ?,
           revision = revision + 1, updated_at = ? WHERE contract_id = ?`,
      )
      .run(now, now, session.intentContract.id);
    this.database
      .prepare(
        `UPDATE clarify_sessions SET lifecycle = 'confirmed', revision = revision + 1,
           updated_at = ? WHERE session_id = ?`,
      )
      .run(now, session.id);
  }

  private reopenIntentContractInTransaction(sessionId: string, now: string): void {
    const session = this.getClarifySession(sessionId);
    if (!session?.intentContract) throw new Error("Clarify session has no proposed contract");
    this.database
      .prepare(
        `UPDATE intent_contracts SET status = 'superseded', revision = revision + 1,
           updated_at = ? WHERE contract_id = ?`,
      )
      .run(now, session.intentContract.id);
    this.database
      .prepare(
        `UPDATE clarify_sessions SET intent_contract_id = NULL, lifecycle = 'mapping',
           revision = revision + 1, updated_at = ? WHERE session_id = ?`,
      )
      .run(now, session.id);
  }

  private cancelClarifySessionInTransaction(sessionId: string, now: string): void {
    const session = this.getClarifySession(sessionId);
    if (!session) throw new Error(`Clarify session ${sessionId} does not exist`);
    if (session.intentContract && session.intentContract.status === "proposed") {
      this.database
        .prepare(
          `UPDATE intent_contracts SET status = 'superseded', revision = revision + 1,
             updated_at = ? WHERE contract_id = ?`,
        )
        .run(now, session.intentContract.id);
    }
    this.database
      .prepare(
        `UPDATE clarify_sessions SET lifecycle = 'canceled', revision = revision + 1,
           updated_at = ? WHERE session_id = ?`,
      )
      .run(now, session.id);
  }

  applyTaskContractRevisionFromHandoff(input: {
    taskId: string;
    sourceAgentWorkspaceId: string;
    sourceAgentId: string;
    decisionRequestId: string;
    contract: IntentContractProjection;
    decisionRecordIds: string[];
    commandId: string;
  }): { task: TaskProjection; duplicate: boolean } {
    if (input.decisionRecordIds.length === 0) {
      throw new Error("Task contract revision requires at least one recorded Human decision");
    }
    let result!: { task: TaskProjection; duplicate: boolean };
    this.transaction(() => {
      const prior = this.database
        .prepare("SELECT result_json FROM authority_commands WHERE command_id = ?")
        .get(input.commandId) as { result_json: string } | undefined;
      if (prior) {
        const recorded = JSON.parse(prior.result_json) as { taskId: string };
        if (recorded.taskId !== input.taskId) {
          throw new WorkspaceAuthorityConflictError(
            `Command ${input.commandId} belongs to another Task`,
          );
        }
        const task = this.getTask(input.taskId);
        if (!task) throw new Error(`Task ${input.taskId} disappeared after its handoff command`);
        result = { task, duplicate: true };
        return;
      }

      const now = nowIso();
      const task = this.getTask(input.taskId);
      const pendingDecision = task ? this.getPendingTaskDecision(task.id) : null;
      if (
        !task ||
        task.sourceAgentWorkspaceId !== input.sourceAgentWorkspaceId ||
        task.sourceAgentId !== input.sourceAgentId ||
        pendingDecision?.id !== input.decisionRequestId ||
        pendingDecision.kind !== "contract_change"
      ) {
        throw new WorkspaceAuthorityConflictError(
          "Task contract decision changed before the clarified contract was committed.",
        );
      }
      const revisedContract = IntentContractProjectionSchema.parse({
        ...input.contract,
        workspaceId: task.workspaceId,
        sourceAgentId: task.sourceAgentId,
        taskId: task.id,
        humanDecisionRefs: [
          ...new Set([
            ...task.intentContract.humanDecisionRefs,
            ...input.contract.humanDecisionRefs,
            ...input.decisionRecordIds,
          ]),
        ],
        status: "confirmed",
        revision: task.intentContract.revision + 1,
        confirmedAt: now,
        updatedAt: now,
      });
      this.database
        .prepare(
          `UPDATE intent_contracts SET status = 'superseded', revision = revision + 1,
             updated_at = ? WHERE contract_id = ?`,
        )
        .run(now, task.intentContract.id);
      const mutation = this.transition(
        this.authorityState({ task, pendingDecision }),
        {
          type: "task.contract.revised",
          decisionRequestId: input.decisionRequestId,
          decisionRecordId: input.decisionRecordIds.at(-1)!,
          expectedRevision: task.revision,
          contract: revisedContract,
        },
        now,
      );
      this.applyAuthorityMutationInTransaction(mutation);
      this.database
        .prepare(
          `INSERT INTO authority_commands(
             command_id, aggregate_type, aggregate_id, command_kind,
             result_revision, result_json, created_at
           ) VALUES (?, 'task', ?, 'clarify_contract_revision', ?, ?, ?)`,
        )
        .run(
          input.commandId,
          task.id,
          mutation.task.revision,
          JSON.stringify({ taskId: task.id }),
          now,
        );
      result = { task: mutation.task, duplicate: false };
    });
    if (!result.duplicate) {
      this.syncTaskLocator(result.task);
      this.emit([result.task.id], []);
    }
    return result;
  }

  finishTaskClarifyHandoff(turnId: string, status: "completed" | "canceled"): boolean {
    let changed = false;
    this.transaction(() => {
      const current = this.getTaskClarifyHandoff(turnId);
      if (!current) throw new Error(`Task Clarify handoff for turn ${turnId} does not exist`);
      if (current.status === status) return;
      if (current.status !== "active") {
        throw new WorkspaceAuthorityConflictError(
          `Task Clarify handoff for turn ${turnId} is already ${current.status}.`,
        );
      }
      this.finishTaskClarifyHandoffInTransaction(turnId, status, nowIso());
      changed = true;
    });
    return changed;
  }

  private finishTaskClarifyHandoffInTransaction(
    turnId: string,
    status: "completed" | "canceled",
    now: string,
  ): void {
    const updated = this.database
      .prepare(
        `UPDATE task_clarify_handoffs SET status = ?, completed_at = ?
         WHERE turn_id = ? AND status = 'active'`,
      )
      .run(status, now, turnId);
    if (updated.changes !== 1) {
      throw new WorkspaceAuthorityConflictError(
        `Task Clarify handoff for turn ${turnId} is no longer active.`,
      );
    }
  }

  prioritizeClarifyNode(input: {
    sessionId: string;
    nodeId: string;
    expectedRevision: number;
    commandId: string;
  }): { session: ClarifySessionProjection; duplicate: boolean } {
    let duplicate = false;
    this.transaction(() => {
      const previous = this.database
        .prepare("SELECT result_json FROM authority_commands WHERE command_id = ?")
        .get(input.commandId) as { result_json: string } | undefined;
      if (previous) {
        const result = JSON.parse(previous.result_json) as { sessionId: string; nodeId: string };
        if (result.sessionId !== input.sessionId || result.nodeId !== input.nodeId) {
          throw new WorkspaceAuthorityConflictError(
            `Command ${input.commandId} belongs to another Clarify action`,
          );
        }
        duplicate = true;
        return;
      }
      const session = this.getClarifySession(input.sessionId);
      if (!session || session.revision !== input.expectedRevision) {
        throw new WorkspaceAuthorityConflictError("Clarify session revision changed");
      }
      const node = session.nodes.find((candidate) => candidate.id === input.nodeId);
      if (!node || !["open", "awaiting_human"].includes(node.status)) {
        throw new Error(`Decision node ${input.nodeId} is not an open frontier`);
      }
      const maximum = session.nodes.reduce(
        (value, candidate) => Math.max(value, candidate.priority),
        0,
      );
      const now = nowIso();
      this.database
        .prepare(
          `UPDATE clarify_decision_nodes SET priority = ?, revision = revision + 1,
             updated_at = ? WHERE session_id = ? AND node_id = ?`,
        )
        .run(maximum + 1, now, session.id, node.id);
      this.database
        .prepare(
          `UPDATE clarify_sessions SET priority_node_id = ?, revision = revision + 1,
             updated_at = ? WHERE session_id = ?`,
        )
        .run(node.id, now, session.id);
      this.database
        .prepare(
          `INSERT INTO authority_commands(
             command_id, aggregate_type, aggregate_id, command_kind,
             result_revision, result_json, created_at
           ) VALUES (?, 'clarify_session', ?, 'prioritize_node', ?, ?, ?)`,
        )
        .run(
          input.commandId,
          session.id,
          session.revision + 1,
          JSON.stringify({ sessionId: session.id, nodeId: node.id }),
          now,
        );
    });
    const session = this.getClarifySession(input.sessionId)!;
    if (!duplicate) this.emitClarify(session, [input.nodeId]);
    return { session, duplicate };
  }

  registerTask(input: {
    task: TaskProjection;
    sourceTurnId: string;
    sourceContractCardId: string;
    providerProfileId: string;
  }): { task: TaskProjection; created: boolean } {
    const task = TaskProjectionSchema.parse(input.task);
    if (task.workspaceId !== this.workspaceId) {
      throw new Error("Task workspace does not match authority shard");
    }
    let result!: { task: TaskProjection; created: boolean };
    this.transaction(() => {
      const existing = this.database
        .prepare(`SELECT * FROM tasks WHERE source_turn_id = ? AND source_contract_card_id = ?`)
        .get(input.sourceTurnId, input.sourceContractCardId) as TaskRow | undefined;
      if (existing) {
        result = { task: this.toTaskProjection(existing), created: false };
        return;
      }
      this.writeIntentContractInTransaction(task.intentContract);
      this.database
        .prepare(
          `INSERT INTO tasks(
             task_id, workspace_id, source_agent_workspace_id, source_agent_id, execution_mode, title,
             intent_contract_id, status, summary, current_execution_id,
             current_work_unit_id, completion_authority, source_turn_id,
             source_contract_card_id, provider_profile_id, origin_json, budget_strength,
             used_non_complete_reviews, max_non_complete_reviews, active_duration_ms,
             token_count, tool_call_count, pending_control, revision, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          task.id,
          task.workspaceId,
          task.sourceAgentWorkspaceId,
          task.sourceAgentId,
          task.mode,
          task.title,
          task.intentContract.id,
          task.status,
          task.summary,
          task.currentExecutionId,
          task.currentWorkUnitId,
          task.completionAuthority,
          input.sourceTurnId,
          input.sourceContractCardId,
          input.providerProfileId,
          task.origin ? JSON.stringify(task.origin) : null,
          task.budget.strength,
          task.budget.usedNonCompleteReviews,
          task.budget.maxNonCompleteReviews,
          task.budget.activeDurationMs,
          task.budget.tokenCount,
          task.budget.toolCallCount,
          task.pendingControl,
          task.revision,
          task.createdAt,
          task.updatedAt,
        );
      this.writeWorkingSetInTransaction(task.workingSet);
      this.database
        .prepare("UPDATE turns SET task_id = ? WHERE turn_id = ?")
        .run(task.id, input.sourceTurnId);
      this.database
        .prepare("UPDATE cards SET task_id = ? WHERE turn_id = ?")
        .run(task.id, input.sourceTurnId);
      this.database
        .prepare("UPDATE human_decisions SET task_id = ? WHERE turn_id = ? AND task_id IS NULL")
        .run(task.id, input.sourceTurnId);
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

  getIntentContract(contractId: string): IntentContractProjection | null {
    return this.readIntentContract(contractId);
  }

  getTaskRuntimeMetadata(taskId: string): TaskRuntimeMetadata | null {
    const row = this.database
      .prepare(
        `SELECT source_turn_id, source_contract_card_id, provider_profile_id
         FROM tasks WHERE task_id = ?`,
      )
      .get(taskId) as
      | {
          source_turn_id: string | null;
          source_contract_card_id: string | null;
          provider_profile_id: string | null;
        }
      | undefined;
    if (!row || !row.source_turn_id || !row.source_contract_card_id || !row.provider_profile_id) {
      return null;
    }
    return {
      sourceTurnId: row.source_turn_id,
      sourceContractCardId: row.source_contract_card_id,
      providerProfileId: row.provider_profile_id,
    };
  }

  listTasks(): TaskProjection[] {
    const rows = this.database
      .prepare("SELECT * FROM tasks ORDER BY updated_at DESC")
      .all() as TaskRow[];
    return rows.map((row) => this.toTaskProjection(row));
  }

  getNextMutationTask(): TaskProjection | null {
    return (
      this.listTasks()
        .filter(
          (task) =>
            (task.mode === "quick" && task.status === "queued") ||
            (task.mode === "loop" && ["queued", "reorienting"].includes(task.status)),
        )
        .sort(
          (left, right) =>
            left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
        )[0] ?? null
    );
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
    cycle?: {
      id: string;
      status: "active" | "reviewing";
      startedAt: string;
    };
    workUnit?: WorkUnitProjection;
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
      if (input.cycle) {
        const order = Number(
          (
            this.database
              .prepare(
                "SELECT COALESCE(MAX(cycle_order), 0) + 1 AS value FROM loop_cycles WHERE task_id = ?",
              )
              .get(execution.taskId) as { value: number }
          ).value,
        );
        this.database
          .prepare(
            `INSERT INTO loop_cycles(
               cycle_id, task_id, cycle_order, status, started_at, completed_at
             ) VALUES (?, ?, ?, ?, ?, NULL)`,
          )
          .run(input.cycle.id, execution.taskId, order, input.cycle.status, input.cycle.startedAt);
      }
      if (input.workUnit) this.insertWorkUnitInTransaction(input.workUnit);
      this.database
        .prepare(
          `INSERT INTO execution_attempts(
             execution_id, task_id, work_unit_id, cycle_id, phase_kind, provider_thread_id,
             status, generation, run_mode_receipt_json,
             started_at, last_activity_at, completed_at, summary, revision
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          execution.id,
          execution.taskId,
          execution.workUnitId,
          execution.cycleId,
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
        this.authorityState({
          task: input.workUnit ? { ...task, workUnits: [...task.workUnits, input.workUnit] } : task,
        }),
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

  findLatestExecuteThread(taskId: string): ProviderThreadRecord | null {
    const row = this.database
      .prepare(
        `SELECT provider_threads.* FROM execution_attempts
         JOIN provider_threads ON provider_threads.thread_id = execution_attempts.provider_thread_id
         WHERE execution_attempts.task_id = ?
           AND execution_attempts.phase_kind = 'execute'
           AND provider_threads.status IN ('active', 'resumable')
         ORDER BY execution_attempts.started_at DESC LIMIT 1`,
      )
      .get(taskId) as Record<string, unknown> | undefined;
    return row ? this.getProviderThread(String(row.thread_id)) : null;
  }

  findLatestExecuteLineageThread(taskId: string): ProviderThreadRecord | null {
    const row = this.database
      .prepare(
        `SELECT provider_threads.* FROM execution_attempts
         JOIN provider_threads ON provider_threads.thread_id = execution_attempts.provider_thread_id
         WHERE execution_attempts.task_id = ?
           AND execution_attempts.phase_kind = 'execute'
         ORDER BY execution_attempts.started_at DESC LIMIT 1`,
      )
      .get(taskId) as Record<string, unknown> | undefined;
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
      const mutation = this.transition(
        this.authorityState({ task, execution }),
        {
          type: "execution.quick.settled",
          generation: input.generation,
          status: input.status,
          summary: input.summary,
        },
        undefined,
        { evidenceId: `evidence-quick-${input.executionId}` },
      );
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
  acceptExecutorCheckpoint(input: {
    executionId: string;
    generation: string;
    checkpoint: ThothLoopCheckpointInput;
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
        this.authorityState({ task, execution }),
        {
          type: "execution.checkpoint.completed",
          generation: input.generation,
          checkpoint: input.checkpoint,
        },
        undefined,
        {
          evidenceId: `evidence-checkpoint-${input.callId}`,
        },
      );
      this.applyAuthorityMutationInTransaction(mutation);
      taskId = task.id;
    });
    const task = this.getTask(taskId)!;
    this.syncTaskLocator(task);
    this.emit([taskId], [input.executionId]);
    return true;
  }
  acceptReviewDecision(input: {
    executionId: string;
    generation: string;
    review: ThothLoopReviewDecisionInput;
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
        this.authorityState({ task, execution }),
        {
          type: "execution.review.completed",
          generation: input.generation,
          review: input.review,
        },
        undefined,
        {
          reviewDecisionId: `review-decision-${input.callId}`,
          decisionRequestId: `task-decision-${input.callId}`,
        },
      );
      this.applyAuthorityMutationInTransaction(mutation);
      taskId = task.id;
    });
    this.syncTaskLocator(this.getTask(taskId)!);
    this.emit([taskId], [input.executionId]);
    return true;
  }
  requestExecutionHumanDecision(input: {
    executionId: string;
    generation: string;
    request: ThothLoopRequestHumanDecisionInput;
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
        this.authorityState({ task, execution }),
        {
          type: "execution.human_decision.requested",
          generation: input.generation,
          request: input.request,
        },
        undefined,
        { decisionRequestId: `task-decision-${input.callId}` },
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
      const mutation = this.transition(
        this.authorityState({ task, execution }),
        {
          type: "execution.blocked",
          generation: input.generation,
          report: input.report,
        },
        undefined,
        { evidenceId: `evidence-blocker-${randomUUID()}` },
      );
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
    if (["execute", "review"].includes(execution.phase) && projection.bundleId !== "thoth.loop") {
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

  listEvidence(taskId: string): EvidenceRef[] {
    const rows = this.database
      .prepare(
        "SELECT * FROM evidence_refs WHERE task_id = ? ORDER BY created_at ASC, evidence_id ASC",
      )
      .all(taskId) as Array<Record<string, unknown>>;
    return rows.map((row) =>
      EvidenceRefSchema.parse({
        id: String(row.evidence_id),
        taskId: String(row.task_id),
        executionId: row.execution_id ?? null,
        workUnitId: row.work_unit_id ?? null,
        kind: row.kind,
        summary: row.summary,
        contentDigest: String(row.content_digest),
        artifactRef: row.artifact_ref ?? null,
        createdAt: String(row.created_at),
      }),
    );
  }

  listReviewDecisions(taskId: string): ReviewDecisionProjection[] {
    const rows = this.database
      .prepare(
        "SELECT * FROM review_decisions WHERE task_id = ? ORDER BY created_at ASC, review_decision_id ASC",
      )
      .all(taskId) as Array<Record<string, unknown>>;
    return rows.map((row) => this.toReviewDecision(row));
  }

  listDecisions(taskId: string): HumanDecisionRecord[] {
    const rows = this.database
      .prepare("SELECT * FROM human_decisions WHERE task_id = ? ORDER BY decided_at ASC")
      .all(taskId) as Array<Record<string, unknown>>;
    return rows.map((row) => this.toDecision(row));
  }

  getDecision(decisionId: string): HumanDecisionRecord | null {
    const row = this.database
      .prepare("SELECT * FROM human_decisions WHERE decision_id = ?")
      .get(decisionId) as Record<string, unknown> | undefined;
    return row ? this.toDecision(row) : null;
  }

  listTurnDecisions(turnId: string): HumanDecisionRecord[] {
    const rows = this.database
      .prepare(
        "SELECT * FROM human_decisions WHERE turn_id = ? ORDER BY decided_at ASC, decision_id ASC",
      )
      .all(turnId) as Array<Record<string, unknown>>;
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
      evidence: this.listEvidence(taskId),
      generatedAt: nowIso(),
    });
  }

  bindTaskContextSnapshots(input: {
    agentId: string;
    turnId: string;
    contexts: TaskContextEnvelope[];
  }): TaskContextEnvelope[] {
    const contexts = input.contexts.map((context) => TaskContextEnvelopeSchema.parse(context));
    this.transaction(() => {
      const turn = this.getForegroundTurnInTransaction(input.turnId);
      if (!turn || turn.agentId !== input.agentId) {
        throw new WorkspaceAuthorityConflictError(
          `Foreground turn ${input.turnId} no longer belongs to Agent ${input.agentId}`,
        );
      }
      const insert = this.database.prepare(
        `INSERT OR IGNORE INTO context_bindings(
           binding_id, agent_id, turn_id, task_workspace_id, task_id,
           task_revision, context_digest, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const context of contexts) {
        const snapshot = this.blobs.putJson(context);
        insert.run(
          `context-binding-${randomUUID()}`,
          input.agentId,
          input.turnId,
          context.reference.workspaceId,
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

  listTurnTaskContextReferences(turnId: string): TaskContextReference[] {
    const rows = this.database
      .prepare(
        `SELECT task_workspace_id, task_id, task_revision FROM context_bindings
         WHERE turn_id = ? ORDER BY created_at ASC`,
      )
      .all(turnId) as Array<{
      task_workspace_id: string;
      task_id: string;
      task_revision: number;
    }>;
    return rows.map((row) => ({
      kind: "task",
      workspaceId: row.task_workspace_id,
      taskId: row.task_id,
      revision: row.task_revision,
    }));
  }

  listLatestTurnTaskContexts(turnId: string): TaskContextEnvelope[] {
    const rows = this.database
      .prepare(
        `SELECT task_workspace_id, task_id FROM context_bindings
         WHERE turn_id = ? ORDER BY created_at ASC`,
      )
      .all(turnId) as Array<{ task_workspace_id: string; task_id: string }>;
    return rows.map((row) => {
      if (row.task_workspace_id !== this.workspaceId) {
        throw new Error(
          `Bound Task ${row.task_id} requires Workspace manager resolution from ${row.task_workspace_id}`,
        );
      }
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

  getProviderQuestionCommandResult(input: {
    agentId: string;
    interactionId: string;
    commandId: string;
  }): { revision: number; result: unknown } | null {
    const row = this.database
      .prepare(
        `SELECT aggregate_type, aggregate_id, command_kind, result_revision, result_json
           FROM authority_commands WHERE command_id = ?`,
      )
      .get(input.commandId) as
      | {
          aggregate_type: string;
          aggregate_id: string;
          command_kind: string;
          result_revision: number;
          result_json: string;
        }
      | undefined;
    if (!row) return null;
    if (
      row.aggregate_type !== "agent" ||
      row.aggregate_id !== input.agentId ||
      row.command_kind !== `provider_question:${input.interactionId}`
    ) {
      throw new WorkspaceAuthorityConflictError(
        `Command ${input.commandId} already belongs to another authority action`,
      );
    }
    return { revision: row.result_revision, result: JSON.parse(row.result_json) as unknown };
  }

  recordProviderQuestionCommand(input: {
    agentId: string;
    interactionId: string;
    commandId: string;
    resultRevision: number;
    result: unknown;
    receipt: {
      resolutionType: "answer" | "dismiss";
      answeredQuestionIds: string[];
      nonSecretAnswerDigest: string | null;
      secretQuestionCount: number;
    };
  }): { revision: number; result: unknown; duplicate: boolean } {
    let output!: { revision: number; result: unknown; duplicate: boolean };
    this.transaction(() => {
      const existing = this.getProviderQuestionCommandResult(input);
      if (existing) {
        output = { ...existing, duplicate: true };
        return;
      }
      const stored = { result: input.result, receipt: input.receipt };
      this.database
        .prepare(
          `INSERT INTO authority_commands(
             command_id, aggregate_type, aggregate_id, command_kind,
             result_revision, result_json, created_at
           ) VALUES (?, 'agent', ?, ?, ?, ?, ?)`,
        )
        .run(
          input.commandId,
          input.agentId,
          `provider_question:${input.interactionId}`,
          input.resultRevision,
          JSON.stringify(stored),
          nowIso(),
        );
      output = { revision: input.resultRevision, result: stored, duplicate: false };
    });
    return output;
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
    this.clarifySubscribers.clear();
    this.database.close();
  }

  private toClarifySession(row: Record<string, unknown>): ClarifySessionProjection {
    const nodes = this.database
      .prepare(
        `SELECT * FROM clarify_decision_nodes WHERE session_id = ?
         ORDER BY priority DESC, created_at ASC, node_id ASC`,
      )
      .all(String(row.session_id)) as Array<Record<string, unknown>>;
    const contractId = typeof row.intent_contract_id === "string" ? row.intent_contract_id : null;
    return ClarifySessionProjectionSchema.parse({
      id: row.session_id,
      workspaceId: row.workspace_id,
      agentId: row.agent_id,
      turnId: row.turn_id,
      requestedStrength: row.requested_strength,
      effectiveStrength: row.effective_strength ?? null,
      lifecycle: row.lifecycle,
      challengerUsed: Number(row.challenger_used) === 1,
      priorityNodeId: row.priority_node_id ?? null,
      intentContract: contractId ? this.readIntentContract(contractId) : null,
      nodes: nodes.map((node) =>
        ClarifyDecisionNodeProjectionSchema.parse({
          id: node.node_id,
          parentIds: parseStringArray(String(node.parent_ids_json)),
          title: node.title,
          owner: node.owner,
          materiality: node.materiality,
          status: node.status,
          resolutionRef: node.resolution_ref ?? null,
          sourceRefs: parseStringArray(String(node.source_refs_json)),
          priority: node.priority,
          revision: node.revision,
        }),
      ),
      revision: row.revision,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  private assertClarifyNodeResolution(
    node: Pick<
      ClarifyDecisionNodeProjection,
      "id" | "owner" | "status" | "resolutionRef" | "sourceRefs"
    >,
  ): void {
    if (node.owner === "evidence" && node.status === "resolved") {
      if (
        node.sourceRefs.length === 0 ||
        node.sourceRefs.some(
          (source) => !source.startsWith("workspace:") && !source.startsWith("evidence:"),
        )
      ) {
        throw new Error(
          `Evidence-owned Decision node ${node.id} requires Workspace evidence source refs`,
        );
      }
    }
    if (["resolved", "delegated"].includes(node.status) && !node.resolutionRef) {
      throw new Error(`Resolved Decision node ${node.id} requires a resolution ref`);
    }
    if (["open", "awaiting_human", "pruned"].includes(node.status) && node.resolutionRef) {
      throw new Error(`Open or pruned Decision node ${node.id} cannot carry a resolution ref`);
    }
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
               AND kind IN ('clarify_card', 'intent_contract_card')
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
         WHERE cards.card_id = ?
           AND cards.kind IN ('clarify_card', 'intent_contract_card')`,
      )
      .get(cardId) as Record<string, unknown> | undefined;
    return row ? this.toForegroundCard(row) : null;
  }

  private listForegroundCardsForTurnInTransaction(turnId: string): ForegroundCardAuthorityRecord[] {
    const rows = this.database
      .prepare(
        `SELECT cards.*, turns.agent_id FROM cards
         JOIN turns ON turns.turn_id = cards.turn_id
         WHERE cards.turn_id = ?
           AND cards.kind IN ('clarify_card', 'intent_contract_card')
         ORDER BY cards.created_at ASC`,
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
      providerPlanReceipt:
        typeof row.provider_plan_receipt_json === "string"
          ? (JSON.parse(
              row.provider_plan_receipt_json,
            ) as import("@thoth/protocol/agent-types").ProviderPlanCompleted)
          : null,
      providerInteraction:
        typeof row.provider_interaction_json === "string"
          ? (JSON.parse(
              row.provider_interaction_json,
            ) as import("@thoth/core").ProviderTurnInteractionState)
          : null,
      providerInteractionRevision:
        typeof row.provider_interaction_revision === "number"
          ? row.provider_interaction_revision
          : 0,
      runtimeAttachment:
        typeof row.runtime_attachment_json === "string"
          ? (JSON.parse(row.runtime_attachment_json) as RuntimeAttachmentReceipt)
          : null,
      sourceMessageId: typeof row.source_message_id === "string" ? row.source_message_id : null,
      taskId: typeof row.task_id === "string" ? row.task_id : null,
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
        : ThothIntentContractCardModelSchema.parse(rawCard);
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
    };
  }

  private transition(
    state: AuthorityState,
    command: AuthorityCommand,
    now = nowIso(),
    ids: DeterministicAuthorityInput["ids"] = {},
  ): AuthorityMutation {
    const deterministic: DeterministicAuthorityInput = {
      now,
      ids: {
        decisionId: `decision-${randomUUID()}`,
        decisionRequestId: `task-decision-${randomUUID()}`,
        evidenceId: `evidence-${randomUUID()}`,
        reviewDecisionId: `review-decision-${randomUUID()}`,
        ...ids,
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
    this.writeTaskProjectionInTransaction(mutation.task);
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
    for (const evidence of mutation.evidence) this.insertEvidenceInTransaction(evidence);
    if (mutation.reviewDecision) this.insertReviewDecisionInTransaction(mutation.reviewDecision);
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

  private writeTaskProjectionInTransaction(task: TaskProjection): void {
    this.writeIntentContractInTransaction(task.intentContract);
    const update = this.database
      .prepare(
        `UPDATE tasks SET title = ?, intent_contract_id = ?, status = ?, summary = ?,
           current_execution_id = ?, current_work_unit_id = ?, completion_authority = ?,
           origin_json = ?, budget_strength = ?, used_non_complete_reviews = ?,
           max_non_complete_reviews = ?, active_duration_ms = ?, token_count = ?,
           tool_call_count = ?, pending_control = ?, revision = ?, updated_at = ?
         WHERE task_id = ?`,
      )
      .run(
        task.title,
        task.intentContract.id,
        task.status,
        task.summary,
        task.currentExecutionId,
        task.currentWorkUnitId,
        task.completionAuthority,
        task.origin ? JSON.stringify(task.origin) : null,
        task.budget.strength,
        task.budget.usedNonCompleteReviews,
        task.budget.maxNonCompleteReviews,
        task.budget.activeDurationMs,
        task.budget.tokenCount,
        task.budget.toolCallCount,
        task.pendingControl,
        task.revision,
        task.updatedAt,
        task.id,
      );
    if (update.changes !== 1) throw new Error(`Task ${task.id} disappeared during mutation`);
    this.writeWorkingSetInTransaction(task.workingSet);
    for (const workUnit of task.workUnits) this.writeWorkUnitInTransaction(workUnit);
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

  private writeIntentContractInTransaction(contract: IntentContractProjection): void {
    const value = IntentContractProjectionSchema.parse(contract);
    this.database
      .prepare(
        `INSERT INTO intent_contracts(
           contract_id, workspace_id, source_agent_id, task_id, title, objective,
           non_goals_json, invariants_json, risk_boundary_json, human_decision_refs_json,
           escalation_policy_json, status, revision, confirmed_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(contract_id) DO UPDATE SET
           task_id = excluded.task_id,
           title = excluded.title,
           objective = excluded.objective,
           non_goals_json = excluded.non_goals_json,
           invariants_json = excluded.invariants_json,
           risk_boundary_json = excluded.risk_boundary_json,
           human_decision_refs_json = excluded.human_decision_refs_json,
           escalation_policy_json = excluded.escalation_policy_json,
           status = excluded.status,
           revision = excluded.revision,
           confirmed_at = excluded.confirmed_at,
           updated_at = excluded.updated_at`,
      )
      .run(
        value.id,
        value.workspaceId,
        value.sourceAgentId,
        value.taskId,
        value.title,
        value.objective,
        JSON.stringify(value.nonGoals),
        JSON.stringify(value.invariants),
        JSON.stringify(value.riskBoundary),
        JSON.stringify(value.humanDecisionRefs),
        JSON.stringify(value.escalationPolicy),
        value.status,
        value.revision,
        value.confirmedAt,
        value.createdAt,
        value.updatedAt,
      );
    const upsertClaim = this.database.prepare(
      `INSERT INTO acceptance_claims(
         claim_id, contract_id, claim_order, statement, status, revision
       ) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(claim_id) DO UPDATE SET
         contract_id = excluded.contract_id,
         claim_order = excluded.claim_order,
         statement = excluded.statement,
         status = excluded.status,
         revision = excluded.revision`,
    );
    value.acceptanceClaims.forEach((claim, index) => {
      upsertClaim.run(claim.id, value.id, index + 1, claim.statement, claim.status, claim.revision);
    });
    const claimIds = value.acceptanceClaims.map((claim) => claim.id);
    this.database
      .prepare(
        `DELETE FROM acceptance_claims
         WHERE contract_id = ? AND claim_id NOT IN (${claimIds.map(() => "?").join(", ")})`,
      )
      .run(value.id, ...claimIds);
  }

  private writeWorkingSetInTransaction(workingSet: TaskWorkingSetProjection): void {
    const value = TaskWorkingSetProjectionSchema.parse(workingSet);
    this.database
      .prepare(
        `INSERT INTO task_working_sets(
           task_id, active_gap, current_understanding, current_hypothesis, next_move,
           relevant_evidence_refs_json, rejected_routes_json, blockers_json,
           latest_review_decision_id, no_progress_count, revision, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(task_id) DO UPDATE SET
           active_gap = excluded.active_gap,
           current_understanding = excluded.current_understanding,
           current_hypothesis = excluded.current_hypothesis,
           next_move = excluded.next_move,
           relevant_evidence_refs_json = excluded.relevant_evidence_refs_json,
           rejected_routes_json = excluded.rejected_routes_json,
           blockers_json = excluded.blockers_json,
           latest_review_decision_id = excluded.latest_review_decision_id,
           no_progress_count = excluded.no_progress_count,
           revision = excluded.revision,
           updated_at = excluded.updated_at`,
      )
      .run(
        value.taskId,
        value.activeGap,
        value.currentUnderstanding,
        value.currentHypothesis,
        value.nextMove,
        JSON.stringify(value.relevantEvidenceRefs),
        JSON.stringify(value.rejectedRoutes),
        JSON.stringify(value.blockers),
        value.latestReviewDecisionId,
        value.noProgressCount,
        value.revision,
        value.updatedAt,
      );
  }

  private insertWorkUnitInTransaction(workUnit: WorkUnitProjection): void {
    const value = WorkUnitProjectionSchema.parse(workUnit);
    this.database
      .prepare(
        `INSERT INTO task_work_units(
           work_unit_id, task_id, cycle_id, title, active_gap, progress_claim,
           unresolved_gap, evidence_refs_json, status, revision, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        value.id,
        value.taskId,
        value.cycleId,
        value.title,
        value.activeGap,
        value.progressClaim,
        value.unresolvedGap,
        JSON.stringify(value.evidenceRefs),
        value.status,
        value.revision,
        value.createdAt,
        value.updatedAt,
      );
  }

  private writeWorkUnitInTransaction(workUnit: WorkUnitProjection): void {
    const value = WorkUnitProjectionSchema.parse(workUnit);
    const updated = this.database
      .prepare(
        `UPDATE task_work_units SET title = ?, active_gap = ?, progress_claim = ?,
           unresolved_gap = ?, evidence_refs_json = ?, status = ?, revision = ?, updated_at = ?
         WHERE work_unit_id = ?`,
      )
      .run(
        value.title,
        value.activeGap,
        value.progressClaim,
        value.unresolvedGap,
        JSON.stringify(value.evidenceRefs),
        value.status,
        value.revision,
        value.updatedAt,
        value.id,
      );
    if (updated.changes === 0) this.insertWorkUnitInTransaction(value);
  }

  private insertEvidenceInTransaction(input: AuthorityEvidenceAppend): EvidenceRef {
    const blob = this.blobs.putJson(input.content);
    const evidence = EvidenceRefSchema.parse({
      id: input.id,
      taskId: input.taskId,
      executionId: input.executionId,
      workUnitId: input.workUnitId,
      kind: input.kind,
      summary: input.summary,
      contentDigest: blob.digest,
      artifactRef: input.artifactRef,
      createdAt: input.createdAt,
    });
    this.database
      .prepare(
        `INSERT INTO evidence_refs(
           evidence_id, task_id, execution_id, work_unit_id, kind, summary,
           content_digest, artifact_ref, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        evidence.id,
        evidence.taskId,
        evidence.executionId,
        evidence.workUnitId,
        evidence.kind,
        evidence.summary,
        evidence.contentDigest,
        evidence.artifactRef,
        evidence.createdAt,
      );
    return evidence;
  }

  private insertReviewDecisionInTransaction(review: ReviewDecisionProjection): void {
    const value = ReviewDecisionProjectionSchema.parse(review);
    this.database
      .prepare(
        `INSERT INTO review_decisions(
           review_decision_id, task_id, cycle_id, execution_id, decision, reason,
           evidence_refs_json, next_focus, rejected_routes_json,
           acceptance_evidence_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        value.id,
        value.taskId,
        value.cycleId,
        value.executionId,
        value.decision,
        value.reason,
        JSON.stringify(value.evidenceRefs),
        value.nextFocus,
        JSON.stringify(value.rejectedRoutes),
        JSON.stringify(value.acceptanceEvidence),
        value.createdAt,
      );
    const insertEvidence = this.database.prepare(
      `INSERT OR IGNORE INTO acceptance_evidence(
         claim_id, evidence_id, review_decision_id, created_at
       ) VALUES (?, ?, ?, ?)`,
    );
    for (const [claimId, evidenceIds] of Object.entries(value.acceptanceEvidence)) {
      for (const evidenceId of evidenceIds) {
        insertEvidence.run(claimId, evidenceId, value.id, value.createdAt);
      }
    }
    this.database
      .prepare(`UPDATE loop_cycles SET status = ?, completed_at = ? WHERE cycle_id = ?`)
      .run(
        value.decision === "continue" || value.decision === "reorient"
          ? "completed"
          : value.decision === "blocked"
            ? "blocked"
            : "completed",
        value.createdAt,
        value.cycleId,
      );
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
    const contract = this.readIntentContract(row.intent_contract_id);
    if (!contract)
      throw new Error(`Task ${row.task_id} is missing Intent Contract ${row.intent_contract_id}`);
    const workingSet = this.readWorkingSet(row.task_id);
    if (!workingSet) throw new Error(`Task ${row.task_id} is missing its Working Set`);
    const workUnits = this.database
      .prepare(
        "SELECT * FROM task_work_units WHERE task_id = ? ORDER BY created_at ASC, work_unit_id ASC",
      )
      .all(row.task_id) as Array<Record<string, unknown>>;
    const latestReviewRow = this.database
      .prepare(
        `SELECT * FROM review_decisions WHERE task_id = ?
         ORDER BY created_at DESC, review_decision_id DESC LIMIT 1`,
      )
      .get(row.task_id) as Record<string, unknown> | undefined;
    return TaskProjectionSchema.parse({
      id: row.task_id,
      workspaceId: row.workspace_id,
      sourceAgentWorkspaceId: row.source_agent_workspace_id,
      sourceAgentId: row.source_agent_id,
      mode: row.execution_mode,
      title: row.title,
      intentContract: contract,
      status: row.status,
      summary: row.summary,
      currentExecutionId: row.current_execution_id,
      currentWorkUnitId: row.current_work_unit_id,
      workingSet,
      workUnits: workUnits.map((workUnit) => this.toWorkUnit(workUnit)),
      latestReview: latestReviewRow ? this.toReviewDecision(latestReviewRow) : null,
      completionAuthority: row.completion_authority,
      origin: row.origin_json ? TaskOriginSchema.parse(JSON.parse(row.origin_json)) : null,
      pendingDecision: this.getPendingTaskDecision(row.task_id),
      budget: {
        strength: row.budget_strength,
        usedNonCompleteReviews: row.used_non_complete_reviews,
        maxNonCompleteReviews: row.max_non_complete_reviews,
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

  private readIntentContract(contractId: string): IntentContractProjection | null {
    const row = this.database
      .prepare("SELECT * FROM intent_contracts WHERE contract_id = ?")
      .get(contractId) as Record<string, unknown> | undefined;
    if (!row) return null;
    const claims = this.database
      .prepare("SELECT * FROM acceptance_claims WHERE contract_id = ? ORDER BY claim_order ASC")
      .all(contractId) as Array<Record<string, unknown>>;
    const evidenceForClaim = this.database.prepare(
      "SELECT evidence_id FROM acceptance_evidence WHERE claim_id = ? ORDER BY created_at, evidence_id",
    );
    return IntentContractProjectionSchema.parse({
      id: row.contract_id,
      workspaceId: row.workspace_id,
      sourceAgentId: row.source_agent_id,
      taskId: row.task_id ?? null,
      title: row.title,
      objective: row.objective,
      nonGoals: parseStringArray(String(row.non_goals_json)),
      invariants: parseStringArray(String(row.invariants_json)),
      acceptanceClaims: claims.map((claim) => ({
        id: claim.claim_id,
        statement: claim.statement,
        status: claim.status,
        evidenceRefs: (
          evidenceForClaim.all(String(claim.claim_id)) as Array<{ evidence_id: string }>
        ).map((evidence) => evidence.evidence_id),
        revision: claim.revision,
      })),
      riskBoundary: parseStringArray(String(row.risk_boundary_json)),
      humanDecisionRefs: parseStringArray(String(row.human_decision_refs_json)),
      escalationPolicy: JSON.parse(String(row.escalation_policy_json)),
      status: row.status,
      revision: row.revision,
      confirmedAt: row.confirmed_at ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  private readWorkingSet(taskId: string): TaskWorkingSetProjection | null {
    const row = this.database
      .prepare("SELECT * FROM task_working_sets WHERE task_id = ?")
      .get(taskId) as Record<string, unknown> | undefined;
    return row
      ? TaskWorkingSetProjectionSchema.parse({
          taskId: row.task_id,
          activeGap: row.active_gap,
          currentUnderstanding: row.current_understanding,
          currentHypothesis: row.current_hypothesis,
          nextMove: row.next_move,
          relevantEvidenceRefs: parseStringArray(String(row.relevant_evidence_refs_json)),
          rejectedRoutes: parseStringArray(String(row.rejected_routes_json)),
          blockers: parseStringArray(String(row.blockers_json)),
          latestReviewDecisionId: row.latest_review_decision_id ?? null,
          noProgressCount: row.no_progress_count,
          revision: row.revision,
          updatedAt: row.updated_at,
        })
      : null;
  }

  private toWorkUnit(row: Record<string, unknown>): WorkUnitProjection {
    return WorkUnitProjectionSchema.parse({
      id: row.work_unit_id,
      taskId: row.task_id,
      cycleId: row.cycle_id,
      title: row.title,
      activeGap: row.active_gap,
      progressClaim: row.progress_claim,
      unresolvedGap: row.unresolved_gap,
      evidenceRefs: parseStringArray(String(row.evidence_refs_json)),
      status: row.status,
      revision: row.revision,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  private toReviewDecision(row: Record<string, unknown>): ReviewDecisionProjection {
    return ReviewDecisionProjectionSchema.parse({
      id: row.review_decision_id,
      taskId: row.task_id,
      cycleId: row.cycle_id,
      executionId: row.execution_id,
      decision: row.decision,
      reason: row.reason,
      evidenceRefs: parseStringArray(String(row.evidence_refs_json)),
      nextFocus: row.next_focus ?? null,
      rejectedRoutes: parseStringArray(String(row.rejected_routes_json)),
      acceptanceEvidence: JSON.parse(String(row.acceptance_evidence_json)),
      createdAt: row.created_at,
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
      workUnitId: row.work_unit_id,
      cycleId: row.cycle_id,
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

  private emitClarify(session: ClarifySessionProjection, changedNodeIds: string[]): void {
    const update: ClarifyAuthorityUpdate = {
      workspaceId: this.workspaceId,
      agentId: session.agentId,
      sessionId: session.id,
      revision: session.revision,
      changedNodeIds,
    };
    for (const subscriber of this.clarifySubscribers) subscriber(update);
    const state = this.getForegroundState(session.agentId);
    this.emitForeground(state, "decision_map_changed");
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
