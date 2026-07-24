import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
  addPendingAgentMessage,
  readPendingAgentMessages,
  removePendingAgentMessage,
  resolvePendingAgentMessages,
} from "@/projection/pending-agent-messages";

const message = {
  messageId: "message-1",
  text: "hello",
  timestamp: new Date(0),
  images: [],
  attachments: [],
};

describe("pending AgentTimeline messages", () => {
  it("adds each message once and resolves it by canonical message id", () => {
    const client = new QueryClient();
    addPendingAgentMessage(client, "server", "agent", message);
    addPendingAgentMessage(client, "server", "agent", message);
    expect(readPendingAgentMessages(client, "server", "agent")).toEqual([
      { ...message, status: "pending" },
    ]);
    resolvePendingAgentMessages(client, "server", "agent", new Set([message.messageId]));
    expect(readPendingAgentMessages(client, "server", "agent")).toEqual([
      { ...message, status: "confirmed" },
    ]);
  });

  it("removes a failed send without touching adjacent pending messages", () => {
    const client = new QueryClient();
    addPendingAgentMessage(client, "server", "agent", message);
    addPendingAgentMessage(client, "server", "agent", { ...message, messageId: "message-2" });
    removePendingAgentMessage(client, "server", "agent", message.messageId);
    expect(
      readPendingAgentMessages(client, "server", "agent").map(({ messageId }) => messageId),
    ).toEqual(["message-2"]);
  });
});
