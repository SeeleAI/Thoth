import type { Command } from "commander";
import type { ListResult } from "../../output/index.js";
import { scheduleSchema } from "./schema.js";
import {
  connectScheduleClient,
  toScheduleCommandError,
  toScheduleRow,
  type ScheduleCommandOptions,
  type ScheduleRow,
} from "./shared.js";

export async function runLsCommand(
  options: ScheduleCommandOptions,
  _command: Command,
): Promise<ListResult<ScheduleRow>> {
  const { client, workspaceId } = await connectScheduleClient(options.host, options.workspace);
  try {
    const payload = await client.scheduleList({ workspaceId });
    if (payload.error) {
      throw new Error(payload.error);
    }
    return {
      type: "list",
      data: payload.schedules.map(toScheduleRow),
      schema: scheduleSchema,
    };
  } catch (error) {
    throw toScheduleCommandError("SCHEDULE_LIST_FAILED", "list schedules", error);
  } finally {
    await client.close().catch(() => {});
  }
}
