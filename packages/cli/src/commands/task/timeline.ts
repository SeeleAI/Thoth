import type { Command } from "commander";
import type { OutputSchema, ListResult } from "../../output/index.js";
import {
  addTaskAuthorityOptions,
  connectTaskAuthority,
  rethrowTaskCommandError,
  type TaskAuthorityOptions,
} from "./shared.js";

interface ExecutionTimelineRow {
  seq: number;
  occurredAt: string;
  executionId: string;
  phase: string;
  item: string;
  rawItem: unknown;
}

const executionTimelineSchema: OutputSchema<ExecutionTimelineRow> = {
  idField: (row) => `${row.executionId}:${row.seq}`,
  columns: [
    { header: "SEQ", field: "seq", width: 7, align: "right" },
    { header: "OCCURRED", field: "occurredAt", width: 24 },
    { header: "PHASE", field: "phase", width: 10 },
    { header: "EXECUTION", field: "executionId", width: 18 },
    { header: "ITEM", field: "item", width: 70 },
  ],
  serialize: (row) => ({
    seq: row.seq,
    occurredAt: row.occurredAt,
    executionId: row.executionId,
    phase: row.phase,
    item: row.rawItem,
  }),
};

export interface TaskTimelineOptions extends TaskAuthorityOptions {
  limit?: string;
}

export function addTaskTimelineOptions(command: Command): Command {
  return addTaskAuthorityOptions(
    command
      .description("Show the durable timeline for a Task Execution")
      .argument("<task-id>", "Task ID")
      .argument("[execution-id]", "Execution ID; defaults to the latest Execution")
      .option("--limit <count>", "Maximum entries", "100"),
  );
}

function parseLimit(value: string | undefined): number {
  const limit = Number.parseInt(value ?? "100", 10);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new Error("--limit must be an integer from 1 to 500");
  }
  return limit;
}

export async function runTaskTimelineCommand(
  taskId: string,
  executionId: string | undefined,
  options: TaskTimelineOptions,
  _command: Command,
): Promise<ListResult<ExecutionTimelineRow>> {
  const { client, workspaceId } = await connectTaskAuthority(options);
  try {
    const detail = await client.getTask({ workspaceId, taskId });
    if (detail.error || !detail.task) {
      throw new Error(detail.error ?? `Task ${taskId} does not exist in Workspace ${workspaceId}`);
    }
    const execution = executionId
      ? detail.executions.find((candidate) => candidate.id === executionId)
      : detail.executions.at(-1);
    if (!execution) {
      throw new Error(
        executionId
          ? `Execution ${executionId} does not belong to Task ${taskId}`
          : `Task ${taskId} has no Execution timeline yet`,
      );
    }
    const payload = await client.getExecutionTimeline({
      workspaceId,
      taskId,
      executionId: execution.id,
      limit: parseLimit(options.limit),
    });
    if (payload.error) {
      throw new Error(payload.error);
    }
    return {
      type: "list",
      data: payload.entries.map((entry) => ({
        seq: entry.seq,
        occurredAt: entry.occurredAt,
        executionId: execution.id,
        phase: execution.phase,
        item: JSON.stringify(entry.item),
        rawItem: entry.item,
      })),
      schema: executionTimelineSchema,
    };
  } catch (error) {
    rethrowTaskCommandError("TASK_TIMELINE_FAILED", error);
  } finally {
    await client.close().catch(() => {});
  }
}
