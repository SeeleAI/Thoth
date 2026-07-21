import type { TaskProjection } from "@thoth/protocol/task-authority";
import type { OutputSchema } from "../../output/index.js";

export interface TaskRow {
  id: string;
  title: string;
  mode: string;
  status: string;
  progress: string;
  revision: number;
  updatedAt: string;
  task: TaskProjection;
}

export function toTaskRow(task: TaskProjection): TaskRow {
  const passed = task.goals.filter((goal) => goal.status === "passed").length;
  return {
    id: task.id,
    title: task.title,
    mode: task.mode,
    status: task.status,
    progress: `${passed}/${task.goals.length}`,
    revision: task.revision,
    updatedAt: task.updatedAt,
    task,
  };
}

export const taskRowSchema: OutputSchema<TaskRow> = {
  idField: "id",
  columns: [
    { header: "TASK ID", field: "id", width: 18 },
    { header: "TITLE", field: "title", width: 32 },
    { header: "MODE", field: "mode", width: 7 },
    { header: "STATUS", field: "status", width: 18 },
    { header: "GOALS", field: "progress", width: 7 },
    { header: "REV", field: "revision", width: 5, align: "right" },
    { header: "UPDATED", field: "updatedAt", width: 24 },
  ],
  serialize: (row) => row.task,
};
