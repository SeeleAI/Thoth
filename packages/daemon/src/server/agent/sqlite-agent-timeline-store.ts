import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { InMemoryAgentTimelineStore } from "./agent-timeline-store.js";
import type {
  AgentTimelineFetchOptions,
  AgentTimelineFetchResult,
  AgentTimelineRow,
  AgentTimelineStore,
} from "@thoth/drivers/internal/server/agent/agent-timeline-store-types";
import type { AgentTimelineItem } from "@thoth/drivers/agent-runtime";

interface TimelineMetaRow {
  epoch: string;
  next_seq: number;
}

interface TimelineRow {
  seq: number;
  timestamp: string;
  item_json: string;
}

function parseTimelineItem(value: string): AgentTimelineItem | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed !== null && typeof parsed === "object" ? (parsed as AgentTimelineItem) : null;
  } catch {
    return null;
  }
}

/**
 * Local, append-only timeline journal. Reading a recorded timeline must not
 * require reviving the provider session that originally produced it.
 */
export class SqliteAgentTimelineStore implements AgentTimelineStore {
  private readonly database: DatabaseSync;

  constructor(thothHome: string) {
    const root = path.join(thothHome, "agent-timeline");
    mkdirSync(root, { recursive: true });
    this.database = new DatabaseSync(path.join(root, "timeline.sqlite"));
    this.database.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS agent_timeline_meta (
        agent_id TEXT PRIMARY KEY NOT NULL,
        epoch TEXT NOT NULL,
        next_seq INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS agent_timeline_rows (
        agent_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        timestamp TEXT NOT NULL,
        item_json TEXT NOT NULL,
        PRIMARY KEY (agent_id, seq),
        FOREIGN KEY (agent_id) REFERENCES agent_timeline_meta(agent_id) ON DELETE CASCADE
      ) STRICT;
      CREATE INDEX IF NOT EXISTS agent_timeline_rows_agent_seq
        ON agent_timeline_rows(agent_id, seq);
    `);
  }

  bindAgentWorkspace(_agentId: string, _workspaceId: string): void {}

  async appendCommitted(
    agentId: string,
    item: AgentTimelineItem,
    options?: { timestamp?: string },
  ): Promise<AgentTimelineRow> {
    const meta = this.ensureMeta(agentId);
    const row: AgentTimelineRow = {
      seq: meta.next_seq,
      timestamp: options?.timestamp ?? new Date().toISOString(),
      item,
    };
    this.insertRows(agentId, [row]);
    return { ...row };
  }

  async fetchCommitted(
    agentId: string,
    options?: AgentTimelineFetchOptions,
  ): Promise<AgentTimelineFetchResult> {
    const meta = this.getMeta(agentId);
    const rows = this.getRows(agentId);
    const memory = new InMemoryAgentTimelineStore();
    memory.initialize(agentId, {
      epoch: meta?.epoch ?? randomUUID(),
      nextSeq: meta?.next_seq ?? 1,
      rows,
    });
    return memory.fetch(agentId, options);
  }

  async fetchAllCommitted(agentId: string): Promise<AgentTimelineFetchResult> {
    const meta = this.getMeta(agentId);
    const memory = new InMemoryAgentTimelineStore();
    memory.initialize(agentId, {
      epoch: meta?.epoch ?? randomUUID(),
      nextSeq: meta?.next_seq ?? 1,
      rows: this.getRows(agentId),
    });
    return memory.fetchAll(agentId, { direction: "tail" });
  }

  async getLatestCommittedSeq(agentId: string): Promise<number> {
    const meta = this.getMeta(agentId);
    return meta ? Math.max(0, meta.next_seq - 1) : 0;
  }

  async getCommittedRows(agentId: string): Promise<AgentTimelineRow[]> {
    return this.getRows(agentId);
  }

  async getLastItem(agentId: string): Promise<AgentTimelineItem | null> {
    const row = this.database
      .prepare(
        `SELECT item_json FROM agent_timeline_rows
         WHERE agent_id = ? ORDER BY seq DESC LIMIT 1`,
      )
      .get(agentId) as { item_json: string } | undefined;
    return row ? parseTimelineItem(row.item_json) : null;
  }

  async getLastAssistantMessage(agentId: string): Promise<string | null> {
    const rows = this.getRows(agentId);
    const chunks: string[] = [];
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const item = rows[index]?.item;
      if (!item) {
        continue;
      }
      if (item.type !== "assistant_message") {
        if (chunks.length > 0) {
          break;
        }
        continue;
      }
      chunks.push(item.text);
    }
    return chunks.length > 0 ? chunks.toReversed().join("") : null;
  }

  async deleteAgent(agentId: string): Promise<void> {
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      this.database.prepare("DELETE FROM agent_timeline_rows WHERE agent_id = ?").run(agentId);
      this.database.prepare("DELETE FROM agent_timeline_meta WHERE agent_id = ?").run(agentId);
      this.database.exec("COMMIT;");
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }

  async bulkInsert(agentId: string, rows: readonly AgentTimelineRow[]): Promise<void> {
    if (rows.length === 0) {
      return;
    }
    this.insertRows(agentId, rows);
  }

  close(): void {
    this.database.close();
  }

  private getMeta(agentId: string): TimelineMetaRow | null {
    const row = this.database
      .prepare("SELECT epoch, next_seq FROM agent_timeline_meta WHERE agent_id = ?")
      .get(agentId) as TimelineMetaRow | undefined;
    return row ?? null;
  }

  private ensureMeta(agentId: string): TimelineMetaRow {
    const existing = this.getMeta(agentId);
    if (existing) {
      return existing;
    }
    const created: TimelineMetaRow = { epoch: randomUUID(), next_seq: 1 };
    this.database
      .prepare(
        `INSERT INTO agent_timeline_meta(agent_id, epoch, next_seq, updated_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(agentId, created.epoch, created.next_seq, new Date().toISOString());
    return created;
  }

  private getRows(agentId: string): AgentTimelineRow[] {
    const rows = this.database
      .prepare(
        `SELECT seq, timestamp, item_json FROM agent_timeline_rows
         WHERE agent_id = ? ORDER BY seq ASC`,
      )
      .all(agentId) as TimelineRow[];
    return rows.flatMap((row) => {
      const item = parseTimelineItem(row.item_json);
      return item ? [{ seq: row.seq, timestamp: row.timestamp, item }] : [];
    });
  }

  private insertRows(agentId: string, rows: readonly AgentTimelineRow[]): void {
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      this.ensureMeta(agentId);
      const insert = this.database.prepare(
        `INSERT OR IGNORE INTO agent_timeline_rows(agent_id, seq, timestamp, item_json)
         VALUES (?, ?, ?, ?)`,
      );
      let nextSeq = 1;
      for (const row of rows) {
        insert.run(agentId, row.seq, row.timestamp, JSON.stringify(row.item));
        nextSeq = Math.max(nextSeq, row.seq + 1);
      }
      this.database
        .prepare(
          `UPDATE agent_timeline_meta
           SET next_seq = CASE WHEN next_seq < ? THEN ? ELSE next_seq END,
               updated_at = ?
           WHERE agent_id = ?`,
        )
        .run(nextSeq, nextSeq, new Date().toISOString(), agentId);
      this.database.exec("COMMIT;");
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }
}
