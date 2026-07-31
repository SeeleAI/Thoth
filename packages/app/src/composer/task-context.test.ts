import { describe, expect, it, vi } from "vitest";
import type { TFunction } from "i18next";
import { TaskProjectionSchema, type TaskProjection } from "@thoth/protocol/task-authority";
import { splitComposerAttachmentsForSubmit } from "@/composer/attachments/submit";
import { removeComposerAttachmentAtIndex } from "@/composer/actions";
import { buildAgentAutocompleteOptions } from "@/hooks/use-agent-autocomplete";
import { appendTaskContextAttachment, listSelectedTaskContextIds } from "@/composer/task-context";

function createTask(overrides: Partial<TaskProjection> = {}): TaskProjection {
  const now = "2026-07-21T00:00:00.000Z";
  return TaskProjectionSchema.parse({
    id: "task-background",
    workspaceId: "workspace-product",
    sourceAgentWorkspaceId: "workspace-product",
    sourceAgentId: "agent-secretary",
    mode: "loop",
    title: "Background implementation",
    intentContract: {
      id: "intent-contract-background",
      workspaceId: "workspace-product",
      sourceAgentId: "agent-secretary",
      taskId: "task-background",
      title: "Background implementation",
      objective: "Complete the approved work.",
      nonGoals: [],
      invariants: ["Stay in the Workspace authority."],
      acceptanceClaims: [
        {
          id: "claim-review-passes",
          statement: "Independent Review passes.",
          status: "open",
          evidenceRefs: [],
          revision: 1,
        },
      ],
      riskBoundary: [],
      humanDecisionRefs: ["decision-contract-approved"],
      escalationPolicy: { returnToHumanWhen: [], finalConfirmation: "automatic" },
      status: "confirmed",
      revision: 1,
      confirmedAt: now,
      createdAt: now,
      updatedAt: now,
    },
    status: "running",
    summary: "The current Work Unit is running.",
    currentExecutionId: "execution-one",
    currentWorkUnitId: "work-unit-one",
    workingSet: {
      taskId: "task-background",
      activeGap: "Implement the approved change.",
      currentUnderstanding: "The Intent Contract is confirmed.",
      currentHypothesis: "One focused implementation can close the active gap.",
      nextMove: "Implement and collect evidence.",
      relevantEvidenceRefs: [],
      rejectedRoutes: [],
      blockers: [],
      latestReviewDecisionId: null,
      noProgressCount: 0,
      revision: 1,
      updatedAt: now,
    },
    workUnits: [
      {
        id: "work-unit-one",
        taskId: "task-background",
        cycleId: "cycle-one",
        title: "Implement",
        activeGap: "Implement the approved change.",
        progressClaim: "Implementation has started.",
        unresolvedGap: "Independent Review has not run.",
        evidenceRefs: [],
        status: "active",
        revision: 1,
        createdAt: now,
        updatedAt: now,
      },
    ],
    latestReview: null,
    completionAuthority: "none",
    origin: null,
    pendingDecision: null,
    budget: {
      strength: "light",
      usedNonCompleteReviews: 0,
      maxNonCompleteReviews: 5,
      activeDurationMs: 1200,
      tokenCount: 800,
      toolCallCount: 4,
    },
    pendingControl: null,
    revision: 7,
    createdAt: now,
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
