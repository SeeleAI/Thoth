import type { Command } from "commander";
import type { ListResult } from "../../output/index.js";
import {
  addTaskAuthorityOptions,
  connectTaskAuthority,
  rethrowTaskCommandError,
  type TaskAuthorityOptions,
} from "./shared.js";
import { taskRowSchema, toTaskRow, type TaskRow } from "./types.js";

export function addTaskListOptions(command: Command): Command {
  return addTaskAuthorityOptions(command.description("List Tasks in the current Workspace"));
}

export async function runTaskListCommand(
  options: TaskAuthorityOptions,
  _command: Command,
): Promise<ListResult<TaskRow>> {
  const { client, workspaceId } = await connectTaskAuthority(options);
  try {
    const payload = await client.listTasks(workspaceId);
    if (payload.error) {
      throw new Error(payload.error);
    }
    return { type: "list", data: payload.tasks.map(toTaskRow), schema: taskRowSchema };
  } catch (error) {
    rethrowTaskCommandError("TASK_LIST_FAILED", error);
  } finally {
    await client.close().catch(() => {});
  }
}
