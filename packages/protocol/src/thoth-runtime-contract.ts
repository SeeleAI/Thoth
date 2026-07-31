import { z } from "zod";
import {
  DecisionNodeMaterialitySchema,
  DecisionNodeOwnerSchema,
  DecisionNodeStatusSchema,
} from "./clarify-authority.js";
import { IntentContractDraftSchema } from "./intent-contract.js";
import {
  ThothRuntimeClarifyStrengthSchema,
  ThothRuntimeLoopStrengthSchema,
  ThothRuntimeModeSchema,
  type ThothRuntimeClarifyStrength,
  type ThothRuntimeLoopStrength,
  type ThothRuntimeMode,
} from "./thoth-controls.js";

export {
  ThothRuntimeClarifyStrengthSchema,
  ThothRuntimeLoopStrengthSchema,
  ThothRuntimeModeSchema,
};

const NonEmptyStringSchema = z.string().trim().min(1);

export const ClarifyQuestionChoiceSchema = z
  .object({
    id: NonEmptyStringSchema,
    label: NonEmptyStringSchema,
    description: z.string().optional(),
  })
  .strict();

export const ClarifyQuestionSelectionModeSchema = z.enum(["single", "multiple"]);

export const ClarifyQuestionItemSchema = z
  .object({
    nodeId: NonEmptyStringSchema,
    question: NonEmptyStringSchema,
    selectionMode: ClarifyQuestionSelectionModeSchema.default("single"),
    choices: z.array(ClarifyQuestionChoiceSchema).min(2).max(4),
    recommendedChoiceId: NonEmptyStringSchema,
    note: z.string().optional(),
  })
  .strict()
  .superRefine((question, ctx) => {
    if (!question.choices.some((choice) => choice.id === question.recommendedChoiceId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "recommendedChoiceId must identify one of the question choices",
        path: ["recommendedChoiceId"],
      });
    }
  });

export const ClarifyQuestionCardSchema = z
  .object({
    title: NonEmptyStringSchema,
    whyNow: NonEmptyStringSchema,
    publicSummary: NonEmptyStringSchema,
    questions: z.array(ClarifyQuestionItemSchema).min(1).max(4),
    allowChoiceNotes: z.literal(true).default(true),
    allowNoteOnly: z.literal(true).default(true),
    allowSingleNodeRecommendation: z.literal(true).default(true),
    allowSubtreeDelegation: z.literal(true).default(true),
  })
  .strict();

export const ClarifyDecisionNodeDeltaSchema = z
  .object({
    id: NonEmptyStringSchema,
    parentId: NonEmptyStringSchema.nullable(),
    crossLinkIds: z.array(NonEmptyStringSchema).default([]),
    title: NonEmptyStringSchema,
    summary: NonEmptyStringSchema.nullable().default(null),
    owner: DecisionNodeOwnerSchema,
    materiality: DecisionNodeMaterialitySchema,
    status: DecisionNodeStatusSchema,
    resolutionRef: NonEmptyStringSchema.nullable().default(null),
    sourceRefs: z.array(NonEmptyStringSchema).default([]),
  })
  .strict();

export const ThothClarifyUpdateMapInputSchema = z
  .object({
    effectiveStrength: z.enum(["light", "balanced", "dive"]),
    nodes: z.array(ClarifyDecisionNodeDeltaSchema).min(1),
    activity: z.enum(["investigating", "expanding"]).default("expanding"),
    activeNodeId: NonEmptyStringSchema.nullable().default(null),
    publicSummary: NonEmptyStringSchema,
  })
  .strict();

export const ThothClarifyAskInputSchema = ClarifyQuestionCardSchema;

export const ThothClarifyProposeContractInputSchema = z
  .object({
    contract: IntentContractDraftSchema,
    decisionNodeRefs: z.array(NonEmptyStringSchema).min(1),
    publicSummary: NonEmptyStringSchema,
  })
  .strict();

export const ThothClarifyJudgeContractInputSchema = z
  .object({
    decision: z.enum(["stable", "reopen", "blocked"]),
    reason: NonEmptyStringSchema,
    missingNodes: z.array(ClarifyDecisionNodeDeltaSchema).default([]),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.decision === "reopen" && input.missingNodes.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "reopen requires at least one missing decision node",
        path: ["missingNodes"],
      });
    }
  });

export const ThothClarifyReportBlockedInputSchema = z
  .object({
    title: NonEmptyStringSchema,
    reason: NonEmptyStringSchema,
    userDecisionNeeded: z.string().optional(),
  })
  .strict();

export const ThothLoopCheckpointInputSchema = z
  .object({
    title: NonEmptyStringSchema,
    activeGap: NonEmptyStringSchema,
    progressClaim: NonEmptyStringSchema,
    unresolvedGap: z.string(),
    evidenceRefs: z.array(NonEmptyStringSchema).default([]),
  })
  .strict();

export const ThothLoopReviewDecisionSchema = z.enum([
  "continue",
  "reorient",
  "complete",
  "need_human",
  "blocked",
]);

export const ThothLoopReviewDecisionInputSchema = z
  .object({
    decision: ThothLoopReviewDecisionSchema,
    reason: NonEmptyStringSchema,
    evidenceRefs: z.array(NonEmptyStringSchema).default([]),
    nextFocus: z.string().optional(),
    rejectedRoutes: z.array(NonEmptyStringSchema).default([]),
    acceptanceEvidence: z.record(NonEmptyStringSchema, z.array(NonEmptyStringSchema)).default({}),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.decision === "complete" && Object.keys(input.acceptanceEvidence).length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "complete requires acceptance claim evidence mappings",
        path: ["acceptanceEvidence"],
      });
    }
  });

export const ThothLoopRequestHumanDecisionInputSchema = z
  .object({
    title: NonEmptyStringSchema,
    question: NonEmptyStringSchema,
    affectedContractFields: z.array(NonEmptyStringSchema).min(1),
    options: z
      .array(
        z
          .object({
            id: NonEmptyStringSchema,
            label: NonEmptyStringSchema,
            description: z.string().optional(),
          })
          .strict(),
      )
      .min(2)
      .max(4),
    notePlaceholder: z.string().optional(),
  })
  .strict();

export const ThothLoopReportBlockedInputSchema = z
  .object({
    title: NonEmptyStringSchema,
    reason: NonEmptyStringSchema,
    nextUserDecision: z.string().optional(),
  })
  .strict();

export const THOTH_CLARIFY_RUNTIME_TOOL_NAMES = [
  "thoth_clarify_update_map",
  "thoth_clarify_ask",
  "thoth_clarify_propose_contract",
  "thoth_clarify_report_blocked",
  "thoth_clarify_judge_contract",
] as const;

export const THOTH_LOOP_RUNTIME_TOOL_NAMES = [
  "thoth_loop_checkpoint",
  "thoth_loop_review_decision",
  "thoth_loop_request_human_decision",
  "thoth_loop_report_blocked",
] as const;

export const THOTH_RUNTIME_TOOL_NAMES = [
  ...THOTH_CLARIFY_RUNTIME_TOOL_NAMES,
  ...THOTH_LOOP_RUNTIME_TOOL_NAMES,
] as const;

export const ThothClarifyRuntimeToolNameSchema = z.enum(THOTH_CLARIFY_RUNTIME_TOOL_NAMES);
export const ThothLoopRuntimeToolNameSchema = z.enum(THOTH_LOOP_RUNTIME_TOOL_NAMES);

export const ThothClarifyRuntimeToolInputSchema = z.discriminatedUnion("tool", [
  z.object({
    tool: z.literal("thoth_clarify_update_map"),
    input: ThothClarifyUpdateMapInputSchema,
  }),
  z.object({
    tool: z.literal("thoth_clarify_ask"),
    input: ThothClarifyAskInputSchema,
  }),
  z.object({
    tool: z.literal("thoth_clarify_propose_contract"),
    input: ThothClarifyProposeContractInputSchema,
  }),
  z.object({
    tool: z.literal("thoth_clarify_report_blocked"),
    input: ThothClarifyReportBlockedInputSchema,
  }),
  z.object({
    tool: z.literal("thoth_clarify_judge_contract"),
    input: ThothClarifyJudgeContractInputSchema,
  }),
]);

export const ThothLoopRuntimeToolInputSchema = z.discriminatedUnion("tool", [
  z.object({
    tool: z.literal("thoth_loop_checkpoint"),
    input: ThothLoopCheckpointInputSchema,
  }),
  z.object({
    tool: z.literal("thoth_loop_review_decision"),
    input: ThothLoopReviewDecisionInputSchema,
  }),
  z.object({
    tool: z.literal("thoth_loop_request_human_decision"),
    input: ThothLoopRequestHumanDecisionInputSchema,
  }),
  z.object({
    tool: z.literal("thoth_loop_report_blocked"),
    input: ThothLoopReportBlockedInputSchema,
  }),
]);

export type { ThothRuntimeMode, ThothRuntimeClarifyStrength, ThothRuntimeLoopStrength };
export type ClarifyQuestionChoice = z.infer<typeof ClarifyQuestionChoiceSchema>;
export type ClarifyQuestionSelectionMode = z.infer<typeof ClarifyQuestionSelectionModeSchema>;
export type ClarifyQuestionItem = z.infer<typeof ClarifyQuestionItemSchema>;
export type ClarifyQuestionCard = z.infer<typeof ClarifyQuestionCardSchema>;
export type ClarifyDecisionNodeDelta = z.infer<typeof ClarifyDecisionNodeDeltaSchema>;
export type ThothClarifyUpdateMapInput = z.infer<typeof ThothClarifyUpdateMapInputSchema>;
export type ThothClarifyAskInput = z.infer<typeof ThothClarifyAskInputSchema>;
export type ThothClarifyProposeContractInput = z.infer<
  typeof ThothClarifyProposeContractInputSchema
>;
export type ThothClarifyJudgeContractInput = z.infer<typeof ThothClarifyJudgeContractInputSchema>;
export type ThothClarifyReportBlockedInput = z.infer<typeof ThothClarifyReportBlockedInputSchema>;
export type ThothLoopCheckpointInput = z.infer<typeof ThothLoopCheckpointInputSchema>;
export type ThothLoopReviewDecision = z.infer<typeof ThothLoopReviewDecisionSchema>;
export type ThothLoopReviewDecisionInput = z.infer<typeof ThothLoopReviewDecisionInputSchema>;
export type ThothLoopRequestHumanDecisionInput = z.infer<
  typeof ThothLoopRequestHumanDecisionInputSchema
>;
export type ThothLoopReportBlockedInput = z.infer<typeof ThothLoopReportBlockedInputSchema>;
