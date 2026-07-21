import type { Command } from "commander";
import type { ListResult } from "../../output/index.js";
import { connectChatClient, toChatCommandError, type ChatCommandOptions } from "./shared.js";
import { chatRoomSchema, type ChatRoomRow, toChatRoomRow } from "./schema.js";

export async function runLsCommand(
  options: ChatCommandOptions,
  _command: Command,
): Promise<ListResult<ChatRoomRow>> {
  const { client, workspaceId } = await connectChatClient(options.host, options.workspace);
  try {
    const payload = await client.listChatRooms({ workspaceId });
    return {
      type: "list",
      data: payload.rooms.map(toChatRoomRow),
      schema: chatRoomSchema,
    };
  } catch (err) {
    throw toChatCommandError("CHAT_LIST_FAILED", "list chat rooms", err);
  } finally {
    await client.close().catch(() => {});
  }
}
