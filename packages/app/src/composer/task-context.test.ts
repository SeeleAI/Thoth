import { describe, expect, it, vi } from "vitest";
import type { TFunction } from "i18next";
import { TaskProjectionSchema, type TaskProjection } from "@thoth/protocol/task-authority";
import { splitComposerAttachmentsForSubmit } from "@/composer/attachments/submit";
import { removeComposerAttachmentAtIndex } from "@/composer/actions";
import { buildAgentAutocompleteOptions } from "@/hooks/use-agent-autocomplete";
import { appendTaskContextAttachment, listSelectedTaskContextIds } from "@/composer/task-context";

function createTask(overrides: Partial<TaskProjection> = {}): TaskProjection {
  return TaskProjectionSchema.parse({
    id: "task-background",
    workspaceId: "workspace-product",
    sourceAgentId: "agent-secretary",
    mode: "loop",
    title: "Background implementation",
    goal: "Complete the approved work.",
    constraints: ["Stay in the Workspace authority."],
    acceptance: ["Independent Review passes."],
    status: "running",
    summary: "PlanExec is running.",
    currentGoalId: "goal-one",
    currentExecutionId: "execution-one",
    goals: [
      {
        id: "goal-one",
        order: 1,
        title: "Implement",
        goal: "Implement the approved change.",
        constraints: [],
        acceptance: ["Review passes."],
        status: "running",
        revision: 1,
      },
    ],
    latestReviewDirection: null,
    pendingDecision: null,
    budget: {
      strength: "light",
      usedFailedReviews: 0,
      maxFailedReviews: 5,
      activeDurationMs: 1200,
      tokenCount: 800,
      toolCallCount: 4,
    },
    pendingControl: null,
    revision: 7,
    createdAt: "2026-07-21T00:00:00.000Z",
    updatedAt: "2026-07-21T00:01:00.000Z",
    ...overrides,
  });
}

const translate = ((key: string) => key) as TFunction;

describe("Task context composer contract", () => {
  it("offers same-Workspace Tasks before files and omits an already selected Task", () => {
    const task = createTask();
    const base = {
      isVisible: true,
      mode: "file" as const,
      commands: [],
      isDraftContext: false,
      commandFilterQuery: "background",
      activeSlashCommand: null,
      activeFileMention: { start: 7, end: 18, query: "background" },
      fileSuggestions: [{ path: "src/background.ts", kind: "file" as const }],
      taskSuggestions: [task],
      t: translate,
    };

    const options = buildAgentAutocompleteOptions({ ...base, selectedTaskIds: new Set() });
    expect(options.map((option) => option.id)).toEqual([
      "task:task-background",
      "file:src/background.ts",
    ]);
    expect(options[0]).toMatchObject({
      kind: "task",
      label: task.title,
      detail: "running",
    });

    expect(
      buildAgentAutocompleteOptions({
        ...base,
        selectedTaskIds: new Set([task.id]),
      }).map((option) => option.id),
    ).toEqual(["file:src/background.ts"]);
  });

  it("freezes a Task token at its selected revision and sends only a structured contextRef", () => {
    const task = createTask();
    const attachments = appendTaskContextAttachment([], task);
    expect(listSelectedTaskContextIds(attachments)).toEqual([task.id]);
    expect(attachments[0]).toMatchObject({
      kind: "task_context",
      reference: {
        kind: "task",
        workspaceId: task.workspaceId,
        taskId: task.id,
        revision: 7,
      },
    });

    const duplicate = appendTaskContextAttachment(attachments, {
      ...task,
      revision: 8,
    });
    expect(duplicate).toEqual(attachments);

    const wire = splitComposerAttachmentsForSubmit(attachments);
    expect(wire).toEqual({
      images: [],
      attachments: [],
      contextRefs: [
        {
          kind: "task",
          workspaceId: task.workspaceId,
          taskId: task.id,
          revision: 7,
        },
      ],
    });
    expect(JSON.stringify(wire)).not.toContain("/Users/");
  });

  it("removes the Task token without invoking binary attachment cleanup", () => {
    const attachments = appendTaskContextAttachment([], createTask());
    const deleteAttachments = vi.fn();
    expect(removeComposerAttachmentAtIndex({ attachments, index: 0, deleteAttachments })).toEqual(
      [],
    );
    expect(deleteAttachments).not.toHaveBeenCalled();
  });
});
