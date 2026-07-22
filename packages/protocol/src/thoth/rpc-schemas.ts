import { z } from "zod";
import { ProviderRunModeReceiptSchema, ProviderRunModeSchema } from "../provider-control.js";
import {
  ClarifyFrontierLedgerSchema,
  ClarifyDecisionDeltaSchema,
  ClarifyLinearGoalContractSchema,
  ClarifyQuestionCardSchema,
  ThothRuntimeClarifyStrengthSchema,
  ThothRuntimeLoopStrengthSchema,
  ThothRuntimeModeSchema,
} from "../thoth-runtime-contract.js";

const NonEmptyStringSchema = z.string().trim().min(1);
const StringListSchema = z.array(NonEmptyStringSchema).min(1);

export const ThothTurnControlSnapshotSchema = z
  .object({
    mode: ThothRuntimeModeSchema,
    clarifyStrength: ThothRuntimeClarifyStrengthSchema.exclude(["deep"]),
    loop: ThothRuntimeLoopStrengthSchema.nullable(),
  })
  .strict();

export const ThothClarifyCardModelSchema = z
  .object({
    id: NonEmptyStringSchema,
    roundLabel: NonEmptyStringSchema,
    roundIndex: z.number().int().positive().optional(),
    title: NonEmptyStringSchema,
    whyNow: z.string(),
    continuesClarify: z.boolean(),
    publicBadgeSummary: NonEmptyStringSchema.optional(),
    frontierLedger: ClarifyFrontierLedgerSchema.optional(),
    frontierLedgerRef: NonEmptyStringSchema.optional(),
    decisionDelta: ClarifyDecisionDeltaSchema.optional(),
    card: ClarifyQuestionCardSchema,
    submitted: z.boolean(),
    submittedSummary: NonEmptyStringSchema.optional(),
    // Persist the actual user decisions so a later foreground execution handoff
    // receives the full Clarify context rather than only a submission count.
    submittedAnswers: z
      .array(
        z
          .object({
            questionId: NonEmptyStringSchema,
            choiceIds: z.array(NonEmptyStringSchema),
            choiceNotes: z.record(NonEmptyStringSchema, z.string()).default({}),
            note: z.string().optional(),
          })
          .strict(),
      )
      .optional(),
    submittedNote: z.string().optional(),
  })
  .strict();

export const ThothTaskCardModelSchema = z
  .object({
    id: NonEmptyStringSchema,
    roundLabel: NonEmptyStringSchema,
    title: NonEmptyStringSchema,
    goal: NonEmptyStringSchema,
    constraints: StringListSchema,
    acceptance: StringListSchema,
    provenanceSummary: NonEmptyStringSchema,
    // Frozen from the composer when the user sent the turn that produced this authority flow.
    // Current controls may hot-switch independently and apply only to a later user send.
    turnControls: ThothTurnControlSnapshotSchema.optional(),
    submitted: z.boolean(),
    submittedSummary: NonEmptyStringSchema.optional(),
  })
  .strict();

export const ThothPyramidPlanSubgoalSchema = z
  .object({
    id: NonEmptyStringSchema,
    title: NonEmptyStringSchema,
    goal: NonEmptyStringSchema,
    acceptance: StringListSchema,
  })
  .strict();

export const ThothPyramidPlanStageSchema = z
  .object({
    id: NonEmptyStringSchema,
    title: NonEmptyStringSchema,
    goal: NonEmptyStringSchema,
    acceptance: StringListSchema,
    subgoals: z.array(ThothPyramidPlanSubgoalSchema),
  })
  .strict();

export const ThothGoalCardModelSchema = z
  .object({
    id: NonEmptyStringSchema,
    roundLabel: NonEmptyStringSchema,
    title: NonEmptyStringSchema,
    summary: NonEmptyStringSchema,
    pyramid: z.array(ThothPyramidPlanStageSchema).min(1),
    provenanceSummary: NonEmptyStringSchema,
    turnControls: ThothTurnControlSnapshotSchema.optional(),
    submitted: z.boolean(),
    submittedSummary: NonEmptyStringSchema.optional(),
  })
  .strict();

export const ThothGoalsCardModelSchema = z
  .object({
    id: NonEmptyStringSchema,
    roundLabel: NonEmptyStringSchema,
    title: NonEmptyStringSchema,
    summary: NonEmptyStringSchema,
    goalsCountRationale: z.string().optional(),
    goals: z.array(ClarifyLinearGoalContractSchema).min(1),
    provenanceSummary: NonEmptyStringSchema,
    turnControls: ThothTurnControlSnapshotSchema.optional(),
    submitted: z.boolean(),
    submittedSummary: NonEmptyStringSchema.optional(),
  })
  .strict();

export const ThothApprovalGoalCardModelSchema = z.union([
  ThothGoalsCardModelSchema,
  ThothGoalCardModelSchema,
]);

export const ClarifyAnswerIntentSchema = z.enum([
  "submit_choices",
  "note_only",
  "recommend",
  "decide",
  "stop",
]);

export const ApprovalActionIntentSchema = z.enum([
  "accept_quick",
  "accept_loop",
  "annotate",
  "cancel",
]);

export const ThothClarifyCardAnswerPayloadSchema = z
  .object({
    intent: ClarifyAnswerIntentSchema,
    question_card_id: NonEmptyStringSchema,
    title: NonEmptyStringSchema,
    answers: z.array(
      z
        .object({
          question_id: NonEmptyStringSchema,
          choice_ids: z.array(NonEmptyStringSchema),
          choice_notes: z.record(NonEmptyStringSchema, z.string()).default({}),
          note: z.string().optional(),
        })
        .strict(),
    ),
    note: z.string().optional(),
    raw_answer: NonEmptyStringSchema,
  })
  .strict();

export const ThothApprovalCardAnswerPayloadSchema = z
  .object({
    intent: ApprovalActionIntentSchema,
    card_id: NonEmptyStringSchema,
    title: NonEmptyStringSchema,
    note: z.string().optional(),
    raw_answer: NonEmptyStringSchema,
  })
  .strict();

export const ThothCardAnswerPayloadSchema = z.union([
  ThothClarifyCardAnswerPayloadSchema,
  ThothApprovalCardAnswerPayloadSchema,
]);

export const AgentThothLifecycleSchema = z.enum([
  "idle",
  "running",
  "awaiting_card",
  "awaiting_implementation",
  "quick_exec",
  "background_handoff",
  "interrupted",
  "done",
  "canceled",
  "unsupported",
]);

export const AgentThothTurnSchema = z
  .object({
    id: NonEmptyStringSchema,
    agentId: NonEmptyStringSchema,
    kind: z.enum(["raw", "thoth"]),
    lifecycle: AgentThothLifecycleSchema,
    controls: ThothTurnControlSnapshotSchema.optional(),
    providerRunMode: ProviderRunModeSchema.default("default"),
    providerRunModeReceipt: ProviderRunModeReceiptSchema.optional(),
    sourceMessageId: NonEmptyStringSchema.optional(),
    backgroundTaskId: NonEmptyStringSchema.optional(),
    error: z.string().optional(),
    startedAt: NonEmptyStringSchema,
    updatedAt: NonEmptyStringSchema,
  })
  .strict();

export const AgentThothPendingCardSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("clarify_card"),
      card: ThothClarifyCardModelSchema,
      createdAt: NonEmptyStringSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("task_card"),
      card: ThothTaskCardModelSchema,
      createdAt: NonEmptyStringSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("goal_card"),
      card: ThothApprovalGoalCardModelSchema,
      createdAt: NonEmptyStringSchema,
    })
    .strict(),
]);

export const AgentThothStateSchema = z
  .object({
    agentId: NonEmptyStringSchema,
    revision: z.number().int().nonnegative(),
    lifecycle: AgentThothLifecycleSchema,
    turn: AgentThothTurnSchema.nullable(),
    pendingCard: AgentThothPendingCardSchema.nullable(),
    backgroundTaskId: NonEmptyStringSchema.nullable(),
    error: z.string().nullable(),
  })
  .strict();

export const AgentThothStateRequestSchema = z
  .object({
    type: z.literal("agent.thoth.state.request"),
    requestId: NonEmptyStringSchema,
    agentId: NonEmptyStringSchema,
  })
  .strict();

export const AgentThothCardAnswerRequestSchema = z
  .object({
    type: z.literal("agent.thoth.card.answer.request"),
    requestId: NonEmptyStringSchema,
    agentId: NonEmptyStringSchema,
    cardId: NonEmptyStringSchema,
    answer: ThothCardAnswerPayloadSchema,
    expectedRevision: z.number().int().nonnegative(),
    commandId: NonEmptyStringSchema,
  })
  .strict();

export const AgentThothStateResponseSchema = z
  .object({
    type: z.literal("agent.thoth.state.response"),
    payload: z
      .object({
        requestId: NonEmptyStringSchema,
        state: AgentThothStateSchema,
        error: z.string().nullable(),
      })
      .strict(),
  })
  .strict();

export const AgentThothCardAnswerResponseSchema = z
  .object({
    type: z.literal("agent.thoth.card.answer.response"),
    payload: z
      .object({
        requestId: NonEmptyStringSchema,
        accepted: z.boolean(),
        conflict: z.boolean(),
        state: AgentThothStateSchema,
        error: z.string().nullable(),
      })
      .strict(),
  })
  .strict();

export const AgentThothStateUpdateSchema = z
  .object({
    type: z.literal("agent.thoth.state.update"),
    payload: z
      .object({
        state: AgentThothStateSchema,
        reason: z
          .enum([
            "turn_started",
            "card_opened",
            "card_answered",
            "quick_exec_started",
            "background_handoff",
            "turn_completed",
            "turn_interrupted",
            "turn_canceled",
          ])
          .optional(),
      })
      .strict(),
  })
  .strict();

export type ThothTurnControlSnapshot = z.infer<typeof ThothTurnControlSnapshotSchema>;
export type ThothClarifyCardModel = z.infer<typeof ThothClarifyCardModelSchema>;
export type ThothTaskCardModel = z.infer<typeof ThothTaskCardModelSchema>;
export type ThothPyramidPlanSubgoal = z.infer<typeof ThothPyramidPlanSubgoalSchema>;
export type ThothPyramidPlanStage = z.infer<typeof ThothPyramidPlanStageSchema>;
export type ThothGoalCardModel = z.infer<typeof ThothGoalCardModelSchema>;
export type ThothGoalsCardModel = z.infer<typeof ThothGoalsCardModelSchema>;
export type ThothApprovalGoalCardModel = z.infer<typeof ThothApprovalGoalCardModelSchema>;
export type ClarifyAnswerIntent = z.infer<typeof ClarifyAnswerIntentSchema>;
export type ApprovalActionIntent = z.infer<typeof ApprovalActionIntentSchema>;
export type ThothClarifyCardAnswerPayload = z.infer<typeof ThothClarifyCardAnswerPayloadSchema>;
export type ThothApprovalCardAnswerPayload = z.infer<typeof ThothApprovalCardAnswerPayloadSchema>;
export type ThothCardAnswerPayload = z.infer<typeof ThothCardAnswerPayloadSchema>;
export type AgentThothLifecycle = z.infer<typeof AgentThothLifecycleSchema>;
export type AgentThothTurn = z.infer<typeof AgentThothTurnSchema>;
export type AgentThothPendingCard = z.infer<typeof AgentThothPendingCardSchema>;
export type AgentThothState = z.infer<typeof AgentThothStateSchema>;
export type AgentThothStateRequest = z.infer<typeof AgentThothStateRequestSchema>;
export type AgentThothCardAnswerRequest = z.infer<typeof AgentThothCardAnswerRequestSchema>;
export type AgentThothStateResponse = z.infer<typeof AgentThothStateResponseSchema>;
export type AgentThothCardAnswerResponse = z.infer<typeof AgentThothCardAnswerResponseSchema>;
export type AgentThothStateUpdate = z.infer<typeof AgentThothStateUpdateSchema>;
