import { z } from "zod";

export const THOTH_BUILTIN_RUNTIME_SKILLS = ["thoth.clarify", "thoth.loop"] as const;

export const THOTH_RUNTIME_PACKET_FIELDS = [
  "type",
  "code",
  "session_id",
  "task_id",
  "content",
  "ui",
  "next",
  "errors",
] as const;

export const THOTH_CLARIFY_CODES = [
  "C_DIRECT",
  "C_ASK",
  "C_TASK_CARD",
  "C_GOAL_CARD",
  "C_REGISTER",
  "C_BLOCKED",
  "C_REPAIR",
] as const;

export const THOTH_LOOP_CODES = [
  "L_START",
  "L_WORK",
  "L_NEED_PERMISSION",
  "L_REVIEW",
  "L_RETRY",
  "L_GOAL_DONE",
  "L_TASK_DONE",
  "L_BLOCKED",
] as const;

export const THOTH_CLARIFY_UI_KINDS = [
  "message",
  "quick_receipt",
  "clarify_card",
  "task_registration_card",
  "goal_contract_card",
  "registered_card",
  "blocked_card",
  "packet_error",
] as const;

export const THOTH_LOOP_UI_KINDS = [
  "goal_started",
  "progress",
  "permission_card",
  "review_card",
  "retry_card",
  "goal_done",
  "task_done",
  "blocked_card",
  "packet_error",
] as const;

export const ThothRuntimeSkillIdSchema = z.enum(THOTH_BUILTIN_RUNTIME_SKILLS);
export const ClarifyRuntimeCodeSchema = z.enum(THOTH_CLARIFY_CODES);
export const LoopRuntimeCodeSchema = z.enum(THOTH_LOOP_CODES);
export const ClarifyRuntimeUiKindSchema = z.enum(THOTH_CLARIFY_UI_KINDS);
export const LoopRuntimeUiKindSchema = z.enum(THOTH_LOOP_UI_KINDS);

export const ThothRuntimeModeSchema = z.enum(["quick", "loop"]);
export const ThothRuntimeClarifyStrengthSchema = z.enum([
  "none",
  "auto",
  "light",
  "balanced",
  "dive",
  "deep",
]);
export const ThothRuntimeLoopStrengthSchema = z.enum([
  "auto",
  "one_plan_one_do",
  "light",
  "balanced",
  "run_until_stopped",
]);
export const ThothRuntimeSkillInjectionSchema = z.enum(["none", "state_refresh", "full"]);
export const ClarifyTurnPhaseSchema = z.enum([
  "clarify",
  "approval_task",
  "approval_breakdown",
  "quick_exec",
  "background_handoff",
  "repair",
]);

const NonEmptyStringSchema = z.string().min(1);
const Sha256DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const RuntimeContentSchema = z.record(z.string(), z.unknown());
const RuntimeUiSchema = z
  .object({
    kind: z.string().min(1),
    title: z.string().optional(),
    text: z.string().optional(),
  })
  .passthrough();

export const ClarifyQuestionChoiceSchema = z
  .object({
    id: NonEmptyStringSchema,
    label: z.string().min(1).max(15),
    description: z.string().min(1).max(30),
  })
  .strict();

export const ClarifyQuestionSelectionModeSchema = z.enum(["single", "multiple"]);

export const ClarifyQuestionItemSchema = z
  .object({
    id: NonEmptyStringSchema,
    question: NonEmptyStringSchema,
    behavior_tree_node: NonEmptyStringSchema,
    selection_mode: ClarifyQuestionSelectionModeSchema.default("single"),
    choices: z.array(ClarifyQuestionChoiceSchema).min(2).max(4),
    note: z.string().optional(),
  })
  .strict();

export const ClarifyMultiQuestionCardSchema = z
  .object({
    question_id: NonEmptyStringSchema,
    title: NonEmptyStringSchema,
    behavior_tree_node: NonEmptyStringSchema,
    why_now: z.string().optional(),
    questions: z.array(ClarifyQuestionItemSchema).min(2).max(4),
    allow_choice_notes: z.literal(true),
    allow_note_only: z.literal(true),
  })
  .strict();

export const ClarifyLegacyQuestionCardSchema = z
  .object({
    question_id: NonEmptyStringSchema,
    title: NonEmptyStringSchema,
    question: NonEmptyStringSchema,
    behavior_tree_node: NonEmptyStringSchema,
    choices: z.array(ClarifyQuestionChoiceSchema).min(2).max(4),
    allow_choice_notes: z.literal(true),
    allow_note_only: z.literal(true),
  })
  .strict();

export const ClarifyQuestionCardSchema = z.union([
  ClarifyMultiQuestionCardSchema,
  ClarifyLegacyQuestionCardSchema,
]);

export const ClarifyAnswerItemSchema = z
  .object({
    question_id: NonEmptyStringSchema,
    choice_ids: z.array(NonEmptyStringSchema),
    choice_notes: z.record(NonEmptyStringSchema, z.string()).default({}),
    note: z.string().optional(),
  })
  .strict();

export const ClarifyMultiAnswerPacketSchema = z
  .object({
    question_card_id: NonEmptyStringSchema,
    title: NonEmptyStringSchema,
    answers: z.array(ClarifyAnswerItemSchema).min(1).max(4),
    note: z.string().optional(),
    raw_answer: NonEmptyStringSchema,
  })
  .strict();

export const ClarifyLegacyAnswerPacketSchema = z
  .object({
    question_id: NonEmptyStringSchema,
    title: NonEmptyStringSchema,
    choice_ids: z.array(NonEmptyStringSchema),
    choice_notes: z.record(NonEmptyStringSchema, z.string()).default({}),
    note: z.string().optional(),
    raw_answer: NonEmptyStringSchema,
  })
  .strict();

export const ClarifyAnswerPacketSchema = z.union([
  ClarifyMultiAnswerPacketSchema,
  ClarifyLegacyAnswerPacketSchema,
]);

export const ClarifyAssumptionOwnerSchema = z.enum([
  "user_must_decide",
  "agent_can_decide",
  "agent_can_discover",
  "standard_answer/common_sense",
]);

export const ClarifyMaterialAssumptionSchema = z
  .object({
    id: NonEmptyStringSchema,
    owner: ClarifyAssumptionOwnerSchema,
    summary: NonEmptyStringSchema,
    impact: z.string().optional(),
  })
  .strict();

export const ClarifyOutputMetaSchema = z
  .object({
    effective_clarify_strength: ThothRuntimeClarifyStrengthSchema,
    decision_tree_depth: z.number().int().min(0),
    qa_round_count: z.number().int().min(0),
    remaining_material_assumptions: z.array(ClarifyMaterialAssumptionSchema),
    // Legacy packet consumers can omit this, while newer golden/user-simulation
    // evidence retains the full owner classification behind a visible card.
    assumptions: z.array(ClarifyMaterialAssumptionSchema).optional(),
    question_value_reason: NonEmptyStringSchema,
  })
  .strict();

export const ClarifyCardProvenanceSchema = z
  .object({
    clarify_transcript_verbatim: NonEmptyStringSchema,
  })
  .strict();

export const ClarifyGoalCardProvenanceSchema = ClarifyCardProvenanceSchema.extend({
  approved_ceo_task_card_verbatim: NonEmptyStringSchema,
}).strict();

export const ClarifyTaskCardContractSchema = z
  .object({
    title: NonEmptyStringSchema,
    goal: NonEmptyStringSchema,
    constraints: z.array(NonEmptyStringSchema).min(1),
    acceptance: z.array(NonEmptyStringSchema).min(1),
  })
  .strict();

export const ClarifyPyramidPlanSubgoalSchema = z
  .object({
    id: NonEmptyStringSchema,
    title: NonEmptyStringSchema,
    goal: NonEmptyStringSchema,
    acceptance: z.array(NonEmptyStringSchema).min(1),
  })
  .strict();

export const ClarifyPyramidPlanStageSchema = z
  .object({
    id: NonEmptyStringSchema,
    title: NonEmptyStringSchema,
    goal: NonEmptyStringSchema,
    acceptance: z.array(NonEmptyStringSchema).min(1),
    subgoals: z.array(ClarifyPyramidPlanSubgoalSchema),
  })
  .strict();

export const ClarifyGoalCardContractSchema = z
  .object({
    title: NonEmptyStringSchema,
    summary: NonEmptyStringSchema,
    pyramid: z.array(ClarifyPyramidPlanStageSchema).min(1),
  })
  .strict();

export const ClarifyLinearGoalContractSchema = z
  .object({
    id: NonEmptyStringSchema,
    order: z.number().int().positive(),
    title: NonEmptyStringSchema,
    goal: NonEmptyStringSchema,
    constraints: z.array(NonEmptyStringSchema).min(1),
    acceptance: z.array(NonEmptyStringSchema).min(1),
    provenance: z.string().optional(),
  })
  .strict();

export const ClarifyGoalsCardContractSchema = z
  .object({
    title: NonEmptyStringSchema,
    summary: NonEmptyStringSchema,
    goals: z.array(ClarifyLinearGoalContractSchema).min(1),
    goals_count_rationale: z.string().optional(),
  })
  .strict()
  .superRefine((card, ctx) => {
    const seen = new Set<number>();
    for (const [index, goal] of card.goals.entries()) {
      if (seen.has(goal.order)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Goals Card orders must be unique",
          path: ["goals", index, "order"],
        });
      }
      seen.add(goal.order);
    }
    const sorted = [...card.goals].sort((a, b) => a.order - b.order);
    for (let index = 0; index < sorted.length; index += 1) {
      if (sorted[index]?.order !== index + 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Goals Card orders must be linear starting at 1",
          path: ["goals"],
        });
        break;
      }
    }
    if ((card.goals.length < 8 || card.goals.length > 16) && !card.goals_count_rationale?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Goals Card outside the usual 8-16 range requires goals_count_rationale",
        path: ["goals_count_rationale"],
      });
    }
  });

export const ThothRuntimeSkillRefSchema = z
  .object({
    id: ThothRuntimeSkillIdSchema,
    digest: Sha256DigestSchema,
  })
  .strict();

export const ClarifyInputControlsSchema = z
  .object({
    mode: ThothRuntimeModeSchema,
    clarify_strength: ThothRuntimeClarifyStrengthSchema,
    effective_clarify_strength: ThothRuntimeClarifyStrengthSchema,
    loop: ThothRuntimeLoopStrengthSchema.nullable(),
  })
  .strict();

export const ClarifyControlsChangedSchema = z
  .object({
    clarify_strength_from: ThothRuntimeClarifyStrengthSchema,
    clarify_strength_to: ThothRuntimeClarifyStrengthSchema,
    reason: z.string().optional(),
  })
  .strict();

export const THOTH_CLARIFY_MECHANICAL_TRANSITIONS = [
  ["C_DIRECT", "C_DIRECT"],
  ["C_DIRECT", "C_ASK"],
  ["C_DIRECT", "C_TASK_CARD"],
  ["C_DIRECT", "C_BLOCKED"],
  ["C_ASK", "C_ASK"],
  ["C_ASK", "C_TASK_CARD"],
  ["C_ASK", "C_BLOCKED"],
  ["C_ASK", "C_REPAIR"],
  ["C_TASK_CARD", "C_GOAL_CARD"],
  ["C_TASK_CARD", "C_ASK"],
  ["C_TASK_CARD", "C_BLOCKED"],
  ["C_TASK_CARD", "C_REPAIR"],
  ["C_GOAL_CARD", "C_REGISTER"],
  ["C_GOAL_CARD", "C_ASK"],
  ["C_GOAL_CARD", "C_BLOCKED"],
  ["C_GOAL_CARD", "C_REPAIR"],
  ["C_REGISTER", "C_REGISTER"],
  ["C_REGISTER", "C_BLOCKED"],
  ["C_BLOCKED", "C_BLOCKED"],
  ["C_REPAIR", "C_DIRECT"],
  ["C_REPAIR", "C_ASK"],
  ["C_REPAIR", "C_TASK_CARD"],
  ["C_REPAIR", "C_GOAL_CARD"],
  ["C_REPAIR", "C_BLOCKED"],
] as const;

const clarifyMechanicalTransitionSet = new Set(
  THOTH_CLARIFY_MECHANICAL_TRANSITIONS.map(([from, to]) => `${from}->${to}`),
);

export function isAllowedClarifyMechanicalTransition(
  from: ClarifyRuntimeCode,
  to: ClarifyRuntimeCode,
): boolean {
  return clarifyMechanicalTransitionSet.has(`${from}->${to}`);
}

export const ClarifyTurnInputPacketSchema = z
  .object({
    type: z.literal("clarify_turn"),
    session_id: NonEmptyStringSchema,
    current_state: ClarifyRuntimeCodeSchema,
    controls: ClarifyInputControlsSchema,
    user_input: z.string(),
    transcript_ref: NonEmptyStringSchema,
    assumption_ledger_ref: NonEmptyStringSchema.optional(),
    decision_tree_frontier_ref: NonEmptyStringSchema.optional(),
    context_summary: z.string().optional(),
    task_card_provenance_ref: z.string().optional(),
  })
  .strict();

export const ClarifySessionStartInputPacketSchema = z
  .object({
    type: z.literal("clarify_session_start"),
    session_id: NonEmptyStringSchema,
    skill_ref: ThothRuntimeSkillRefSchema.extend({ id: z.literal("thoth.clarify") }),
    current_state: ClarifyRuntimeCodeSchema,
    controls: ClarifyInputControlsSchema,
    user_input: z.string(),
    transcript_ref: NonEmptyStringSchema.optional(),
    assumption_ledger_ref: NonEmptyStringSchema.optional(),
    decision_tree_frontier_ref: NonEmptyStringSchema.optional(),
    context_summary: z.string().optional(),
    basis: z.literal("session_scoped_skill_loaded"),
  })
  .strict();

export const ClarifyTransitionInputPacketSchema = z
  .object({
    type: z.literal("clarify_transition"),
    session_id: NonEmptyStringSchema,
    skill_ref: ThothRuntimeSkillRefSchema.extend({ id: z.literal("thoth.clarify") }),
    from: ClarifyRuntimeCodeSchema,
    to: ClarifyRuntimeCodeSchema,
    basis: z.literal("according_to_loaded_skill"),
    controls: ClarifyInputControlsSchema,
    controls_changed: ClarifyControlsChangedSchema.optional(),
    transcript_ref: NonEmptyStringSchema,
    assumption_ledger_ref: NonEmptyStringSchema.optional(),
    decision_tree_frontier_ref: NonEmptyStringSchema.optional(),
    user_input: z.string(),
    context_summary: z.string().optional(),
  })
  .strict()
  .superRefine((packet, ctx) => {
    if (!isAllowedClarifyMechanicalTransition(packet.from, packet.to)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "clarify transition is not mechanically allowed",
        path: ["to"],
      });
    }
  });

export const ClarifyRepairInputPacketSchema = z
  .object({
    type: z.literal("clarify_repair"),
    session_id: NonEmptyStringSchema,
    skill_ref: ThothRuntimeSkillRefSchema.extend({ id: z.literal("thoth.clarify") }),
    previous_state: ClarifyRuntimeCodeSchema,
    intended_output_state: ClarifyRuntimeCodeSchema,
    controls: ClarifyInputControlsSchema.optional(),
    bad_output: z.string(),
    schema_errors: z.array(z.string()),
    transition_errors: z.array(z.string()),
    repair_instruction: NonEmptyStringSchema,
  })
  .strict()
  .superRefine((packet, ctx) => {
    if (
      !packet.repair_instruction.includes("repair packet shape only") ||
      !packet.repair_instruction.includes("do not reinterpret user intent") ||
      !packet.repair_instruction.includes("do not fabricate transcript") ||
      !packet.repair_instruction.includes("do not change approved CEO Task Card")
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "repair instruction must preserve user intent, transcript, approved Task Card, and repair packet shape only",
        path: ["repair_instruction"],
      });
    }
  });

export const ClarifyProviderRuntimeInputPacketSchema = z.discriminatedUnion("type", [
  ClarifySessionStartInputPacketSchema,
  ClarifyTurnInputPacketSchema,
  ClarifyTransitionInputPacketSchema,
  ClarifyRepairInputPacketSchema,
]);

const RuntimePacketBaseSchema = z
  .object({
    type: z.enum(["clarify", "loop"]),
    code: z.string().min(1),
    session_id: NonEmptyStringSchema,
    task_id: z.string().min(1).nullable(),
    content: RuntimeContentSchema,
    ui: RuntimeUiSchema,
    next: z.string().min(1),
    errors: z.array(z.string()),
  })
  .strict();

export const LoopRuntimeCursorSchema = z
  .object({
    goal: z.number().int().positive(),
    goals: z.number().int().positive(),
    round: z.number().int().positive(),
    rounds: z.number().int().positive().nullable(),
  })
  .strict()
  .superRefine((cursor, ctx) => {
    if (cursor.goal > cursor.goals) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "goal must be less than or equal to goals",
        path: ["goal"],
      });
    }
    if (cursor.rounds !== null && cursor.round > cursor.rounds) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "round must be less than or equal to rounds",
        path: ["round"],
      });
    }
  });

export const ClarifyRuntimePacketSchema = RuntimePacketBaseSchema.extend({
  type: z.literal("clarify"),
  code: ClarifyRuntimeCodeSchema,
  ui: RuntimeUiSchema.extend({ kind: ClarifyRuntimeUiKindSchema }),
  next: ClarifyRuntimeCodeSchema,
}).superRefine((packet, ctx) => {
  if (packet.code === "C_ASK") {
    const parsedContentCard = ClarifyQuestionCardSchema.safeParse(packet.content.question_card);
    if (!parsedContentCard.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "C_ASK packets must include a valid content.question_card",
        path: ["content", "question_card"],
      });
    }

    const parsedUiCard = ClarifyQuestionCardSchema.safeParse(packet.ui.question_card);
    if (!parsedUiCard.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "C_ASK packets must include a valid ui.question_card",
        path: ["ui", "question_card"],
      });
    }

    const parsedMeta = ClarifyOutputMetaSchema.safeParse(packet.content.meta);
    if (!parsedMeta.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "C_ASK packets must include valid internal content.meta",
        path: ["content", "meta"],
      });
    }
  }

  if (packet.code === "C_TASK_CARD") {
    const parsedTaskCard = ClarifyTaskCardContractSchema.safeParse(packet.content.task_card);
    if (!parsedTaskCard.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "C_TASK_CARD packets must include a valid content.task_card",
        path: ["content", "task_card"],
      });
    }
    const parsedProvenance = ClarifyCardProvenanceSchema.safeParse(packet.content.provenance);
    if (!parsedProvenance.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "C_TASK_CARD packets must include full clarify transcript provenance",
        path: ["content", "provenance"],
      });
    }
  }

  if (packet.code === "C_GOAL_CARD") {
    const parsedGoalCard = ClarifyGoalCardContractSchema.safeParse(packet.content.goal_card);
    const parsedGoalsCard = ClarifyGoalsCardContractSchema.safeParse(packet.content.goals_card);
    if (!parsedGoalCard.success && !parsedGoalsCard.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "C_GOAL_CARD packets must include a valid content.goals_card or legacy content.goal_card",
        path: ["content"],
      });
    }
    const parsedProvenance = ClarifyGoalCardProvenanceSchema.safeParse(packet.content.provenance);
    if (!parsedProvenance.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "C_GOAL_CARD packets must include full clarify transcript and approved CEO Task Card provenance",
        path: ["content", "provenance"],
      });
    }
  }

  if (packet.code === "C_REGISTER") {
    const parsedTaskCard = ClarifyTaskCardContractSchema.safeParse(packet.content.task_card);
    if (!parsedTaskCard.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "C_REGISTER packets must include a valid content.task_card",
        path: ["content", "task_card"],
      });
    }
    const parsedGoalCard = ClarifyGoalCardContractSchema.safeParse(packet.content.goal_card);
    const parsedGoalsCard = ClarifyGoalsCardContractSchema.safeParse(packet.content.goals_card);
    if (!parsedGoalCard.success && !parsedGoalsCard.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "C_REGISTER packets must include a valid content.goals_card or legacy content.goal_card",
        path: ["content"],
      });
    }
  }
});

export const LoopRuntimePacketSchema = RuntimePacketBaseSchema.extend({
  type: z.literal("loop"),
  code: LoopRuntimeCodeSchema,
  ui: RuntimeUiSchema.extend({ kind: LoopRuntimeUiKindSchema }),
  next: LoopRuntimeCodeSchema,
}).superRefine((packet, ctx) => {
  if (packet.code === "L_TASK_DONE") {
    return;
  }
  const parsedCursor = LoopRuntimeCursorSchema.safeParse(packet.content.cursor);
  if (!parsedCursor.success) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "loop packets except L_TASK_DONE must include a valid content.cursor",
      path: ["content", "cursor"],
    });
  }
});

export const ThothRuntimePacketSchema = z.discriminatedUnion("type", [
  ClarifyRuntimePacketSchema,
  LoopRuntimePacketSchema,
]);

export const ProviderQuestionEventSchema = z
  .object({
    type: z.literal("provider_question_event"),
    provider: NonEmptyStringSchema,
    provider_session_id: NonEmptyStringSchema,
    provider_turn_id: z.string().min(1).optional(),
    transport: z.enum([
      "codex_request_user_input",
      "claude_ask_user_question",
      "opencode_question",
      "acp_permission",
      "other",
    ]),
    authority_kind: z.enum(["question", "permission", "approval"]),
    title: z.string().optional(),
    prompt: NonEmptyStringSchema,
    choices: z
      .array(
        z
          .object({
            id: NonEmptyStringSchema,
            label: NonEmptyStringSchema,
            description: z.string().optional(),
          })
          .strict(),
      )
      .optional(),
    redacted_evidence_hash: z.string().min(1).optional(),
  })
  .strict();

export const ClarificationCardCandidateSchema = z
  .object({
    type: z.literal("clarification_card_candidate"),
    source: z.enum(["provider_question_event", "runtime_packet"]),
    provider_event: ProviderQuestionEventSchema.optional(),
    card: ClarifyQuestionCardSchema,
    accepted: z.boolean(),
    rejection_reason: z.string().optional(),
  })
  .strict()
  .superRefine((candidate, ctx) => {
    if (
      candidate.source === "provider_question_event" &&
      candidate.provider_event?.authority_kind !== "question"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "only provider question events can become ClarificationCard candidates",
        path: ["provider_event", "authority_kind"],
      });
    }
  });

export const RuntimePacketCandidateSchema = z
  .object({
    type: z.literal("runtime_packet_candidate"),
    source: z.enum(["native_output_schema", "runtime_tool"]),
    provider: NonEmptyStringSchema,
    provider_session_id: NonEmptyStringSchema,
    packet: ThothRuntimePacketSchema,
    schema_verified: z.boolean(),
    errors: z.array(z.string()).default([]),
    redacted_evidence_hash: z.string().min(1).optional(),
  })
  .strict();

const ForbiddenRuntimeToolTextSchema = z.string().superRefine((value, ctx) => {
  if (
    /\b(C_DIRECT|C_ASK|C_TASK_CARD|C_GOAL_CARD|C_REGISTER|C_BLOCKED|C_REPAIR)\b/i.test(value) ||
    /\b(packet|schema|provider role|assistant json|submit_clarify_packet|submit_runtime_packet|MCP)\b/i.test(
      value,
    )
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "runtime tool text must not expose internal packet/schema/tool bridge details",
    });
  }
});

function rejectForbiddenRuntimeToolText(
  value: unknown,
  ctx: z.RefinementCtx,
  path: string[],
): void {
  if (typeof value === "string") {
    const parsed = ForbiddenRuntimeToolTextSchema.safeParse(value);
    if (!parsed.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: parsed.error.issues[0]?.message ?? "runtime tool text is not user-safe",
        path,
      });
    }
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      rejectForbiddenRuntimeToolText(entry, ctx, [...path, String(index)]),
    );
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    rejectForbiddenRuntimeToolText(entry, ctx, [...path, key]);
  }
}

export const RuntimeToolTransportSchema = z.enum([
  "codex_dynamic_tool",
  "native_question",
  "mcp_runtime_tool",
  "output_schema_degraded",
  "unsupported",
]);

export const RuntimeToolCapabilitiesSchema = z
  .object({
    nativeQuestion: z.boolean(),
    hostRegisteredTools: z.boolean(),
    mcpTools: z.boolean(),
    dynamicTools: z.boolean(),
    blockingToolCall: z.union([z.boolean(), z.literal("probe_required")]),
    toolResultCanResumeSameTurn: z.union([z.boolean(), z.literal("probe_required")]),
    recommendedTransport: RuntimeToolTransportSchema,
  })
  .strict();

export const RuntimeToolBridgeDescriptorSchema = z
  .object({
    provider: NonEmptyStringSchema,
    transport: RuntimeToolTransportSchema,
    capabilities: RuntimeToolCapabilitiesSchema,
    detail: NonEmptyStringSchema,
  })
  .strict();

export const THOTH_CLARIFY_RUNTIME_TOOL_NAMES = [
  "thoth_get_bound_task_progress",
  "thoth_submit_clarify_card",
  "thoth_submit_task_card",
  "thoth_submit_goals_card",
  "thoth_submit_clarify_convergence_audit",
  "thoth_report_blocked",
] as const;

export const ThothClarifyRuntimeToolNameSchema = z.enum(THOTH_CLARIFY_RUNTIME_TOOL_NAMES);

export const THOTH_LOOP_RUNTIME_TOOL_NAMES = [
  "thoth_loop_submit_planexec_result",
  "thoth_loop_submit_review_independent_assessment",
  "thoth_loop_submit_review_verdict",
  "thoth_submit_contract_preservation_audit",
  "thoth_loop_report_blocked",
] as const;

export const ThothLoopRuntimeToolNameSchema = z.enum(THOTH_LOOP_RUNTIME_TOOL_NAMES);

export const THOTH_RUNTIME_TOOL_NAMES = [
  ...THOTH_CLARIFY_RUNTIME_TOOL_NAMES,
  ...THOTH_LOOP_RUNTIME_TOOL_NAMES,
] as const;

export const ThothRuntimeToolNameSchema = z.enum(THOTH_RUNTIME_TOOL_NAMES);

const SemanticClarifyQuestionChoiceSchema = ClarifyQuestionChoiceSchema;

const SemanticClarifyQuestionItemSchema = z
  .object({
    id: NonEmptyStringSchema,
    question: NonEmptyStringSchema,
    behavior_tree_node: NonEmptyStringSchema.optional(),
    selection_mode: ClarifyQuestionSelectionModeSchema.default("single"),
    choices: z.array(SemanticClarifyQuestionChoiceSchema).min(2).max(4),
    note: z.string().optional(),
  })
  .strict();

export const ClarifyFrontierLedgerSchema = z
  .object({
    clarify_strength: ThothRuntimeClarifyStrengthSchema.exclude(["deep"]),
    grounded_user_decisions: z.array(NonEmptyStringSchema),
    remaining_material_user_owned_assumptions: z.array(NonEmptyStringSchema),
    agent_owned_assumptions: z.array(NonEmptyStringSchema),
    discoverable_assumptions: z.array(NonEmptyStringSchema),
    why_this_round: NonEmptyStringSchema,
    convergence_state: z.enum(["not_converged", "ready_for_task", "user_stopped", "blocked"]),
  })
  .strict()
  .superRefine((ledger, ctx) => {
    if (
      ledger.convergence_state === "ready_for_task" &&
      ledger.remaining_material_user_owned_assumptions.length > 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "ready_for_task requires no remaining material user-owned assumptions in the frontier ledger",
        path: ["remaining_material_user_owned_assumptions"],
      });
    }
  });

export const ClarifyConvergenceReviewSchema = z
  .object({
    frontier_ledger: ClarifyFrontierLedgerSchema,
    why_task_is_now_grounded: NonEmptyStringSchema,
    below_soft_target_rationale: z.string().optional(),
  })
  .strict();

/**
 * Internal decision-value record. It is persisted with a Clarify card so the
 * daemon and offline harness can evaluate whether the question changed the
 * eventual authority contract without exposing chain-of-thought in the UI.
 */
export const ClarifyDecisionDeltaSchema = z
  .object({
    affected_contract_fields: z.array(NonEmptyStringSchema).min(1),
    safe_if_unanswered: NonEmptyStringSchema,
    eliminated_routes: z.array(NonEmptyStringSchema).default([]),
    irreversible_or_cost_impact: z.string().optional(),
    downstream_refs: z.array(NonEmptyStringSchema).min(1),
  })
  .strict();

export const ClarifyConvergenceAuditOutcomeSchema = z.enum([
  "proceed",
  "revise_frontier",
  "blocked",
]);

export const ClarifyConvergenceAuditSchema = z
  .object({
    outcome: ClarifyConvergenceAuditOutcomeSchema,
    summary: NonEmptyStringSchema,
    missing_material_frontier: z.array(NonEmptyStringSchema).default([]),
    rejected_question_patterns: z.array(NonEmptyStringSchema).default([]),
    task_memory_refs: z.array(NonEmptyStringSchema).default([]),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.outcome === "revise_frontier" && input.missing_material_frontier.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "revise_frontier audits must identify a material frontier",
        path: ["missing_material_frontier"],
      });
    }
  });

export const ThothSubmitClarifyCardInputSchema = z
  .object({
    title: NonEmptyStringSchema,
    why_now: NonEmptyStringSchema,
    decision_it_changes: NonEmptyStringSchema.optional(),
    public_badge_summary: NonEmptyStringSchema,
    frontier_ledger: ClarifyFrontierLedgerSchema,
    decision_delta: ClarifyDecisionDeltaSchema.optional(),
    questions: z.array(SemanticClarifyQuestionItemSchema).min(2).max(4),
    allow_choice_notes: z.literal(true).default(true),
    allow_note_only: z.literal(true).default(true),
  })
  .strict()
  .superRefine((input, ctx) => {
    rejectForbiddenRuntimeToolText(input, ctx, []);
  });

export const ThothSubmitTaskCardInputSchema = z
  .object({
    task_card: ClarifyTaskCardContractSchema,
    provenance: ClarifyCardProvenanceSchema,
    convergence_review: ClarifyConvergenceReviewSchema,
  })
  .strict()
  .superRefine((input, ctx) => {
    rejectForbiddenRuntimeToolText(input, ctx, []);
    if (input.convergence_review.frontier_ledger.convergence_state !== "ready_for_task") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Task Card requires a convergence review whose frontier ledger is ready_for_task",
        path: ["convergence_review", "frontier_ledger", "convergence_state"],
      });
    }
  });

export const ThothGetBoundTaskProgressInputSchema = z.object({}).strict();

export const ThothSubmitClarifyConvergenceAuditInputSchema = ClarifyConvergenceAuditSchema;

export const ThothSubmitGoalsCardInputSchema = z
  .object({
    goals_card: ClarifyGoalsCardContractSchema,
    provenance: ClarifyGoalCardProvenanceSchema,
  })
  .strict()
  .superRefine((input, ctx) => {
    rejectForbiddenRuntimeToolText(input, ctx, []);
    const serialized = JSON.stringify(input.goals_card);
    if (/(^|\s)(npm|pnpm|yarn|python|node|git|pytest|vitest|tsx|bash|sh)\s+/i.test(serialized)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Goals Card must not include command-level execution steps",
        path: ["goals_card"],
      });
    }
    if (/(^|[\s"'`])(?:\.{0,2}\/)?[\w.-]+\/[\w./-]+\.[A-Za-z0-9]{1,8}\b/.test(serialized)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Goals Card must not include file-path-level implementation details",
        path: ["goals_card"],
      });
    }
  });

export const ThothLoopPlanExecResultInputSchema = z
  .object({
    plan_summary: NonEmptyStringSchema,
    execution_summary: NonEmptyStringSchema,
    evidence: z.array(NonEmptyStringSchema).min(1),
    validation_performed: z.array(NonEmptyStringSchema).default([]),
    remaining_risks: z.array(NonEmptyStringSchema).default([]),
    next_review_focus: NonEmptyStringSchema,
  })
  .superRefine((input, ctx) => {
    rejectForbiddenRuntimeToolText(input, ctx, []);
  });

export const ThothLoopReviewOutcomeSchema = z.enum([
  "pass",
  "continue",
  "reframe_current_goal",
  "replan_unstarted_goals",
  "return_to_user_decision",
  "real_blocker",
]);

export const ThothLoopReviewDirectionMemoSchema = z
  .object({
    conclusion: NonEmptyStringSchema,
    reality: z.array(NonEmptyStringSchema).min(1),
    diagnosis: NonEmptyStringSchema,
    abandon: z.array(NonEmptyStringSchema).default([]),
    reframe: NonEmptyStringSchema,
    next_direction: NonEmptyStringSchema,
  })
  .strict();

export const ThothLoopReviewIndependentAssessmentInputSchema = z
  .object({
    observations: z.array(NonEmptyStringSchema).min(1),
    working_theory: NonEmptyStringSchema,
    inspection_focus: z.array(NonEmptyStringSchema).min(1),
  })
  .strict();

export const ThothLoopUserDecisionRequestSchema = z
  .object({
    title: NonEmptyStringSchema,
    question: NonEmptyStringSchema,
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
    note_placeholder: z.string().optional(),
  })
  .strict();

export const ContractPreservationAuditSchema = z
  .object({
    outcome: z.enum(["proceed", "reject", "blocked"]),
    summary: NonEmptyStringSchema,
    affected_goal_ids: z.array(NonEmptyStringSchema).default([]),
  })
  .strict();

export const ThothSubmitContractPreservationAuditInputSchema = ContractPreservationAuditSchema;

export const ThothLoopReviewVerdictInputSchema = z
  .object({
    outcome: ThothLoopReviewOutcomeSchema,
    summary: NonEmptyStringSchema,
    evidence_summary: NonEmptyStringSchema.optional(),
    direction_memo: ThothLoopReviewDirectionMemoSchema.optional(),
    user_decision: ThothLoopUserDecisionRequestSchema.optional(),
    deferred_goal_replan_proposal: z
      .object({
        base_goals_revision: z.number().int().nonnegative(),
        rationale: NonEmptyStringSchema,
        expected_benefit: NonEmptyStringSchema,
        affected_goal_ids: z.array(NonEmptyStringSchema).min(1),
        goals: z
          .array(
            z
              .object({
                id: NonEmptyStringSchema,
                order: z.number().int().positive(),
                title: NonEmptyStringSchema,
                goal: NonEmptyStringSchema,
                constraints: z.array(NonEmptyStringSchema).min(1),
                acceptance: z.array(NonEmptyStringSchema).min(1),
              })
              .strict(),
          )
          .min(1),
      })
      .strict()
      .optional(),
  })
  .superRefine((input, ctx) => {
    rejectForbiddenRuntimeToolText(input, ctx, []);
    const retryOutcome = input.outcome === "continue" || input.outcome === "reframe_current_goal";
    if (retryOutcome && !input.direction_memo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "retry Review verdicts must include direction_memo",
        path: ["direction_memo"],
      });
    }
    if (input.outcome === "return_to_user_decision" && !input.user_decision) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "return_to_user_decision requires user_decision",
        path: ["user_decision"],
      });
    }
    if (input.outcome === "replan_unstarted_goals" && !input.deferred_goal_replan_proposal) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "replan_unstarted_goals requires deferred_goal_replan_proposal",
        path: ["deferred_goal_replan_proposal"],
      });
    }
  });

export const ThothLoopReportBlockedInputSchema = z
  .object({
    title: NonEmptyStringSchema,
    reason: NonEmptyStringSchema,
    next_user_decision: z.string().optional(),
  })
  .superRefine((input, ctx) => {
    rejectForbiddenRuntimeToolText(input, ctx, []);
  });

export const ThothReportBlockedInputSchema = z
  .object({
    title: NonEmptyStringSchema,
    reason: NonEmptyStringSchema,
    user_decision_needed: z.string().optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    rejectForbiddenRuntimeToolText(input, ctx, []);
  });

export const ThothClarifyRuntimeToolInputSchema = z.discriminatedUnion("tool", [
  z.object({
    tool: z.literal("thoth_get_bound_task_progress"),
    input: ThothGetBoundTaskProgressInputSchema,
  }),
  z.object({
    tool: z.literal("thoth_submit_clarify_card"),
    input: ThothSubmitClarifyCardInputSchema,
  }),
  z.object({
    tool: z.literal("thoth_submit_task_card"),
    input: ThothSubmitTaskCardInputSchema,
  }),
  z.object({
    tool: z.literal("thoth_submit_clarify_convergence_audit"),
    input: ThothSubmitClarifyConvergenceAuditInputSchema,
  }),
  z.object({
    tool: z.literal("thoth_submit_goals_card"),
    input: ThothSubmitGoalsCardInputSchema,
  }),
  z.object({
    tool: z.literal("thoth_report_blocked"),
    input: ThothReportBlockedInputSchema,
  }),
]);

export const ThothLoopRuntimeToolInputSchema = z.discriminatedUnion("tool", [
  z.object({
    tool: z.literal("thoth_loop_submit_planexec_result"),
    input: ThothLoopPlanExecResultInputSchema,
  }),
  z.object({
    tool: z.literal("thoth_loop_submit_review_verdict"),
    input: ThothLoopReviewVerdictInputSchema,
  }),
  z.object({
    tool: z.literal("thoth_loop_submit_review_independent_assessment"),
    input: ThothLoopReviewIndependentAssessmentInputSchema,
  }),
  z.object({
    tool: z.literal("thoth_submit_contract_preservation_audit"),
    input: ThothSubmitContractPreservationAuditInputSchema,
  }),
  z.object({
    tool: z.literal("thoth_loop_report_blocked"),
    input: ThothLoopReportBlockedInputSchema,
  }),
]);

export const ThothRuntimeControlsSchema = z
  .object({
    mode: ThothRuntimeModeSchema,
    clarify: ThothRuntimeClarifyStrengthSchema,
    loop: ThothRuntimeLoopStrengthSchema.nullable(),
  })
  .strict();

export const ThothProviderInputEnvelopeSchema = z
  .object({
    type: z.literal("provider_input"),
    skill: ThothRuntimeSkillIdSchema,
    session_id: NonEmptyStringSchema,
    task_id: z.string().min(1).nullable(),
    code: z.union([ClarifyRuntimeCodeSchema, LoopRuntimeCodeSchema]),
    controls: ThothRuntimeControlsSchema,
    turn_phase: ClarifyTurnPhaseSchema.optional(),
    input: z.string(),
    inject: ThothRuntimeSkillInjectionSchema,
    expect: z.enum(["clarify", "loop"]).optional(),
  })
  .strict()
  .superRefine((envelope, ctx) => {
    if (envelope.skill === "thoth.clarify") {
      if (envelope.expect !== undefined && envelope.expect !== "clarify") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "thoth.clarify envelopes must expect clarify packets",
          path: ["expect"],
        });
      }
      if (!ClarifyRuntimeCodeSchema.safeParse(envelope.code).success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "thoth.clarify envelopes must use clarify state codes",
          path: ["code"],
        });
      }
      if (envelope.turn_phase === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "thoth.clarify envelopes must include turn_phase",
          path: ["turn_phase"],
        });
      }
    }

    if (envelope.skill === "thoth.loop") {
      if (envelope.expect !== undefined && envelope.expect !== "loop") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "thoth.loop envelopes must expect loop packets",
          path: ["expect"],
        });
      }
      if (!LoopRuntimeCodeSchema.safeParse(envelope.code).success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "thoth.loop envelopes must use loop state codes",
          path: ["code"],
        });
      }
    }
  });

export type ThothRuntimeSkillId = z.infer<typeof ThothRuntimeSkillIdSchema>;
export type ClarifyRuntimeCode = z.infer<typeof ClarifyRuntimeCodeSchema>;
export type LoopRuntimeCode = z.infer<typeof LoopRuntimeCodeSchema>;
export type ClarifyRuntimeUiKind = z.infer<typeof ClarifyRuntimeUiKindSchema>;
export type LoopRuntimeUiKind = z.infer<typeof LoopRuntimeUiKindSchema>;
export type ThothRuntimeMode = z.infer<typeof ThothRuntimeModeSchema>;
export type ThothRuntimeClarifyStrength = z.infer<typeof ThothRuntimeClarifyStrengthSchema>;
export type ThothRuntimeLoopStrength = z.infer<typeof ThothRuntimeLoopStrengthSchema>;
export type ThothRuntimeSkillInjection = z.infer<typeof ThothRuntimeSkillInjectionSchema>;
export type ClarifyTurnPhase = z.infer<typeof ClarifyTurnPhaseSchema>;
export type ClarifyQuestionChoice = z.infer<typeof ClarifyQuestionChoiceSchema>;
export type ClarifyQuestionSelectionMode = z.infer<typeof ClarifyQuestionSelectionModeSchema>;
export type ClarifyQuestionItem = z.infer<typeof ClarifyQuestionItemSchema>;
export type ClarifyQuestionCard = z.infer<typeof ClarifyQuestionCardSchema>;
export type ClarifyAnswerItem = z.infer<typeof ClarifyAnswerItemSchema>;
export type ClarifyAnswerPacket = z.infer<typeof ClarifyAnswerPacketSchema>;
export type ClarifyAssumptionOwner = z.infer<typeof ClarifyAssumptionOwnerSchema>;
export type ClarifyMaterialAssumption = z.infer<typeof ClarifyMaterialAssumptionSchema>;
export type ClarifyOutputMeta = z.infer<typeof ClarifyOutputMetaSchema>;
export type ClarifyCardProvenance = z.infer<typeof ClarifyCardProvenanceSchema>;
export type ClarifyGoalCardProvenance = z.infer<typeof ClarifyGoalCardProvenanceSchema>;
export type ClarifyTaskCardContract = z.infer<typeof ClarifyTaskCardContractSchema>;
export type ClarifyPyramidPlanSubgoal = z.infer<typeof ClarifyPyramidPlanSubgoalSchema>;
export type ClarifyPyramidPlanStage = z.infer<typeof ClarifyPyramidPlanStageSchema>;
export type ClarifyGoalCardContract = z.infer<typeof ClarifyGoalCardContractSchema>;
export type ClarifyLinearGoalContract = z.infer<typeof ClarifyLinearGoalContractSchema>;
export type ClarifyGoalsCardContract = z.infer<typeof ClarifyGoalsCardContractSchema>;
export type ThothRuntimeSkillRef = z.infer<typeof ThothRuntimeSkillRefSchema>;
export type ClarifyInputControls = z.infer<typeof ClarifyInputControlsSchema>;
export type ClarifyControlsChanged = z.infer<typeof ClarifyControlsChangedSchema>;
export type ClarifySessionStartInputPacket = z.infer<typeof ClarifySessionStartInputPacketSchema>;
export type ClarifyTurnInputPacket = z.infer<typeof ClarifyTurnInputPacketSchema>;
export type ClarifyTransitionInputPacket = z.infer<typeof ClarifyTransitionInputPacketSchema>;
export type ClarifyRepairInputPacket = z.infer<typeof ClarifyRepairInputPacketSchema>;
export type ClarifyProviderRuntimeInputPacket = z.infer<
  typeof ClarifyProviderRuntimeInputPacketSchema
>;
export type LoopRuntimeCursor = z.infer<typeof LoopRuntimeCursorSchema>;
export type ClarifyRuntimePacket = z.infer<typeof ClarifyRuntimePacketSchema>;
export type LoopRuntimePacket = z.infer<typeof LoopRuntimePacketSchema>;
export type ThothRuntimePacket = z.infer<typeof ThothRuntimePacketSchema>;
export type ProviderQuestionEvent = z.infer<typeof ProviderQuestionEventSchema>;
export type ClarificationCardCandidate = z.infer<typeof ClarificationCardCandidateSchema>;
export type RuntimePacketCandidate = z.infer<typeof RuntimePacketCandidateSchema>;
export type RuntimeToolTransport = z.infer<typeof RuntimeToolTransportSchema>;
export type RuntimeToolCapabilities = z.infer<typeof RuntimeToolCapabilitiesSchema>;
export type RuntimeToolBridgeDescriptor = z.infer<typeof RuntimeToolBridgeDescriptorSchema>;
export type ThothClarifyRuntimeToolName = z.infer<typeof ThothClarifyRuntimeToolNameSchema>;
export type ThothLoopRuntimeToolName = z.infer<typeof ThothLoopRuntimeToolNameSchema>;
export type ThothRuntimeToolName = z.infer<typeof ThothRuntimeToolNameSchema>;
export type ClarifyFrontierLedger = z.infer<typeof ClarifyFrontierLedgerSchema>;
export type ClarifyDecisionDelta = z.infer<typeof ClarifyDecisionDeltaSchema>;
export type ClarifyConvergenceAudit = z.infer<typeof ClarifyConvergenceAuditSchema>;
export type ContractPreservationAudit = z.infer<typeof ContractPreservationAuditSchema>;
export type ClarifyConvergenceReview = z.infer<typeof ClarifyConvergenceReviewSchema>;
export type ThothSubmitClarifyCardInput = z.infer<typeof ThothSubmitClarifyCardInputSchema>;
export type ThothGetBoundTaskProgressInput = z.infer<typeof ThothGetBoundTaskProgressInputSchema>;
export type ThothSubmitTaskCardInput = z.infer<typeof ThothSubmitTaskCardInputSchema>;
export type ThothSubmitClarifyConvergenceAuditInput = z.infer<
  typeof ThothSubmitClarifyConvergenceAuditInputSchema
>;
export type ThothSubmitContractPreservationAuditInput = z.infer<
  typeof ThothSubmitContractPreservationAuditInputSchema
>;
export type ThothSubmitGoalsCardInput = z.infer<typeof ThothSubmitGoalsCardInputSchema>;
export type ThothLoopPlanExecResultInput = z.infer<typeof ThothLoopPlanExecResultInputSchema>;
export type ThothLoopReviewOutcome = z.infer<typeof ThothLoopReviewOutcomeSchema>;
export type ThothLoopReviewDirectionMemo = z.infer<typeof ThothLoopReviewDirectionMemoSchema>;
export type ThothLoopReviewIndependentAssessmentInput = z.infer<
  typeof ThothLoopReviewIndependentAssessmentInputSchema
>;
export type ThothLoopUserDecisionRequest = z.infer<typeof ThothLoopUserDecisionRequestSchema>;
export type ThothLoopReviewVerdictInput = z.infer<typeof ThothLoopReviewVerdictInputSchema>;
export type ThothLoopReportBlockedInput = z.infer<typeof ThothLoopReportBlockedInputSchema>;
export type ThothReportBlockedInput = z.infer<typeof ThothReportBlockedInputSchema>;
export type ThothClarifyRuntimeToolInput = z.infer<typeof ThothClarifyRuntimeToolInputSchema>;
export type ThothLoopRuntimeToolInput = z.infer<typeof ThothLoopRuntimeToolInputSchema>;
export type ThothRuntimeControls = z.infer<typeof ThothRuntimeControlsSchema>;
export type ThothProviderInputEnvelope = z.infer<typeof ThothProviderInputEnvelopeSchema>;
