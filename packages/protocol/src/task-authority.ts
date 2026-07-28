import { z } from "zod";
import { ProviderRunModeReceiptSchema } from "./provider-control.js";

const NonEmptyStringSchema = z.string().trim().min(1);

export const TaskExecutionModeSchema = z.enum(["quick", "loop"]);
export const TaskLifecycleSchema = z.enum([
  "queued",
  "running",
  "awaiting_user",
  "paused",
  "stopping",
  "stopped",
  "budget_wait",
  "blocked",
  "completed",
  "interrupted",
]);
export const TaskGoalLifecycleSchema = z.enum([
  "queued",
  "running",
  "awaiting_user",
  "passed",
  "paused",
  "stopped",
  "blocked",
  "interrupted",
]);
export const PhaseRunKindSchema = z.enum(["quick_exec", "planexec", "review", "audit"]);
export const TaskStrengthSchema = z.enum(["single", "light", "balanced", "infinite"]);
export const ExecutionLifecycleSchema = z.enum([
  "created",
  "starting",
  "planning",
  "awaiting_implementation",
  "implementing",
  "running",
  "awaiting_provider",
  "awaiting_user",
  "cancel_requested",
  "canceled",
  "succeeded",
  "failed",
  "orphaned",
]);

export const ExecutionApprovalKindSchema = z.enum([
  "implement",
  "command",
  "file",
  "tool",
  "mode",
  "permission",
]);
export const ExecutionApprovalDecisionSchema = z.enum(["allow", "deny", "implement"]);
export const ExecutionApprovalStatusSchema = z.enum(["pending", "allowed", "denied", "canceled"]);

export const ExecutionApprovalProjectionSchema = z
  .object({
    id: NonEmptyStringSchema,
    taskId: NonEmptyStringSchema,
    executionId: NonEmptyStringSchema,
    kind: ExecutionApprovalKindSchema,
    title: NonEmptyStringSchema,
    description: z.string().nullable(),
    displayed: z.unknown(),
    deadlineAt: NonEmptyStringSchema.nullable(),
    status: ExecutionApprovalStatusSchema,
    resolution: z
      .object({
        decision: ExecutionApprovalDecisionSchema,
        actorId: NonEmptyStringSchema,
        resolvedAt: NonEmptyStringSchema,
      })
      .strict()
      .nullable(),
    revision: z.number().int().positive(),
    createdAt: NonEmptyStringSchema,
    updatedAt: NonEmptyStringSchema,
  })
  .strict();

export const TaskContextReferenceSchema = z
  .object({
    kind: z.literal("task"),
    workspaceId: NonEmptyStringSchema,
    taskId: NonEmptyStringSchema,
    revision: z.number().int().nonnegative(),
  })
  .strict();

export const RuntimeAttachmentProjectionSchema = z
  .object({
    id: NonEmptyStringSchema,
    bundleId: z.enum(["thoth.clarify", "thoth.loop"]),
    bundleDigest: NonEmptyStringSchema,
    status: z.enum(["attached", "rejected", "revoked"]),
    attachedAt: NonEmptyStringSchema,
  })
  .strict();

export const HumanDecisionRecordSchema = z
  .object({
    id: NonEmptyStringSchema,
    workspaceId: NonEmptyStringSchema,
    taskId: NonEmptyStringSchema.nullable(),
    turnId: NonEmptyStringSchema.nullable(),
    cardId: NonEmptyStringSchema.nullable(),
    kind: NonEmptyStringSchema,
    displayed: z.unknown(),
    rawAnswer: z.unknown(),
    normalized: z.unknown(),
    actorId: NonEmptyStringSchema,
    clientId: NonEmptyStringSchema,
    deviceId: NonEmptyStringSchema.nullable(),
    commandId: NonEmptyStringSchema,
    expectedRevision: z.number().int().nonnegative(),
    resultRevision: z.number().int().positive(),
    supersedesDecisionId: NonEmptyStringSchema.nullable(),
    fidelity: z.enum(["exact", "reconstructed", "unavailable"]),
    decidedAt: NonEmptyStringSchema,
  })
  .strict();

export const TaskGoalProjectionSchema = z
  .object({
    id: NonEmptyStringSchema,
    order: z.number().int().positive(),
    title: NonEmptyStringSchema,
    goal: NonEmptyStringSchema,
    constraints: z.array(NonEmptyStringSchema),
    acceptance: z.array(NonEmptyStringSchema).min(1),
    status: TaskGoalLifecycleSchema,
    revision: z.number().int().nonnegative(),
  })
  .strict();

export const TaskUserDecisionOptionSchema = z
  .object({
    id: NonEmptyStringSchema,
    label: NonEmptyStringSchema,
    description: z.string().optional(),
  })
  .strict();

export const TaskUserDecisionProjectionSchema = z
  .object({
    id: NonEmptyStringSchema,
    title: NonEmptyStringSchema,
    question: NonEmptyStringSchema,
    options: z.array(TaskUserDecisionOptionSchema).min(2).max(4),
    notePlaceholder: z.string().optional(),
    createdAt: NonEmptyStringSchema,
  })
  .strict();

export const ExecutionProjectionSchema = z
  .object({
    id: NonEmptyStringSchema,
    taskId: NonEmptyStringSchema,
    goalId: NonEmptyStringSchema.nullable(),
    phaseRunId: NonEmptyStringSchema,
    phase: PhaseRunKindSchema,
    providerThreadId: NonEmptyStringSchema.nullable(),
    status: ExecutionLifecycleSchema,
    generation: NonEmptyStringSchema,
    attachment: RuntimeAttachmentProjectionSchema.nullable(),
    runModeReceipt: ProviderRunModeReceiptSchema.nullable().default(null),
    pendingApproval: ExecutionApprovalProjectionSchema.nullable().default(null),
    latestApproval: ExecutionApprovalProjectionSchema.nullable().optional(),
    startedAt: NonEmptyStringSchema.nullable(),
    lastActivityAt: NonEmptyStringSchema.nullable(),
    completedAt: NonEmptyStringSchema.nullable(),
    summary: z.string().nullable(),
    revision: z.number().int().positive(),
  })
  .strict();

export const TaskOriginSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("schedule"),
      ownerWorkspaceId: NonEmptyStringSchema,
      scheduleId: NonEmptyStringSchema,
      runId: NonEmptyStringSchema,
    })
    .strict(),
]);

export const TaskProjectionSchema = z
  .object({
    id: NonEmptyStringSchema,
    workspaceId: NonEmptyStringSchema,
    sourceAgentId: NonEmptyStringSchema,
    mode: TaskExecutionModeSchema,
    title: NonEmptyStringSchema,
    goal: NonEmptyStringSchema,
    constraints: z.array(NonEmptyStringSchema),
    acceptance: z.array(NonEmptyStringSchema).min(1),
    status: TaskLifecycleSchema,
    summary: z.string(),
    currentGoalId: NonEmptyStringSchema.nullable(),
    currentExecutionId: NonEmptyStringSchema.nullable(),
    goals: z.array(TaskGoalProjectionSchema).min(1),
    latestReviewDirection: z.string().nullable(),
    origin: TaskOriginSchema.nullable().default(null),
    pendingDecision: TaskUserDecisionProjectionSchema.nullable().default(null),
    budget: z
      .object({
        strength: TaskStrengthSchema,
        usedFailedReviews: z.number().int().nonnegative(),
        maxFailedReviews: z.number().int().positive(),
        activeDurationMs: z.number().int().nonnegative(),
        tokenCount: z.number().int().nonnegative(),
        toolCallCount: z.number().int().nonnegative(),
      })
      .strict()
      .default({
        strength: "single",
        usedFailedReviews: 0,
        maxFailedReviews: 1,
        activeDurationMs: 0,
        tokenCount: 0,
        toolCallCount: 0,
      }),
    pendingControl: z
      .enum(["pause", "resume", "stop", "raise_budget", "review_only"])
      .nullable()
      .default(null),
    revision: z.number().int().positive(),
    createdAt: NonEmptyStringSchema,
    updatedAt: NonEmptyStringSchema,
  })
  .strict();

export const TaskBlackboardEntrySchema = z
  .object({
    id: NonEmptyStringSchema,
    taskId: NonEmptyStringSchema,
    kind: z.enum([
      "task_contract",
      "goal_contract",
      "human_decision",
      "workspace_fact",
      "planexec_report",
      "review_direction",
      "review_assessment",
      "evidence_summary",
      "blocker",
      "user_decision_request",
      "replan_proposal",
    ]),
    producer: z.enum(["user", "secretary", "planexec", "review", "daemon"]),
    content: z.unknown(),
    contentDigest: NonEmptyStringSchema,
    createdAt: NonEmptyStringSchema,
  })
  .strict();

export const TaskContextEnvelopeSchema = z
  .object({
    reference: TaskContextReferenceSchema,
    task: TaskProjectionSchema,
    decisions: z.array(HumanDecisionRecordSchema),
    blackboard: z.array(TaskBlackboardEntrySchema),
    generatedAt: NonEmptyStringSchema,
  })
  .strict();

export const TaskCommandSchema = z.enum(["pause", "resume", "stop", "raise_budget", "review_only"]);

export const TaskListRequestSchema = z
  .object({
    type: z.literal("task.list.request"),
    requestId: NonEmptyStringSchema,
    workspaceId: NonEmptyStringSchema,
  })
  .strict();
export const TaskGetRequestSchema = z
  .object({
    type: z.literal("task.get.request"),
    requestId: NonEmptyStringSchema,
    workspaceId: NonEmptyStringSchema,
    taskId: NonEmptyStringSchema,
  })
  .strict();
export const TaskCommandRequestSchema = z
  .object({
    type: z.literal("task.command.request"),
    requestId: NonEmptyStringSchema,
    workspaceId: NonEmptyStringSchema,
    taskId: NonEmptyStringSchema,
    command: TaskCommandSchema,
    expectedRevision: z.number().int().positive(),
    commandId: NonEmptyStringSchema,
  })
  .strict();
export const TaskContextSearchRequestSchema = z
  .object({
    type: z.literal("task.context.search.request"),
    requestId: NonEmptyStringSchema,
    workspaceId: NonEmptyStringSchema,
    query: z.string(),
    limit: z.number().int().positive().max(50).default(20),
  })
  .strict();
export const TaskContextGetRequestSchema = z
  .object({
    type: z.literal("task.context.get.request"),
    requestId: NonEmptyStringSchema,
    workspaceId: NonEmptyStringSchema,
    taskId: NonEmptyStringSchema,
    revision: z.number().int().nonnegative().optional(),
  })
  .strict();
export const TaskDecisionAnswerRequestSchema = z
  .object({
    type: z.literal("task.decision.answer.request"),
    requestId: NonEmptyStringSchema,
    workspaceId: NonEmptyStringSchema,
    taskId: NonEmptyStringSchema,
    decisionId: NonEmptyStringSchema,
    optionId: NonEmptyStringSchema,
    note: z.string().optional(),
    expectedRevision: z.number().int().positive(),
    commandId: NonEmptyStringSchema,
  })
  .strict();
export const ExecutionTimelineRequestSchema = z
  .object({
    type: z.literal("execution.timeline.request"),
    requestId: NonEmptyStringSchema,
    workspaceId: NonEmptyStringSchema,
    taskId: NonEmptyStringSchema,
    executionId: NonEmptyStringSchema,
    beforeSeq: z.number().int().positive().optional(),
    limit: z.number().int().positive().max(500).default(100),
  })
  .strict();
export const ExecutionApprovalResolveRequestSchema = z
  .object({
    type: z.literal("execution.approval.resolve.request"),
    requestId: NonEmptyStringSchema,
    workspaceId: NonEmptyStringSchema,
    taskId: NonEmptyStringSchema,
    executionId: NonEmptyStringSchema,
    approvalId: NonEmptyStringSchema,
    decision: ExecutionApprovalDecisionSchema,
    expectedRevision: z.number().int().positive(),
    commandId: NonEmptyStringSchema,
  })
  .strict();

export const TaskListResponseSchema = z.object({
  type: z.literal("task.list.response"),
  payload: z.object({
    requestId: NonEmptyStringSchema,
    tasks: z.array(TaskProjectionSchema),
    error: z.string().nullable(),
  }),
});
export const TaskGetResponseSchema = z.object({
  type: z.literal("task.get.response"),
  payload: z.object({
    requestId: NonEmptyStringSchema,
    task: TaskProjectionSchema.nullable(),
    executions: z.array(ExecutionProjectionSchema),
    decisions: z.array(HumanDecisionRecordSchema),
    error: z.string().nullable(),
  }),
});
export const TaskCommandResponseSchema = z.object({
  type: z.literal("task.command.response"),
  payload: z.object({
    requestId: NonEmptyStringSchema,
    task: TaskProjectionSchema.nullable(),
    execution: ExecutionProjectionSchema.nullable(),
    conflict: z.boolean(),
    duplicate: z.boolean(),
    error: z.string().nullable(),
  }),
});
export const TaskContextSearchResponseSchema = z.object({
  type: z.literal("task.context.search.response"),
  payload: z.object({
    requestId: NonEmptyStringSchema,
    tasks: z.array(TaskProjectionSchema),
    error: z.string().nullable(),
  }),
});
export const TaskContextGetResponseSchema = z.object({
  type: z.literal("task.context.get.response"),
  payload: z.object({
    requestId: NonEmptyStringSchema,
    context: TaskContextEnvelopeSchema.nullable(),
    error: z.string().nullable(),
  }),
});
export const TaskDecisionAnswerResponseSchema = z.object({
  type: z.literal("task.decision.answer.response"),
  payload: z.object({
    requestId: NonEmptyStringSchema,
    task: TaskProjectionSchema.nullable(),
    decision: HumanDecisionRecordSchema.nullable(),
    conflict: z.boolean(),
    duplicate: z.boolean(),
    error: z.string().nullable(),
  }),
});
export const ExecutionTimelineResponseSchema = z.object({
  type: z.literal("execution.timeline.response"),
  payload: z.object({
    requestId: NonEmptyStringSchema,
    execution: ExecutionProjectionSchema.nullable(),
    entries: z.array(
      z.object({
        seq: z.number().int().positive(),
        occurredAt: NonEmptyStringSchema,
        item: z.unknown(),
      }),
    ),
    nextBeforeSeq: z.number().int().positive().nullable(),
    error: z.string().nullable(),
  }),
});
export const ExecutionApprovalResolveResponseSchema = z.object({
  type: z.literal("execution.approval.resolve.response"),
  payload: z.object({
    requestId: NonEmptyStringSchema,
    task: TaskProjectionSchema.nullable(),
    execution: ExecutionProjectionSchema.nullable(),
    approval: ExecutionApprovalProjectionSchema.nullable(),
    conflict: z.boolean(),
    duplicate: z.boolean(),
    error: z.string().nullable(),
  }),
});

export const WorkspaceAuthorityUpdateSchema = z.object({
  type: z.literal("workspace.authority.update"),
  payload: z.object({
    workspaceId: NonEmptyStringSchema,
    seq: z.number().int().positive(),
    changedTaskIds: z.array(NonEmptyStringSchema),
    changedExecutionIds: z.array(NonEmptyStringSchema),
  }),
});

export type TaskExecutionMode = z.infer<typeof TaskExecutionModeSchema>;
export type TaskStrength = z.infer<typeof TaskStrengthSchema>;
export type TaskLifecycle = z.infer<typeof TaskLifecycleSchema>;
export type ExecutionLifecycle = z.infer<typeof ExecutionLifecycleSchema>;
export type ExecutionApprovalKind = z.infer<typeof ExecutionApprovalKindSchema>;
export type ExecutionApprovalDecision = z.infer<typeof ExecutionApprovalDecisionSchema>;
export type ExecutionApprovalStatus = z.infer<typeof ExecutionApprovalStatusSchema>;
export type ExecutionApprovalProjection = z.infer<typeof ExecutionApprovalProjectionSchema>;
export type TaskContextReference = z.infer<typeof TaskContextReferenceSchema>;
export type RuntimeAttachmentProjection = z.infer<typeof RuntimeAttachmentProjectionSchema>;
export type HumanDecisionRecord = z.infer<typeof HumanDecisionRecordSchema>;
export type TaskGoalProjection = z.infer<typeof TaskGoalProjectionSchema>;
export type TaskUserDecisionOption = z.infer<typeof TaskUserDecisionOptionSchema>;
export type TaskUserDecisionProjection = z.infer<typeof TaskUserDecisionProjectionSchema>;
export type ExecutionProjection = z.infer<typeof ExecutionProjectionSchema>;
export type TaskOrigin = z.infer<typeof TaskOriginSchema>;
export type TaskProjection = z.infer<typeof TaskProjectionSchema>;
export type TaskBlackboardEntry = z.infer<typeof TaskBlackboardEntrySchema>;
export type TaskContextEnvelope = z.infer<typeof TaskContextEnvelopeSchema>;
export type TaskCommand = z.infer<typeof TaskCommandSchema>;
