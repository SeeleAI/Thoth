import type { QueryClient } from "@tanstack/react-query";
import type { AgentAttachment } from "@thoth/protocol/messages";
import type { AttachmentMetadata } from "@/attachments/types";

export interface PendingAgentMessage {
  messageId: string;
  text: string;
  timestamp: Date;
  images: AttachmentMetadata[];
  attachments: AgentAttachment[];
  status: "pending" | "confirmed";
}

export const pendingAgentMessagesKey = (serverId: string, agentId: string) =>
  ["agent-message-pending", serverId, agentId] as const;

export function readPendingAgentMessages(
  queryClient: QueryClient,
  serverId: string,
  agentId: string,
): readonly PendingAgentMessage[] {
  return queryClient.getQueryData(pendingAgentMessagesKey(serverId, agentId)) ?? [];
}

export function addPendingAgentMessage(
  queryClient: QueryClient,
  serverId: string,
  agentId: string,
  message: Omit<PendingAgentMessage, "status">,
): void {
  queryClient.setQueryData<readonly PendingAgentMessage[]>(
    pendingAgentMessagesKey(serverId, agentId),
    (current = []) => [
      ...current.filter((item) => item.messageId !== message.messageId),
      { ...message, status: "pending" },
    ],
  );
}

export function resolvePendingAgentMessages(
  queryClient: QueryClient,
  serverId: string,
  agentId: string,
  messageIds: ReadonlySet<string>,
): void {
  if (messageIds.size === 0) return;
  queryClient.setQueryData<readonly PendingAgentMessage[]>(
    pendingAgentMessagesKey(serverId, agentId),
    (current = []) =>
      current.map((item) =>
        messageIds.has(item.messageId) && item.status !== "confirmed"
          ? { ...item, status: "confirmed" as const }
          : item,
      ),
  );
}

export function removePendingAgentMessage(
  queryClient: QueryClient,
  serverId: string,
  agentId: string,
  messageId: string,
): void {
  queryClient.setQueryData<readonly PendingAgentMessage[]>(
    pendingAgentMessagesKey(serverId, agentId),
    (current = []) => current.filter((item) => item.messageId !== messageId),
  );
}
