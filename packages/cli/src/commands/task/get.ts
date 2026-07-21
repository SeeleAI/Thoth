import type { Command } from "commander";
import type {
  HumanDecisionRecord,
  ExecutionProjection,
  TaskProjection,
} from "@thoth/protocol/task-authority";
import type { OutputSchema, SingleResult } from "../../output/index.js";
import {
  addTaskAuthorityOptions,
  connectTaskAuthority,
  rethrowTaskCommandError,
  type TaskAuthorityOptions,
} from "./shared.js";

interface TaskDetailRow {
  id: string;
  title: string;
  mode: string;
  status: string;
  revision: number;
  executions: number;
  decisions: number;
  detail: {
    task: TaskProjection;
    executions: ExecutionProjection[];
    decisions: HumanDecisionRecord[];
  };
}

const taskDetailSchema: OutputSchema<TaskDetailRow> = {
  idField: "id",
  columns: [
    { header: "TASK ID", field: "id", width: 18 },
    { header: "TITLE", field: "title", width: 34 },
    { header: "MODE", field: "mode", width: 7 },
    { header: "STATUS", field: "status", width: 18 },
    { header: "REV", field: "revision", width: 5, align: "right" },
    { header: "EXECUTIONS", field: "executions", width: 10, align: "right" },
    { header: "DECISIONS", field: "decisions", width: 9, align: "right" },
  ],
  serialize: (row) => row.detail,
};

export function addTaskGetOptions(command: Command): Command {
  return addTaskAuthorityOptions(
    command
      .description("Show Task, Goal, Execution, and human-decision authority")
      .argument("<task-id>", "Task ID"),
  );
}

export async function runTaskGetCommand(
  taskId: string,
  options: TaskAuthorityOptions,
  _command: Command,
): Promise<SingleResult<TaskDetailRow>> {
  const { client, workspaceId } = await connectTaskAuthority(options);
  try {
    const payload = await client.getTask({ workspaceId, taskId });
    if (payload.error || !payload.task) {
      throw new Error(payload.error ?? `Task ${taskId} does not exist in Workspace ${workspaceId}`);
    }
    return {
      type: "single",
      data: {
        id: payload.task.id,
        title: payload.task.title,
        mode: payload.task.mode,
        status: payload.task.status,
        revision: payload.task.revision,
        executions: payload.executions.length,
        decisions: payload.decisions.length,
        detail: {
          task: payload.task,
          executions: payload.executions,
          decisions: payload.decisions,
        },
      },
      schema: taskDetailSchema,
    };
  } catch (error) {
    rethrowTaskCommandError("TASK_GET_FAILED", error);
  } finally {
    await client.close().catch(() => {});
  }
}
