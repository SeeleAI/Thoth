import type { TaskProjection } from "@thoth/protocol/task-authority";
import type { ComposerAttachment, UserComposerAttachment } from "@/attachments/types";

export function listSelectedTaskContextIds(attachments: readonly ComposerAttachment[]): string[] {
  return attachments.flatMap((attachment) =>
    attachment.kind === "task_context" ? [attachment.reference.taskId] : [],
  );
}

export function appendTaskContextAttachment(
  attachments: readonly UserComposerAttachment[],
  task: TaskProjection,
): UserComposerAttachment[] {
  if (
    attachments.some(
      (attachment) => attachment.kind === "task_context" && attachment.reference.taskId === task.id,
    )
  ) {
    return [...attachments];
  }

  return [
    ...attachments,
    {
      kind: "task_context",
      reference: {
        kind: "task",
        workspaceId: task.workspaceId,
        taskId: task.id,
        revision: task.revision,
      },
      title: task.title,
      status: task.status,
    },
  ];
}
