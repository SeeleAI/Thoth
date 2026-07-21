import type { Command } from "commander";
import type { SingleResult } from "../../output/index.js";
import { scheduleSchema } from "./schema.js";
import {
  connectScheduleClient,
  toScheduleCommandError,
  toScheduleRow,
  type ScheduleCommandOptions,
  type ScheduleRow,
} from "./shared.js";

export async function runRunOnceCommand(
  id: string,
  options: ScheduleCommandOptions,
  _command: Command,
): Promise<SingleResult<ScheduleRow>> {
  const { client, workspaceId } = await connectScheduleClient(options.host, options.workspace);
  try {
    const payload = await client.scheduleRunOnce({ workspaceId, id });
    if (payload.error || !payload.schedule) {
      throw new Error(payload.error ?? `Failed to run schedule once: ${id}`);
    }
    return {
      type: "single",
      data: toScheduleRow(payload.schedule),
      schema: scheduleSchema,
    };
  } catch (error) {
    throw toScheduleCommandError("SCHEDULE_RUN_ONCE_FAILED", "run schedule once", error);
  } finally {
    await client.close().catch(() => {});
  }
}
