import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export const STORAGE_LAYOUT_VERSION = 7;
export const SQLITE_SCHEMA_VERSION = 7;
export const CATALOG_MIGRATION_VERSION = 7;
export const AUTHORITY_MIGRATION_VERSION = 10;
export const STORAGE_LAYOUT_MARKER = "storage-layout.json";

export function catalogDatabasePath(thothHome: string): string {
  return path.join(thothHome, "catalog.sqlite");
}

export function workspaceDatabasePath(thothHome: string, workspaceId: string): string {
  return path.join(thothHome, "workspaces", workspaceId, "authority.sqlite");
}

export function openCatalogDatabase(thothHome: string): DatabaseSync {
  const filePath = catalogDatabasePath(thothHome);
  if (!existsSync(filePath)) createCatalogDatabase(filePath);
  const database = openDatabase(filePath);
  assertSchemaVersion(database, filePath);
  return database;
}

export function openWorkspaceDatabase(thothHome: string, workspaceId: string): DatabaseSync {
  const filePath = workspaceDatabasePath(thothHome, workspaceId);
  if (!existsSync(filePath)) createWorkspaceDatabase(filePath, workspaceId);
  const database = openDatabase(filePath);
  assertSchemaVersion(database, filePath);
  return database;
}

export function createCatalogDatabase(filePath: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const database = openDatabase(filePath);
  try {
    database.exec(CATALOG_SCHEMA);
    database
      .prepare(
        `INSERT INTO catalog_schema_migrations(version, checksum, applied_at)
        VALUES (?, 'decision-session-tree-v7-catalog', ?)`,
      )
      .run(CATALOG_MIGRATION_VERSION, new Date().toISOString());
    database.exec("PRAGMA user_version = " + String(SQLITE_SCHEMA_VERSION));
  } finally {
    database.close();
  }
}

export function createWorkspaceDatabase(filePath: string, workspaceId: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const database = openDatabase(filePath);
  try {
    database.exec(WORKSPACE_SCHEMA);
    const now = new Date().toISOString();
    database
      .prepare(
        `INSERT INTO authority_schema_migrations(version, checksum, applied_at)
        VALUES (?, 'decision-session-tree-v7', ?)`,
      )
      .run(AUTHORITY_MIGRATION_VERSION, now);
    database
      .prepare(
        `INSERT INTO workspace_meta(workspace_id, authority_revision, updated_at)
         VALUES (?, 0, ?)`,
      )
      .run(workspaceId, now);
    database.exec("PRAGMA user_version = " + String(SQLITE_SCHEMA_VERSION));
  } finally {
    database.close();
  }
}

export function configureDatabase(database: DatabaseSync): void {
  database.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
}

export function assertSchemaVersion(database: DatabaseSync, filePath: string): void {
  const row = database.prepare("PRAGMA user_version").get() as { user_version: number };
  if (row.user_version !== SQLITE_SCHEMA_VERSION) {
    throw new Error(
      "Unsupported SQLite schema " +
        String(row.user_version) +
        " at " +
        filePath +
        "; run storage migration first",
    );
  }
}

function openDatabase(filePath: string): DatabaseSync {
  const database = new DatabaseSync(filePath, { enableForeignKeyConstraints: true });
  configureDatabase(database);
  return database;
}

const CATALOG_SCHEMA = `
  CREATE TABLE catalog_schema_migrations (
    version INTEGER PRIMARY KEY NOT NULL,
    checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL
  ) STRICT;
  CREATE TABLE catalog_projects (
    project_id TEXT PRIMARY KEY NOT NULL,
    root_path TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL CHECK(kind IN ('git', 'non_git')),
    display_name TEXT NOT NULL,
    custom_name TEXT,
    archived_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;
  CREATE TABLE catalog_workspaces (
    workspace_id TEXT PRIMARY KEY NOT NULL,
    canonical_path TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('workspace', 'worktree')),
    parent_workspace_id TEXT,
    archived_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    project_id TEXT,
    registry_kind TEXT,
    title TEXT,
    branch TEXT,
    base_branch TEXT
  ) STRICT;
  CREATE TABLE catalog_provider_profiles (
    profile_id TEXT PRIMARY KEY NOT NULL,
    adapter_id TEXT NOT NULL,
    config_json TEXT NOT NULL,
    enabled INTEGER NOT NULL CHECK(enabled IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;
  CREATE TABLE catalog_settings (
    setting_key TEXT PRIMARY KEY NOT NULL,
    value_json TEXT NOT NULL,
    revision INTEGER NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;
  CREATE TABLE catalog_runtime_resource_leases (
    resource_kind TEXT NOT NULL,
    resource_key TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    owner_key TEXT NOT NULL,
    holder_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('reserved', 'active')),
    generation TEXT NOT NULL,
    value_json TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(resource_kind, resource_key),
    UNIQUE(resource_kind, workspace_id, owner_key)
  ) STRICT;
  CREATE TABLE catalog_task_locator (
    task_id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL,
    revision INTEGER NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(workspace_id) REFERENCES catalog_workspaces(workspace_id)
  ) STRICT;
  CREATE TABLE catalog_agent_locator (
    agent_id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(workspace_id) REFERENCES catalog_workspaces(workspace_id)
  ) STRICT;
  CREATE TABLE catalog_turn_locator (
    turn_id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(workspace_id) REFERENCES catalog_workspaces(workspace_id)
  ) STRICT;
  CREATE TABLE catalog_card_locator (
    card_id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    turn_id TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(workspace_id) REFERENCES catalog_workspaces(workspace_id)
  ) STRICT;
  CREATE INDEX catalog_task_locator_workspace_updated
    ON catalog_task_locator(workspace_id, updated_at DESC);
  CREATE INDEX catalog_runtime_resource_leases_expiry
    ON catalog_runtime_resource_leases(resource_kind, expires_at);
`;

const WORKSPACE_SCHEMA = `
  CREATE TABLE authority_schema_migrations (
    version INTEGER PRIMARY KEY NOT NULL,
    checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL
  ) STRICT;
  CREATE TABLE workspace_meta (
    workspace_id TEXT PRIMARY KEY NOT NULL,
    authority_revision INTEGER NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;
  CREATE TABLE agents (
    agent_id TEXT PRIMARY KEY NOT NULL,
    provider_thread_id TEXT,
    title TEXT,
    visible INTEGER NOT NULL CHECK(visible IN (0, 1)),
    authority_revision INTEGER NOT NULL DEFAULT 0,
    provider_run_mode TEXT NOT NULL DEFAULT 'default',
    provider_control_revision INTEGER NOT NULL DEFAULT 0,
    active_turn_id TEXT,
    thoth_lifecycle TEXT NOT NULL DEFAULT 'idle',
    background_task_id TEXT,
    error TEXT,
    provider TEXT,
    cwd TEXT,
    last_activity_at TEXT,
    last_user_message_at TEXT,
    labels_json TEXT,
    last_status TEXT,
    last_mode_id TEXT,
    config_json TEXT,
    runtime_info_json TEXT,
    features_json TEXT,
    persistence_json TEXT,
    last_error TEXT,
    requires_attention INTEGER,
    attention_reason TEXT,
    attention_timestamp TEXT,
    internal INTEGER,
    archived_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;
  CREATE TABLE provider_threads (
    thread_id TEXT PRIMARY KEY NOT NULL,
    adapter_id TEXT NOT NULL,
    native_handle TEXT,
    persistence_json TEXT,
    lineage_parent_id TEXT,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;
  CREATE TABLE turns (
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
    provider_plan_receipt_json TEXT,
    provider_interaction_json TEXT,
    provider_interaction_revision INTEGER NOT NULL DEFAULT 0,
    runtime_attachment_json TEXT,
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
  CREATE TABLE foreground_turn_queue (
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
  CREATE TABLE provider_message_anchors (
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
  CREATE TABLE cards (
    card_id TEXT PRIMARY KEY NOT NULL,
    turn_id TEXT NOT NULL,
    decision_session_id TEXT,
    task_id TEXT,
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    displayed_digest TEXT NOT NULL,
    answer_digest TEXT,
    submitted_summary TEXT,
    runtime_digest TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(turn_id) REFERENCES turns(turn_id),
    FOREIGN KEY(decision_session_id) REFERENCES decision_sessions(session_id) ON DELETE CASCADE
  ) STRICT;
  CREATE TABLE human_decisions (
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
  CREATE TABLE decision_sessions (
    session_id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    origin_turn_id TEXT NOT NULL,
    active_turn_id TEXT,
    requested_strength TEXT NOT NULL,
    effective_strength TEXT,
    lifecycle TEXT NOT NULL CHECK(lifecycle IN (
      'active', 'awaiting_human', 'ready_to_confirm', 'frozen', 'blocked', 'canceled'
    )),
    challenger_used INTEGER NOT NULL CHECK(challenger_used IN (0, 1)),
    root_node_id TEXT NOT NULL,
    priority_node_id TEXT,
    active_card_id TEXT,
    intent_contract_id TEXT,
    revision INTEGER NOT NULL,
    frozen_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(agent_id) REFERENCES agents(agent_id) ON DELETE CASCADE,
    FOREIGN KEY(origin_turn_id) REFERENCES turns(turn_id),
    FOREIGN KEY(active_turn_id) REFERENCES turns(turn_id),
    UNIQUE(intent_contract_id)
  ) STRICT;
  CREATE TABLE decision_session_turns (
    session_id TEXT NOT NULL,
    turn_id TEXT NOT NULL UNIQUE,
    turn_order INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(session_id, turn_id),
    FOREIGN KEY(session_id) REFERENCES decision_sessions(session_id) ON DELETE CASCADE,
    FOREIGN KEY(turn_id) REFERENCES turns(turn_id) ON DELETE CASCADE,
    UNIQUE(session_id, turn_order)
  ) STRICT;
  CREATE TABLE decision_tree_nodes (
    node_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    parent_id TEXT,
    title TEXT NOT NULL,
    summary TEXT,
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
    FOREIGN KEY(session_id) REFERENCES decision_sessions(session_id) ON DELETE CASCADE,
    FOREIGN KEY(session_id, parent_id) REFERENCES decision_tree_nodes(session_id, node_id)
      DEFERRABLE INITIALLY DEFERRED
  ) STRICT;
  CREATE TABLE decision_tree_cross_links (
    session_id TEXT NOT NULL,
    from_node_id TEXT NOT NULL,
    to_node_id TEXT NOT NULL,
    relation TEXT NOT NULL DEFAULT 'influences',
    created_at TEXT NOT NULL,
    PRIMARY KEY(session_id, from_node_id, to_node_id),
    FOREIGN KEY(session_id, from_node_id) REFERENCES decision_tree_nodes(session_id, node_id)
      ON DELETE CASCADE,
    FOREIGN KEY(session_id, to_node_id) REFERENCES decision_tree_nodes(session_id, node_id)
      ON DELETE CASCADE,
    CHECK(from_node_id <> to_node_id)
  ) STRICT;
  CREATE TABLE decision_tree_activity (
    session_id TEXT PRIMARY KEY NOT NULL,
    state TEXT NOT NULL CHECK(state IN (
      'understanding', 'investigating', 'expanding', 'challenging',
      'awaiting_human', 'ready_to_confirm', 'frozen', 'blocked'
    )),
    active_node_id TEXT,
    summary TEXT,
    started_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(session_id) REFERENCES decision_sessions(session_id) ON DELETE CASCADE,
    FOREIGN KEY(session_id, active_node_id) REFERENCES decision_tree_nodes(session_id, node_id)
      DEFERRABLE INITIALLY DEFERRED
  ) STRICT;
  CREATE TABLE intent_contracts (
    contract_id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL,
    source_agent_id TEXT NOT NULL,
    task_id TEXT,
    title TEXT NOT NULL,
    objective TEXT NOT NULL,
    non_goals_json TEXT NOT NULL,
    invariants_json TEXT NOT NULL,
    risk_boundary_json TEXT NOT NULL,
    human_decision_refs_json TEXT NOT NULL,
    escalation_policy_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('draft', 'proposed', 'confirmed', 'superseded', 'legacy')),
    revision INTEGER NOT NULL,
    confirmed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;
  CREATE TABLE acceptance_claims (
    claim_id TEXT PRIMARY KEY NOT NULL,
    contract_id TEXT NOT NULL,
    claim_order INTEGER NOT NULL,
    statement TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('open', 'supported', 'satisfied', 'reopened')),
    revision INTEGER NOT NULL,
    FOREIGN KEY(contract_id) REFERENCES intent_contracts(contract_id) ON DELETE CASCADE,
    UNIQUE(contract_id, claim_order)
  ) STRICT;
  CREATE TABLE tasks (
    task_id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL,
    source_agent_workspace_id TEXT NOT NULL,
    source_agent_id TEXT NOT NULL,
    execution_mode TEXT NOT NULL,
    title TEXT NOT NULL,
    intent_contract_id TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL,
    summary TEXT NOT NULL,
    current_execution_id TEXT,
    current_work_unit_id TEXT,
    completion_authority TEXT NOT NULL,
    source_turn_id TEXT,
    source_contract_card_id TEXT,
    provider_profile_id TEXT,
    origin_json TEXT,
    budget_strength TEXT NOT NULL DEFAULT 'single',
    used_non_complete_reviews INTEGER NOT NULL DEFAULT 0,
    max_non_complete_reviews INTEGER,
    active_duration_ms INTEGER NOT NULL DEFAULT 0,
    token_count INTEGER NOT NULL DEFAULT 0,
    tool_call_count INTEGER NOT NULL DEFAULT 0,
    pending_control TEXT,
    revision INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(intent_contract_id) REFERENCES intent_contracts(contract_id)
  ) STRICT;
  CREATE TABLE task_working_sets (
    task_id TEXT PRIMARY KEY NOT NULL,
    active_gap TEXT NOT NULL,
    current_understanding TEXT NOT NULL,
    current_hypothesis TEXT NOT NULL,
    next_move TEXT NOT NULL,
    relevant_evidence_refs_json TEXT NOT NULL,
    rejected_routes_json TEXT NOT NULL,
    blockers_json TEXT NOT NULL,
    latest_review_decision_id TEXT,
    no_progress_count INTEGER NOT NULL,
    revision INTEGER NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(task_id) REFERENCES tasks(task_id) ON DELETE CASCADE
  ) STRICT;
  CREATE TABLE loop_cycles (
    cycle_id TEXT PRIMARY KEY NOT NULL,
    task_id TEXT NOT NULL,
    cycle_order INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('active', 'reviewing', 'completed', 'reorienting', 'blocked', 'interrupted')),
    started_at TEXT NOT NULL,
    completed_at TEXT,
    FOREIGN KEY(task_id) REFERENCES tasks(task_id) ON DELETE CASCADE,
    UNIQUE(task_id, cycle_order)
  ) STRICT;
  CREATE TABLE task_work_units (
    work_unit_id TEXT PRIMARY KEY NOT NULL,
    task_id TEXT NOT NULL,
    cycle_id TEXT NOT NULL,
    title TEXT NOT NULL,
    active_gap TEXT NOT NULL,
    progress_claim TEXT NOT NULL,
    unresolved_gap TEXT NOT NULL,
    evidence_refs_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('active', 'completed', 'abandoned', 'blocked')),
    revision INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(task_id) REFERENCES tasks(task_id) ON DELETE CASCADE,
    FOREIGN KEY(cycle_id) REFERENCES loop_cycles(cycle_id) ON DELETE CASCADE
  ) STRICT;
  CREATE TABLE review_decisions (
    review_decision_id TEXT PRIMARY KEY NOT NULL,
    task_id TEXT NOT NULL,
    cycle_id TEXT NOT NULL,
    execution_id TEXT NOT NULL,
    decision TEXT NOT NULL CHECK(decision IN ('continue', 'reorient', 'complete', 'need_human', 'blocked')),
    reason TEXT NOT NULL,
    evidence_refs_json TEXT NOT NULL,
    next_focus TEXT,
    rejected_routes_json TEXT NOT NULL,
    acceptance_evidence_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(task_id) REFERENCES tasks(task_id) ON DELETE CASCADE,
    FOREIGN KEY(cycle_id) REFERENCES loop_cycles(cycle_id) ON DELETE CASCADE,
    FOREIGN KEY(execution_id) REFERENCES execution_attempts(execution_id) ON DELETE CASCADE
  ) STRICT;
  CREATE TABLE execution_attempts (
    execution_id TEXT PRIMARY KEY NOT NULL,
    task_id TEXT NOT NULL,
    work_unit_id TEXT,
    cycle_id TEXT,
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
    FOREIGN KEY(work_unit_id) REFERENCES task_work_units(work_unit_id),
    FOREIGN KEY(cycle_id) REFERENCES loop_cycles(cycle_id),
    FOREIGN KEY(provider_thread_id) REFERENCES provider_threads(thread_id)
  ) STRICT;
  CREATE TABLE execution_approvals (
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
  CREATE TABLE runtime_attachments (
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
  CREATE TABLE task_decision_requests (
    decision_id TEXT PRIMARY KEY NOT NULL,
    task_id TEXT NOT NULL,
    request_digest TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending', 'answered')),
    answer_decision_id TEXT,
    created_at TEXT NOT NULL,
    answered_at TEXT,
    FOREIGN KEY(task_id) REFERENCES tasks(task_id) ON DELETE CASCADE,
    UNIQUE(task_id, decision_id)
  ) STRICT;
  CREATE TABLE task_clarify_handoffs (
    turn_id TEXT PRIMARY KEY NOT NULL,
    task_workspace_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    decision_request_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('active', 'completed', 'canceled')),
    created_at TEXT NOT NULL,
    completed_at TEXT,
    FOREIGN KEY(turn_id) REFERENCES turns(turn_id) ON DELETE CASCADE,
    UNIQUE(task_workspace_id, task_id, decision_request_id)
  ) STRICT;
  CREATE TABLE context_bindings (
    binding_id TEXT PRIMARY KEY NOT NULL,
    agent_id TEXT NOT NULL,
    turn_id TEXT NOT NULL,
    task_workspace_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    task_revision INTEGER NOT NULL,
    context_digest TEXT,
    created_at TEXT NOT NULL
  ) STRICT;
  CREATE TABLE timeline_entries (
    execution_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    occurred_at TEXT NOT NULL,
    item_json TEXT,
    item_digest TEXT,
    PRIMARY KEY(execution_id, seq),
    FOREIGN KEY(execution_id) REFERENCES execution_attempts(execution_id) ON DELETE CASCADE
  ) STRICT;
  CREATE TABLE agent_timeline_meta (
    agent_id TEXT PRIMARY KEY NOT NULL,
    epoch TEXT NOT NULL,
    next_seq INTEGER NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(agent_id) REFERENCES agents(agent_id) ON DELETE CASCADE
  ) STRICT;
  CREATE TABLE agent_timeline_rows (
    agent_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    timestamp TEXT NOT NULL,
    item_json TEXT,
    item_digest TEXT,
    PRIMARY KEY(agent_id, seq),
    FOREIGN KEY(agent_id) REFERENCES agent_timeline_meta(agent_id) ON DELETE CASCADE,
    CHECK((item_json IS NOT NULL) != (item_digest IS NOT NULL))
  ) STRICT;
  CREATE TABLE evidence_refs (
    evidence_id TEXT PRIMARY KEY NOT NULL,
    task_id TEXT NOT NULL,
    execution_id TEXT,
    work_unit_id TEXT,
    kind TEXT NOT NULL,
    summary TEXT NOT NULL,
    content_digest TEXT NOT NULL,
    artifact_ref TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(task_id) REFERENCES tasks(task_id) ON DELETE CASCADE,
    FOREIGN KEY(execution_id) REFERENCES execution_attempts(execution_id) ON DELETE SET NULL,
    FOREIGN KEY(work_unit_id) REFERENCES task_work_units(work_unit_id) ON DELETE SET NULL
  ) STRICT;
  CREATE TABLE acceptance_evidence (
    claim_id TEXT NOT NULL,
    evidence_id TEXT NOT NULL,
    review_decision_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(claim_id, evidence_id, review_decision_id),
    FOREIGN KEY(claim_id) REFERENCES acceptance_claims(claim_id) ON DELETE CASCADE,
    FOREIGN KEY(evidence_id) REFERENCES evidence_refs(evidence_id) ON DELETE CASCADE,
    FOREIGN KEY(review_decision_id) REFERENCES review_decisions(review_decision_id) ON DELETE CASCADE
  ) STRICT;
  CREATE TABLE authority_commands (
    command_id TEXT PRIMARY KEY NOT NULL,
    aggregate_type TEXT NOT NULL,
    aggregate_id TEXT NOT NULL,
    command_kind TEXT NOT NULL,
    result_revision INTEGER NOT NULL,
    result_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  ) STRICT;
  CREATE TABLE foreground_continuations (
    turn_id TEXT NOT NULL,
    continuation_key TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(turn_id, continuation_key),
    FOREIGN KEY(turn_id) REFERENCES turns(turn_id) ON DELETE CASCADE
  ) STRICT;
  CREATE TABLE workspace_leases (
    lease_key TEXT PRIMARY KEY NOT NULL,
    task_id TEXT NOT NULL,
    execution_id TEXT,
    status TEXT NOT NULL,
    generation TEXT NOT NULL,
    expires_at TEXT,
    updated_at TEXT NOT NULL
  ) STRICT;
  CREATE TABLE chat_rooms (
    room_id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL UNIQUE,
    purpose TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;
  CREATE TABLE chat_messages (
    message_id TEXT PRIMARY KEY NOT NULL,
    room_id TEXT NOT NULL,
    author_agent_id TEXT NOT NULL,
    body TEXT NOT NULL,
    reply_to_message_id TEXT,
    mention_agent_ids_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(room_id) REFERENCES chat_rooms(room_id) ON DELETE CASCADE,
    FOREIGN KEY(reply_to_message_id) REFERENCES chat_messages(message_id)
  ) STRICT;
  CREATE TABLE schedules (
    schedule_id TEXT PRIMARY KEY NOT NULL,
    name TEXT,
    prompt TEXT NOT NULL,
    cadence_json TEXT NOT NULL,
    target_json TEXT NOT NULL,
    intent_contract_id TEXT,
    status TEXT NOT NULL CHECK(status IN ('needs_contract', 'active', 'paused', 'completed')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    next_run_at TEXT,
    last_run_at TEXT,
    paused_at TEXT,
    expires_at TEXT,
    max_runs INTEGER,
    FOREIGN KEY(intent_contract_id) REFERENCES intent_contracts(contract_id)
  ) STRICT;
  CREATE TABLE schedule_runs (
    run_id TEXT PRIMARY KEY NOT NULL,
    schedule_id TEXT NOT NULL,
    workspace_id TEXT,
    scheduled_for TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    status TEXT NOT NULL CHECK(status IN ('running', 'succeeded', 'failed')),
    task_id TEXT,
    execution_id TEXT,
    agent_id TEXT,
    output TEXT,
    error TEXT,
    FOREIGN KEY(schedule_id) REFERENCES schedules(schedule_id) ON DELETE CASCADE
  ) STRICT;
  CREATE INDEX human_decisions_task_time ON human_decisions(task_id, decided_at ASC);
  CREATE INDEX tasks_status_updated ON tasks(status, updated_at DESC);
  CREATE INDEX execution_attempts_task_time ON execution_attempts(task_id, started_at DESC);
  CREATE UNIQUE INDEX execution_approvals_one_pending
    ON execution_approvals(execution_id) WHERE status = 'pending';
  CREATE INDEX decision_sessions_agent_created
    ON decision_sessions(agent_id, created_at DESC, session_id DESC);
  CREATE INDEX decision_tree_nodes_session_priority
    ON decision_tree_nodes(session_id, priority DESC, node_id);
  CREATE INDEX decision_tree_nodes_session_parent
    ON decision_tree_nodes(session_id, parent_id, priority DESC, node_id);
  CREATE INDEX task_work_units_task_time ON task_work_units(task_id, created_at ASC);
  CREATE INDEX review_decisions_task_time ON review_decisions(task_id, created_at ASC);
  CREATE INDEX evidence_refs_task_time ON evidence_refs(task_id, created_at ASC);
  CREATE UNIQUE INDEX task_decision_requests_one_pending
    ON task_decision_requests(task_id) WHERE status = 'pending';
  CREATE UNIQUE INDEX context_bindings_turn_task ON context_bindings(turn_id, task_id);
  CREATE UNIQUE INDEX turns_agent_source_message
    ON turns(agent_id, source_message_id) WHERE source_message_id IS NOT NULL;
  CREATE UNIQUE INDEX tasks_source_registration
    ON tasks(source_turn_id, source_contract_card_id)
    WHERE source_turn_id IS NOT NULL AND source_contract_card_id IS NOT NULL;
  CREATE INDEX turns_agent_created ON turns(agent_id, created_at DESC);
  CREATE INDEX foreground_turn_queue_agent_order
    ON foreground_turn_queue(agent_id, queue_order ASC, created_at ASC);
  CREATE INDEX cards_turn_created ON cards(turn_id, created_at ASC);
  CREATE INDEX chat_messages_room_created
    ON chat_messages(room_id, created_at, message_id);
  CREATE INDEX schedule_runs_schedule_started
    ON schedule_runs(schedule_id, started_at, run_id);
  CREATE INDEX schedule_runs_task_execution
    ON schedule_runs(task_id, execution_id);
  CREATE INDEX schedules_status_next_run ON schedules(status, next_run_at);
`;
