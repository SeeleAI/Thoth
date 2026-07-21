import { randomUUID } from "node:crypto";
import type { Command } from "commander";
import type { TaskCommand } from "@thoth/protocol/task-authority";
import type { SingleResult } from "../../output/index.js";
import {
  addTaskAuthorityOptions,
  connectTaskAuthority,
  rethrowTaskCommandError,
  type TaskAuthorityOptions,
} from "./shared.js";
import { taskRowSchema, toTaskRow, type TaskRow } from "./types.js";

export type TaskControlCommand = Extract<TaskCommand, "pause" | "resume" | "stop">;

const descriptions: Record<TaskControlCommand, string> = {
  pause: "Pause a Task at the current atomic phase boundary",
  resume: "Resume a paused, interrupted, or budget-waiting Task",
  stop: "Stop a Task and immediately fence its active Execution",
};

export function addTaskControlOptions(command: Command, action: TaskControlCommand): Command {
  return addTaskAuthorityOptions(
    command.description(descriptions[action]).argument("<task-id>", "Task ID"),
  );
}

export async function runTaskControlCommand(
  action: TaskControlCommand,
  taskId: string,
  options: TaskAuthorityOptions,
  _command: Command,
): Promise<SingleResult<TaskRow>> {
  const { client, workspaceId } = await connectTaskAuthority(options);
  try {
    const current = await client.getTask({ workspaceId, taskId });
    if (current.error || !current.task) {
      throw new Error(current.error ?? `Task ${taskId} does not exist in Workspace ${workspaceId}`);
    }
    const payload = await client.commandTask({
      workspaceId,
      taskId,
      command: action,
      expectedRevision: current.task.revision,
      commandId: `cli-${action}-${randomUUID()}`,
    });
    if (payload.conflict) {
      throw new Error(payload.error ?? "Task authority changed before the command committed");
    }
    if (payload.error || !payload.task) {
      throw new Error(payload.error ?? `Task ${action} did not return authority state`);
    }
    return { type: "single", data: toTaskRow(payload.task), schema: taskRowSchema };
  } catch (error) {
    rethrowTaskCommandError(`TASK_${action.toUpperCase()}_FAILED`, error);
  } finally {
    await client.close().catch(() => {});
  }
}

export function runTaskPauseCommand(
  taskId: string,
  options: TaskAuthorityOptions,
  command: Command,
): Promise<SingleResult<TaskRow>> {
  return runTaskControlCommand("pause", taskId, options, command);
}

export function runTaskResumeCommand(
  taskId: string,
  options: TaskAuthorityOptions,
  command: Command,
): Promise<SingleResult<TaskRow>> {
  return runTaskControlCommand("resume", taskId, options, command);
}

export function runTaskStopCommand(
  taskId: string,
  options: TaskAuthorityOptions,
  command: Command,
): Promise<SingleResult<TaskRow>> {
  return runTaskControlCommand("stop", taskId, options, command);
}
