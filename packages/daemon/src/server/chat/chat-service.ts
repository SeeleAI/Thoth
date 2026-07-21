import type { ChatMessage, ChatRoomDetail } from "@thoth/protocol/chat/types";
import type { WorkspaceAuthorityManager } from "../workspace-authority/workspace-authority-manager.js";
import {
  ChatStorePayloadSchema,
  WorkspaceCoordinationError,
  type WorkspaceCoordinationRepository,
} from "../workspace-authority/coordination-repository.js";

export { ChatStorePayloadSchema, WorkspaceCoordinationError as ChatServiceError };

const CHAT_MENTION_PATTERN = /(?:^|[\s(])@([A-Za-z0-9][A-Za-z0-9._-]*)/g;

export function parseMentionAgentIds(body: string): string[] {
  const mentionAgentIds = new Set<string>();
  for (const match of body.matchAll(CHAT_MENTION_PATTERN)) {
    const agentId = match[1]?.trim();
    if (agentId) mentionAgentIds.add(agentId);
  }
  return Array.from(mentionAgentIds).sort();
}

function trimToNull(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

interface Waiter {
  workspaceId: string;
  roomId: string;
  afterMessageId: string | null;
  resolve: (messages: ChatMessage[]) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout> | null;
}

interface WorkspaceChatInput {
  workspaceId: string;
}

export interface CreateChatRoomInput extends WorkspaceChatInput {
  name: string;
  purpose?: string | null;
}

export interface InspectChatRoomInput extends WorkspaceChatInput {
  room: string;
}

export interface DeleteChatRoomInput extends WorkspaceChatInput {
  room: string;
}

export interface PostChatMessageInput extends WorkspaceChatInput {
  room: string;
  authorAgentId: string;
  body: string;
  replyToMessageId?: string | null;
}

export interface ReadChatMessagesInput extends WorkspaceChatInput {
  room: string;
  limit?: number;
  since?: string;
  authorAgentId?: string;
}

export interface ListChatRoomPosterAgentIdsInput extends WorkspaceChatInput {
  room: string;
}

export interface WaitForChatMessagesInput extends WorkspaceChatInput {
  room: string;
  afterMessageId?: string | null;
  timeoutMs?: number;
}

/** Process-local wait coordination over durable, Workspace-owned chat rows. */
export class WorkspaceChatService {
  private readonly waiters = new Map<string, Set<Waiter>>();

  constructor(private readonly authority: WorkspaceAuthorityManager) {}

  async initialize(): Promise<void> {}

  close(): void {
    for (const waiters of this.waiters.values()) {
      for (const waiter of waiters) waiter.reject(new Error("Chat service closed"));
    }
    this.waiters.clear();
  }

  async createRoom(input: CreateChatRoomInput): Promise<ChatRoomDetail> {
    return this.repository(input.workspaceId).createChatRoom(input);
  }

  async listRooms(workspaceId: string): Promise<ChatRoomDetail[]> {
    return this.repository(workspaceId).listChatRooms();
  }

  async inspectRoom(input: InspectChatRoomInput): Promise<{ room: ChatRoomDetail }> {
    return { room: this.repository(input.workspaceId).inspectChatRoom(input.room) };
  }

  async deleteRoom(input: DeleteChatRoomInput): Promise<{ room: ChatRoomDetail }> {
    const repository = this.repository(input.workspaceId);
    const room = repository.deleteChatRoom(input.room);
    this.rejectWaiters(
      input.workspaceId,
      room.id,
      new WorkspaceCoordinationError("chat_room_deleted", `Chat room deleted: ${room.name}`),
    );
    return { room };
  }

  async dispatchMessage(input: PostChatMessageInput): Promise<ChatMessage> {
    const repository = this.repository(input.workspaceId);
    const message = repository.postChatMessage({
      ...input,
      mentionAgentIds: parseMentionAgentIds(input.body),
    });
    this.notifyWaiters(input.workspaceId, message.roomId);
    return message;
  }

  async readMessages(input: ReadChatMessagesInput): Promise<ChatMessage[]> {
    return this.repository(input.workspaceId).readChatMessages(input);
  }

  async listRoomPosterAgentIds(input: ListChatRoomPosterAgentIdsInput): Promise<string[]> {
    return this.repository(input.workspaceId).listChatRoomPosterAgentIds(input.room);
  }

  async waitForMessages(input: WaitForChatMessagesInput): Promise<ChatMessage[]> {
    const repository = this.repository(input.workspaceId);
    const roomId = repository.resolveChatRoomId(input.room);
    const timeoutMs = Math.max(0, Math.floor(input.timeoutMs ?? 0));
    const afterMessageId = trimToNull(input.afterMessageId);
    if (afterMessageId) {
      const existing = repository.selectChatMessagesAfter(roomId, afterMessageId);
      if (existing.length > 0) return existing;
      if (!repository.getChatMessage(afterMessageId)) {
        throw new WorkspaceCoordinationError(
          "chat_message_not_found",
          `Wait cursor not found: ${afterMessageId}`,
        );
      }
    }
    return new Promise<ChatMessage[]>((resolve, reject) => {
      const waiter: Waiter = {
        workspaceId: input.workspaceId,
        roomId,
        afterMessageId,
        resolve: (messages) => {
          if (waiter.timeout) clearTimeout(waiter.timeout);
          waiter.timeout = null;
          this.removeWaiter(waiter);
          resolve(messages);
        },
        reject: (error) => {
          if (waiter.timeout) clearTimeout(waiter.timeout);
          waiter.timeout = null;
          this.removeWaiter(waiter);
          reject(error);
        },
        timeout: null,
      };
      if (timeoutMs > 0) waiter.timeout = setTimeout(() => waiter.resolve([]), timeoutMs);
      const key = this.waiterKey(input.workspaceId, roomId);
      const waiters = this.waiters.get(key) ?? new Set<Waiter>();
      waiters.add(waiter);
      this.waiters.set(key, waiters);
    });
  }

  importSnapshot(workspaceId: string, value: unknown): { rooms: number; messages: number } {
    return this.repository(workspaceId).importChatSnapshot(ChatStorePayloadSchema.parse(value));
  }

  private repository(workspaceId: string): WorkspaceCoordinationRepository {
    return this.authority.forWorkspace(workspaceId).coordination;
  }

  private notifyWaiters(workspaceId: string, roomId: string): void {
    const key = this.waiterKey(workspaceId, roomId);
    const waiters = this.waiters.get(key);
    if (!waiters) return;
    const repository = this.repository(workspaceId);
    for (const waiter of Array.from(waiters)) {
      const messages = waiter.afterMessageId
        ? repository.selectChatMessagesAfter(roomId, waiter.afterMessageId)
        : repository.latestChatRoomMessage(roomId);
      if (messages.length > 0) waiter.resolve(messages);
    }
  }

  private removeWaiter(waiter: Waiter): void {
    const key = this.waiterKey(waiter.workspaceId, waiter.roomId);
    const waiters = this.waiters.get(key);
    if (!waiters) return;
    waiters.delete(waiter);
    if (waiters.size === 0) this.waiters.delete(key);
  }

  private rejectWaiters(workspaceId: string, roomId: string, error: Error): void {
    const waiters = this.waiters.get(this.waiterKey(workspaceId, roomId));
    if (!waiters) return;
    for (const waiter of Array.from(waiters)) waiter.reject(error);
  }

  private waiterKey(workspaceId: string, roomId: string): string {
    return `${workspaceId}:${roomId}`;
  }
}
