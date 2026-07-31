import { randomBytes, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import {
  ChatMessageSchema,
  ChatRoomDetailSchema,
  ChatRoomSchema,
  type ChatMessage,
  type ChatRoom,
  type ChatRoomDetail,
} from "@thoth/protocol/chat/types";
import {
  ScheduleRunSchema,
  StoredScheduleSchema,
  type ScheduleRun,
  type StoredSchedule,
} from "@thoth/protocol/schedule/types";

export const ChatStorePayloadSchema = z.object({
  rooms: z.array(ChatRoomSchema),
  messages: z.array(ChatMessageSchema),
});

export class WorkspaceCoordinationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "WorkspaceCoordinationError";
  }
}

function normalizeRoomName(name: string): string {
  return name.trim().toLocaleLowerCase();
}

function trimToNull(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function scheduleId(): string {
  return randomBytes(4).toString("hex");
}

/** Chat and schedule rows owned by the same connection as one Workspace authority shard. */
export class WorkspaceCoordinationRepository {
  constructor(
    private readonly database: DatabaseSync,
    private readonly transact: <T>(run: () => T) => T,
  ) {}

  createChatRoom(input: { name: string; purpose?: string | null }): ChatRoomDetail {
    const name = input.name.trim();
    if (!name) {
      throw new WorkspaceCoordinationError("invalid_chat_room_name", "Chat room name is required");
    }
    return this.transact(() => {
      if (this.findChatRoomByName(name)) {
        throw new WorkspaceCoordinationError(
          "chat_room_name_taken",
          `Chat room already exists with name: ${name}`,
        );
      }
      const now = new Date().toISOString();
      const room = ChatRoomSchema.parse({
        id: randomUUID(),
        name,
        purpose: trimToNull(input.purpose),
        createdAt: now,
        updatedAt: now,
      });
      this.insertChatRoom(room);
      return this.toChatRoomDetail(room);
    });
  }

  listChatRooms(): ChatRoomDetail[] {
    const rows = this.database
      .prepare("SELECT * FROM chat_rooms ORDER BY updated_at DESC, room_id ASC")
      .all() as Array<Record<string, unknown>>;
    return rows.map((row) => this.toChatRoomDetail(this.toChatRoom(row)));
  }

  inspectChatRoom(selector: string): ChatRoomDetail {
    return this.toChatRoomDetail(this.resolveChatRoom(selector));
  }

  deleteChatRoom(selector: string): ChatRoomDetail {
    return this.transact(() => {
      const room = this.resolveChatRoom(selector);
      const detail = this.toChatRoomDetail(room);
      this.database.prepare("DELETE FROM chat_rooms WHERE room_id = ?").run(room.id);
      return detail;
    });
  }

  postChatMessage(input: {
    room: string;
    authorAgentId: string;
    body: string;
    replyToMessageId?: string | null;
    mentionAgentIds: string[];
  }): ChatMessage {
    const room = this.resolveChatRoom(input.room);
    const body = input.body.trim();
    if (!body) {
      throw new WorkspaceCoordinationError("invalid_chat_message", "Chat message body is required");
    }
    const authorAgentId = input.authorAgentId.trim();
    if (!authorAgentId) {
      throw new WorkspaceCoordinationError(
        "invalid_chat_author",
        "Chat message author is required",
      );
    }
    const replyToMessageId = trimToNull(input.replyToMessageId);
    if (replyToMessageId) {
      const reply = this.database
        .prepare("SELECT room_id FROM chat_messages WHERE message_id = ?")
        .get(replyToMessageId) as { room_id: string } | undefined;
      if (!reply || reply.room_id !== room.id) {
        throw new WorkspaceCoordinationError(
          "chat_message_not_found",
          `Reply target not found: ${replyToMessageId}`,
        );
      }
    }
    const createdAt = new Date().toISOString();
    const message = ChatMessageSchema.parse({
      id: randomUUID(),
      roomId: room.id,
      authorAgentId,
      body,
      replyToMessageId,
      mentionAgentIds: input.mentionAgentIds,
      createdAt,
    });
    this.transact(() => {
      this.insertChatMessage(message);
      this.database
        .prepare("UPDATE chat_rooms SET updated_at = ? WHERE room_id = ?")
        .run(createdAt, room.id);
    });
    return message;
  }

  readChatMessages(input: {
    room: string;
    limit?: number;
    since?: string;
    authorAgentId?: string;
  }): ChatMessage[] {
    const room = this.resolveChatRoom(input.room);
    const since = trimToNull(input.since);
    const authorAgentId = trimToNull(input.authorAgentId);
    const rows = this.database
      .prepare(
        `SELECT * FROM chat_messages
         WHERE room_id = ? AND (? IS NULL OR created_at >= ?)
           AND (? IS NULL OR author_agent_id = ?)
         ORDER BY created_at ASC, message_id ASC`,
      )
      .all(room.id, since, since, authorAgentId, authorAgentId) as Array<Record<string, unknown>>;
    const messages = rows.map((row) => this.toChatMessage(row));
    const limit = input.limit === undefined ? 20 : Math.max(0, Math.floor(input.limit));
    return limit === 0 || messages.length <= limit ? messages : messages.slice(-limit);
  }

  listChatRoomPosterAgentIds(roomSelector: string): string[] {
    const room = this.resolveChatRoom(roomSelector);
    const rows = this.database
      .prepare(
        "SELECT DISTINCT author_agent_id FROM chat_messages WHERE room_id = ? ORDER BY author_agent_id ASC",
      )
      .all(room.id) as Array<{ author_agent_id: string }>;
    return rows.map((row) => row.author_agent_id);
  }

  selectChatMessagesAfter(roomId: string, afterMessageId: string): ChatMessage[] {
    const cursor = this.database
      .prepare("SELECT created_at FROM chat_messages WHERE message_id = ? AND room_id = ?")
      .get(afterMessageId, roomId) as { created_at: string } | undefined;
    if (!cursor) return [];
    const rows = this.database
      .prepare(
        `SELECT * FROM chat_messages
         WHERE room_id = ? AND (
           created_at > ? OR (created_at = ? AND message_id > ?)
         ) ORDER BY created_at ASC, message_id ASC`,
      )
      .all(roomId, cursor.created_at, cursor.created_at, afterMessageId) as Array<
      Record<string, unknown>
    >;
    return rows.map((row) => this.toChatMessage(row));
  }

  latestChatRoomMessage(roomId: string): ChatMessage[] {
    const rows = this.database
      .prepare(
        "SELECT * FROM chat_messages WHERE room_id = ? ORDER BY created_at DESC, message_id DESC LIMIT 1",
      )
      .all(roomId) as Array<Record<string, unknown>>;
    return rows.map((row) => this.toChatMessage(row));
  }

  getChatMessage(messageId: string): ChatMessage | null {
    const row = this.database
      .prepare("SELECT * FROM chat_messages WHERE message_id = ?")
      .get(messageId) as Record<string, unknown> | undefined;
    return row ? this.toChatMessage(row) : null;
  }

  resolveChatRoomId(selector: string): string {
    return this.resolveChatRoom(selector).id;
  }

  importChatSnapshot(value: unknown): { rooms: number; messages: number } {
    const payload = ChatStorePayloadSchema.parse(value);
    this.transact(() => {
      for (const room of payload.rooms) this.insertChatRoom(room);
      for (const message of payload.messages) this.insertChatMessage(message);
    });
    return { rooms: payload.rooms.length, messages: payload.messages.length };
  }

  listSchedules(): StoredSchedule[] {
    const rows = this.database
      .prepare("SELECT schedule_id FROM schedules ORDER BY created_at ASC, schedule_id ASC")
      .all() as Array<{ schedule_id: string }>;
    return rows.flatMap((row) => {
      const schedule = this.getSchedule(row.schedule_id);
      return schedule ? [schedule] : [];
    });
  }

  getSchedule(id: string): StoredSchedule | null {
    const row = this.database.prepare("SELECT * FROM schedules WHERE schedule_id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    const runRows = this.database
      .prepare(
        "SELECT * FROM schedule_runs WHERE schedule_id = ? ORDER BY started_at ASC, run_id ASC",
      )
      .all(id) as Array<Record<string, unknown>>;
    return StoredScheduleSchema.parse({
      id: row.schedule_id,
      name: row.name ?? null,
      prompt: row.prompt,
      cadence: JSON.parse(String(row.cadence_json)) as unknown,
      target: JSON.parse(String(row.target_json)) as unknown,
      intentContractId: row.intent_contract_id ?? null,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      nextRunAt: row.next_run_at ?? null,
      lastRunAt: row.last_run_at ?? null,
      pausedAt: row.paused_at ?? null,
      expiresAt: row.expires_at ?? null,
      maxRuns: row.max_runs ?? null,
      runs: runRows.map((run) => this.toScheduleRun(run)),
    });
  }

  createSchedule(schedule: Omit<StoredSchedule, "id">): StoredSchedule {
    const created = StoredScheduleSchema.parse({ ...schedule, id: scheduleId() });
    this.putSchedule(created);
    return created;
  }

  putSchedule(scheduleValue: StoredSchedule): void {
    const schedule = StoredScheduleSchema.parse(scheduleValue);
    this.transact(() => {
      this.database
        .prepare(
          `INSERT INTO schedules(
             schedule_id, name, prompt, cadence_json, target_json, intent_contract_id, status,
             created_at, updated_at, next_run_at, last_run_at, paused_at,
             expires_at, max_runs
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(schedule_id) DO UPDATE SET
             name = excluded.name,
             prompt = excluded.prompt,
             cadence_json = excluded.cadence_json,
             target_json = excluded.target_json,
             intent_contract_id = excluded.intent_contract_id,
             status = excluded.status,
             updated_at = excluded.updated_at,
             next_run_at = excluded.next_run_at,
             last_run_at = excluded.last_run_at,
             paused_at = excluded.paused_at,
             expires_at = excluded.expires_at,
             max_runs = excluded.max_runs`,
        )
        .run(
          schedule.id,
          schedule.name,
          schedule.prompt,
          JSON.stringify(schedule.cadence),
          JSON.stringify(schedule.target),
          schedule.intentContractId,
          schedule.status,
          schedule.createdAt,
          schedule.updatedAt,
          schedule.nextRunAt,
          schedule.lastRunAt,
          schedule.pausedAt,
          schedule.expiresAt,
          schedule.maxRuns,
        );
      this.database.prepare("DELETE FROM schedule_runs WHERE schedule_id = ?").run(schedule.id);
      const insertRun = this.database.prepare(
        `INSERT INTO schedule_runs(
           run_id, schedule_id, workspace_id, scheduled_for, started_at, ended_at,
           status, task_id, execution_id, agent_id, output, error
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const run of schedule.runs) {
        insertRun.run(
          run.id,
          schedule.id,
          run.workspaceId ?? null,
          run.scheduledFor,
          run.startedAt,
          run.endedAt,
          run.status,
          run.taskId ?? null,
          run.executionId ?? null,
          run.agentId,
          run.output,
          run.error,
        );
      }
    });
  }

  deleteSchedule(id: string): void {
    this.transact(() => {
      this.database.prepare("DELETE FROM schedules WHERE schedule_id = ?").run(id);
    });
  }

  private insertChatRoom(room: ChatRoom): void {
    this.database
      .prepare(
        `INSERT INTO chat_rooms(
           room_id, name, normalized_name, purpose, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(room_id) DO UPDATE SET
           name = excluded.name,
           normalized_name = excluded.normalized_name,
           purpose = excluded.purpose,
           updated_at = excluded.updated_at`,
      )
      .run(
        room.id,
        room.name,
        normalizeRoomName(room.name),
        room.purpose,
        room.createdAt,
        room.updatedAt,
      );
  }

  private insertChatMessage(message: ChatMessage): void {
    this.database
      .prepare(
        `INSERT INTO chat_messages(
           message_id, room_id, author_agent_id, body, reply_to_message_id,
           mention_agent_ids_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(message_id) DO NOTHING`,
      )
      .run(
        message.id,
        message.roomId,
        message.authorAgentId,
        message.body,
        message.replyToMessageId,
        JSON.stringify(message.mentionAgentIds),
        message.createdAt,
      );
  }

  private findChatRoomByName(name: string): ChatRoom | null {
    const row = this.database
      .prepare("SELECT * FROM chat_rooms WHERE normalized_name = ?")
      .get(normalizeRoomName(name)) as Record<string, unknown> | undefined;
    return row ? this.toChatRoom(row) : null;
  }

  private resolveChatRoom(selectorValue: string): ChatRoom {
    const selector = selectorValue.trim();
    if (!selector) {
      throw new WorkspaceCoordinationError("invalid_chat_room", "Chat room name or ID is required");
    }
    const row = this.database
      .prepare("SELECT * FROM chat_rooms WHERE room_id = ? OR normalized_name = ? LIMIT 1")
      .get(selector, normalizeRoomName(selector)) as Record<string, unknown> | undefined;
    if (!row) {
      throw new WorkspaceCoordinationError(
        "chat_room_not_found",
        `Chat room not found: ${selector}`,
      );
    }
    return this.toChatRoom(row);
  }

  private toChatRoom(row: Record<string, unknown>): ChatRoom {
    return ChatRoomSchema.parse({
      id: row.room_id,
      name: row.name,
      purpose: row.purpose ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  private toChatRoomDetail(room: ChatRoom): ChatRoomDetail {
    const summary = this.database
      .prepare(
        `SELECT COUNT(*) AS message_count, MAX(created_at) AS last_message_at
         FROM chat_messages WHERE room_id = ?`,
      )
      .get(room.id) as { message_count: number; last_message_at: string | null };
    return ChatRoomDetailSchema.parse({
      ...room,
      messageCount: Number(summary.message_count),
      lastMessageAt: summary.last_message_at,
    });
  }

  private toChatMessage(row: Record<string, unknown>): ChatMessage {
    return ChatMessageSchema.parse({
      id: row.message_id,
      roomId: row.room_id,
      authorAgentId: row.author_agent_id,
      body: row.body,
      replyToMessageId: row.reply_to_message_id ?? null,
      mentionAgentIds: JSON.parse(String(row.mention_agent_ids_json)) as unknown,
      createdAt: row.created_at,
    });
  }

  private toScheduleRun(row: Record<string, unknown>): ScheduleRun {
    return ScheduleRunSchema.parse({
      id: row.run_id,
      workspaceId: row.workspace_id ?? null,
      taskId: row.task_id ?? null,
      executionId: row.execution_id ?? null,
      scheduledFor: row.scheduled_for,
      startedAt: row.started_at,
      endedAt: row.ended_at ?? null,
      status: row.status,
      agentId: row.agent_id ?? null,
      output: row.output ?? null,
      error: row.error ?? null,
    });
  }
}
