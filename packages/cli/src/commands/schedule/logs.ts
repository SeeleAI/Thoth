import type { Command } from "commander";
import type { ListResult } from "../../output/index.js";
import { scheduleLogSchema, toScheduleLogRow, type ScheduleLogRow } from "./schema.js";
import {
  connectScheduleClient,
  toScheduleCommandError,
  type ScheduleCommandOptions,
} from "./shared.js";

export async function runLogsCommand(
  id: string,
  options: ScheduleCommandOptions,
  _command: Command,
): Promise<ListResult<ScheduleLogRow>> {
  const { client, workspaceId } = await connectScheduleClient(options.host, options.workspace);
  try {
    const payload = await client.scheduleLogs({ workspaceId, id });
    if (payload.error) {
      throw new Error(payload.error);
    }
    return {
      type: "list",
      data: payload.runs.map(toScheduleLogRow),
      schema: scheduleLogSchema,
    };
  } catch (error) {
    throw toScheduleCommandError("SCHEDULE_LOGS_FAILED", "read schedule logs", error);
  } finally {
    await client.close().catch(() => {});
  }
}
