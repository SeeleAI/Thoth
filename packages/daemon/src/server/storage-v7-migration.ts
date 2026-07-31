import { DatabaseSync } from "node:sqlite";

const AUTHORITY_V7_CHECKSUM = "decision-session-tree-v7";

interface LegacySessionRow {
  session_id: string;
  workspace_id: string;
  agent_id: string;
  turn_id: string;
  requested_strength: string;
  effective_strength: string | null;
  lifecycle: string;
  challenger_used: number;
  priority_node_id: string | null;
  intent_contract_id: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
}

interface LegacyNodeRow {
  node_id: string;
  session_id: string;
  parent_ids_json: string;
  title: string;
  owner: string;
  materiality: string;
  status: string;
  resolution_ref: string | null;
  source_refs_json: string;
  priority: number;
  revision: number;
  created_at: string;
  updated_at: string;
}

interface LegacyCardRow extends Record<string, unknown> {
  card_id: string;
  turn_id: string;
  task_id: string | null;
  kind: string;
  status: string;
  displayed_digest: string;
  answer_digest: string | null;
  submitted_summary: string | null;
  runtime_digest: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuthorityV7MigrationAudit {
  sessions: number;
  legacyNodes: number;
  targetNodes: number;
  crossLinks: number;
  cards: number;
}

export function upgradeAuthoritySchemaV7(input: {
  filePath: string;
  workspaceRoot: string;
  migratedAt: string;
}): AuthorityV7MigrationAudit {
  const database = new DatabaseSync(input.filePath, { enableForeignKeyConstraints: true });
  try {
    database.exec("PRAGMA journal_mode = DELETE; PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE;");
    try {
      const sessions = database
        .prepare("SELECT * FROM clarify_sessions ORDER BY created_at, session_id")
        .all() as unknown as LegacySessionRow[];
      const nodes = database
        .prepare(
          `SELECT * FROM clarify_decision_nodes
           ORDER BY session_id, priority DESC, created_at, node_id`,
        )
        .all() as unknown as LegacyNodeRow[];
      const cards = database
        .prepare("SELECT * FROM cards ORDER BY created_at, card_id")
        .all() as unknown as LegacyCardRow[];

      database.exec(`
        ALTER TABLE clarify_sessions RENAME TO clarify_sessions_v6;
        ALTER TABLE clarify_decision_nodes RENAME TO clarify_decision_nodes_v6;
        ALTER TABLE cards RENAME TO cards_v6;

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
          status TEXT NOT NULL CHECK(status IN (
            'open', 'awaiting_human', 'resolved', 'delegated', 'pruned'
          )),
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
      `);

      const nodesBySession = groupBy(nodes, (node) => node.session_id);
      const cardsByTurn = groupBy(cards, (card) => card.turn_id);
      const insertSession = database.prepare(
        `INSERT INTO decision_sessions(
           session_id, workspace_id, agent_id, origin_turn_id, active_turn_id,
           requested_strength, effective_strength, lifecycle, challenger_used,
           root_node_id, priority_node_id, active_card_id, intent_contract_id,
           revision, frozen_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const insertSessionTurn = database.prepare(
        `INSERT INTO decision_session_turns(session_id, turn_id, turn_order, created_at)
         VALUES (?, ?, 1, ?)`,
      );
      const insertNode = database.prepare(
        `INSERT INTO decision_tree_nodes(
           node_id, session_id, parent_id, title, summary, owner, materiality, status,
           resolution_ref, source_refs_json, priority, revision, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const insertCrossLink = database.prepare(
        `INSERT OR IGNORE INTO decision_tree_cross_links(
           session_id, from_node_id, to_node_id, relation, created_at
         ) VALUES (?, ?, ?, 'also_influences', ?)`,
      );
      const insertActivity = database.prepare(
        `INSERT INTO decision_tree_activity(
           session_id, state, active_node_id, summary, started_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      );

      let crossLinkCount = 0;
      for (const session of sessions) {
        const rootNodeId = `decision-root-${session.session_id}`;
        const sessionNodes = nodesBySession.get(session.session_id) ?? [];
        const knownNodeIds = new Set(sessionNodes.map((node) => node.node_id));
        const pendingCard = (cardsByTurn.get(session.turn_id) ?? []).find(
          (card) => card.status === "pending" && isDecisionCard(card),
        );
        const lifecycle = migrateLifecycle(session.lifecycle);
        const activity = migrateActivity(session.lifecycle);
        const activeNodeId =
          session.priority_node_id && knownNodeIds.has(session.priority_node_id)
            ? session.priority_node_id
            : (sessionNodes.find((node) => node.status === "awaiting_human")?.node_id ?? null);
        insertSession.run(
          session.session_id,
          session.workspace_id,
          session.agent_id,
          session.turn_id,
          lifecycle === "frozen" || lifecycle === "canceled" ? null : session.turn_id,
          session.requested_strength,
          session.effective_strength,
          lifecycle,
          session.challenger_used,
          rootNodeId,
          session.priority_node_id,
          pendingCard?.card_id ?? null,
          session.intent_contract_id,
          session.revision + 1,
          lifecycle === "frozen" ? session.updated_at : null,
          session.created_at,
          input.migratedAt,
        );
        insertSessionTurn.run(session.session_id, session.turn_id, session.created_at);
        insertNode.run(
          rootNodeId,
          session.session_id,
          null,
          "Objective",
          null,
          "human",
          "structural",
          "resolved",
          `turn:${session.turn_id}`,
          JSON.stringify([`turn:${session.turn_id}`]),
          sessionNodes.reduce((maximum, node) => Math.max(maximum, node.priority), 0) + 1,
          1,
          session.created_at,
          input.migratedAt,
        );
        for (const node of sessionNodes) {
          const parentIds = parseStringArray(node.parent_ids_json).filter((parentId) =>
            knownNodeIds.has(parentId),
          );
          const parentId = parentIds[0] ?? rootNodeId;
          insertNode.run(
            node.node_id,
            node.session_id,
            parentId,
            node.title,
            null,
            node.owner,
            node.materiality,
            node.status,
            node.resolution_ref,
            node.source_refs_json,
            node.priority,
            node.revision,
            node.created_at,
            node.updated_at,
          );
          for (const crossLinkId of new Set(parentIds.slice(1))) {
            if (crossLinkId === node.node_id) continue;
            insertCrossLink.run(session.session_id, node.node_id, crossLinkId, input.migratedAt);
            crossLinkCount += 1;
          }
        }
        insertActivity.run(
          session.session_id,
          activity,
          activeNodeId,
          activitySummary(activity),
          session.updated_at,
          input.migratedAt,
        );
      }

      const sessionByTurn = new Map(
        sessions.map((session) => [session.turn_id, session.session_id]),
      );
      const insertCard = database.prepare(
        `INSERT INTO cards(
           card_id, turn_id, decision_session_id, task_id, kind, status, displayed_digest,
           answer_digest, submitted_summary, runtime_digest, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const card of cards) {
        insertCard.run(
          card.card_id,
          card.turn_id,
          sessionByTurn.get(card.turn_id) ?? null,
          card.task_id,
          card.kind,
          card.status,
          card.displayed_digest,
          card.answer_digest,
          card.submitted_summary,
          card.runtime_digest,
          card.created_at,
          card.updated_at,
        );
      }

      database.exec(`
        DROP TABLE clarify_decision_nodes_v6;
        DROP TABLE clarify_sessions_v6;
        DROP TABLE cards_v6;
        CREATE INDEX decision_sessions_agent_created
          ON decision_sessions(agent_id, created_at DESC, session_id DESC);
        CREATE INDEX decision_tree_nodes_session_priority
          ON decision_tree_nodes(session_id, priority DESC, node_id);
        CREATE INDEX decision_tree_nodes_session_parent
          ON decision_tree_nodes(session_id, parent_id, priority DESC, node_id);
        CREATE INDEX cards_turn_created ON cards(turn_id, created_at ASC);
      `);
      database
        .prepare(
          `INSERT INTO authority_schema_migrations(version, checksum, applied_at)
           VALUES (10, ?, ?)`,
        )
        .run(AUTHORITY_V7_CHECKSUM, input.migratedAt);
      const foreignKeys = database.prepare("PRAGMA foreign_key_check").all() as unknown[];
      if (foreignKeys.length > 0) {
        throw new Error("Authority schema-v7 migration failed foreign-key validation");
      }
      database.exec("PRAGMA user_version = 7; COMMIT; PRAGMA foreign_keys = ON;");
      const audit: AuthorityV7MigrationAudit = {
        sessions: sessions.length,
        legacyNodes: nodes.length,
        targetNodes: countRows(database, "decision_tree_nodes"),
        crossLinks: countRows(database, "decision_tree_cross_links"),
        cards: countRows(database, "cards"),
      };
      if (
        audit.targetNodes !== audit.legacyNodes + audit.sessions ||
        audit.cards !== cards.length
      ) {
        throw new Error("Authority schema-v7 migration changed Decision Tree or Card cardinality");
      }
      return audit;
    } catch (error) {
      database.exec("ROLLBACK;");
      throw error;
    }
  } finally {
    database.close();
  }
}

function migrateLifecycle(value: string): string {
  switch (value) {
    case "awaiting_human":
      return "awaiting_human";
    case "proposing":
      return "ready_to_confirm";
    case "confirmed":
      return "frozen";
    case "blocked":
      return "blocked";
    case "canceled":
      return "canceled";
    default:
      return "active";
  }
}

function migrateActivity(value: string): string {
  switch (value) {
    case "grounding":
      return "understanding";
    case "challenging":
      return "challenging";
    case "awaiting_human":
      return "awaiting_human";
    case "proposing":
      return "ready_to_confirm";
    case "confirmed":
      return "frozen";
    case "blocked":
    case "canceled":
      return "blocked";
    default:
      return "expanding";
  }
}

function activitySummary(state: string): string {
  switch (state) {
    case "understanding":
      return "Understanding the objective";
    case "challenging":
      return "Checking the proposed contract";
    case "awaiting_human":
      return "Waiting for your decision";
    case "ready_to_confirm":
      return "Ready to confirm the task";
    case "frozen":
      return "Frozen as Task evidence";
    case "blocked":
      return "Clarification is blocked";
    default:
      return "Expanding the decision tree";
  }
}

function isDecisionCard(card: LegacyCardRow): boolean {
  return card.kind === "clarify_card" || card.kind === "intent_contract_card";
}

function parseStringArray(value: string): string[] {
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed)
    ? parsed.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function groupBy<Row, Key>(rows: Row[], keyOf: (row: Row) => Key): Map<Key, Row[]> {
  const grouped = new Map<Key, Row[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const values = grouped.get(key) ?? [];
    values.push(row);
    grouped.set(key, values);
  }
  return grouped;
}

function countRows(database: DatabaseSync, table: string): number {
  return Number(
    (database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count,
  );
}
