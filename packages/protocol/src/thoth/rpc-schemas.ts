import { z } from "zod";
import { AgentQueuedTurnSchema } from "../agent-turn-queue.js";
import { IntentContractProjectionSchema } from "../intent-contract.js";
import { ProviderRunModeReceiptSchema, ProviderRunModeSchema } from "../provider-control.js";
import {
  ClarifyQuestionCardSchema,
  ThothRuntimeClarifyStrengthSchema,
  ThothRuntimeLoopStrengthSchema,
  ThothRuntimeModeSchema,
} from "../thoth-runtime-contract.js";

const NonEmptyStringSchema = z.string().trim().min(1);

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
    sessionId: NonEmptyStringSchema,
    roundIndex: z.number().int().positive(),
    card: ClarifyQuestionCardSchema,
    submitted: z.boolean(),
    submittedSummary: NonEmptyStringSchema.optional(),
    submittedAnswers: z
      .array(
        z
          .object({
            nodeId: NonEmptyStringSchema,
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

export const ThothIntentContractCardModelSchema = z
  .object({
    id: NonEmptyStringSchema,
    sessionId: NonEmptyStringSchema,
    contract: IntentContractProjectionSchema,
    provenanceSummary: NonEmptyStringSchema,
    turnControls: ThothTurnControlSnapshotSchema,
    submitted: z.boolean(),
    submittedSummary: NonEmptyStringSchema.optional(),
  })
  .strict();

export const ClarifyAnswerIntentSchema = z.enum([
  "submit_choices",
  "note_only",
  "recommend",
  "delegate_subtree",
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
    questionCardId: NonEmptyStringSchema,
    answers: z.array(
      z
        .object({
          nodeId: NonEmptyStringSchema,
          choiceIds: z.array(NonEmptyStringSchema),
          choiceNotes: z.record(NonEmptyStringSchema, z.string()).default({}),
          note: z.string().optional(),
        })
        .strict(),
    ),
    delegatedNodeIds: z.array(NonEmptyStringSchema).default([]),
    note: z.string().optional(),
    rawAnswer: NonEmptyStringSchema,
  })
  .strict()
  .superRefine((answer, ctx) => {
    const isDelegation = answer.intent === "recommend" || answer.intent === "delegate_subtree";
    if (isDelegation) {
      if (answer.delegatedNodeIds.length !== 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${answer.intent} requires exactly one target Decision node`,
          path: ["delegatedNodeIds"],
        });
        return;
      }
      const targetNodeId = answer.delegatedNodeIds[0];
      if (answer.answers.length !== 1 || answer.answers[0]?.nodeId !== targetNodeId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${answer.intent} must answer only its target Decision node`,
          path: ["answers"],
        });
      } else if (answer.answers[0].choiceIds.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${answer.intent} delegates the decision and cannot also select a choice`,
          path: ["answers", 0, "choiceIds"],
        });
      }
      return;
    }
    if (answer.delegatedNodeIds.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${answer.intent} cannot delegate Decision nodes`,
        path: ["delegatedNodeIds"],
      });
    }
  });

export const ThothIntentContractAnswerPayloadSchema = z
  .object({
    intent: ApprovalActionIntentSchema,
    cardId: NonEmptyStringSchema,
    note: z.string().optional(),
    rawAnswer: NonEmptyStringSchema,
  })
  .strict();

export const ThothCardAnswerPayloadSchema = z.union([
  ThothClarifyCardAnswerPayloadSchema,
  ThothIntentContractAnswerPayloadSchema,
]);

export const AgentThothLifecycleSchema = z.enum([
  "idle",
  "running",
  "mapping",
  "awaiting_card",
  "challenging",
  "proposing",
  "awaiting_implementation",
  "quick_wait",
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
      kind: z.literal("intent_contract_card"),
      card: ThothIntentContractCardModelSchema,
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
    queuedTurns: z.array(AgentQueuedTurnSchema).optional(),
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
            "decision_map_changed",
            "card_opened",
            "card_answered",
            "contract_proposed",
            "quick_exec_waiting",
            "quick_exec_started",
            "background_handoff",
            "turn_completed",
            "turn_interrupted",
            "queue_changed",
            "turn_canceled",
          ])
          .optional(),
      })
      .strict(),
  })
  .strict();

export type ThothTurnControlSnapshot = z.infer<typeof ThothTurnControlSnapshotSchema>;
export type ThothClarifyCardModel = z.infer<typeof ThothClarifyCardModelSchema>;
export type ThothIntentContractCardModel = z.infer<typeof ThothIntentContractCardModelSchema>;
export type ClarifyAnswerIntent = z.infer<typeof ClarifyAnswerIntentSchema>;
export type ApprovalActionIntent = z.infer<typeof ApprovalActionIntentSchema>;
export type ThothClarifyCardAnswerPayload = z.infer<typeof ThothClarifyCardAnswerPayloadSchema>;
export type ThothIntentContractAnswerPayload = z.infer<
  typeof ThothIntentContractAnswerPayloadSchema
>;
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
